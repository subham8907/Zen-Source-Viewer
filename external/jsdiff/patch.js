/**
 * Copyright 2026 Subham Mahesh
 *
 * Licensed under the File-Level Copyleft License (FLCL), Version 1.0
 * (the "License"); you may not use this file except in compliance
 * with the License. You may obtain a copy of the License in the
 * LICENSE-FLCL file accompanying this work.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * permissions and limitations under the License.
 *
 * Creates and applies patches, like `git diff --binary` and `git apply`.
 * Text changes use jsdiff (the "diff" npm package, BSD-3-Clause); changes to
 * binary files use Git's binary patch format, with zlib from fflate (MIT) and
 * SHA-1 from @noble/hashes (MIT). Bundled by `node make.js bundles` into
 * src/lib/jsdiff.js, which exposes the global `ZenPatch`.
 */

import {formatPatch, parsePatch, applyPatch} from 'diff';
import {buildHunks} from './linediff.js';
import {zlibSync, unzlibSync} from 'fflate';
import {sha1} from '@noble/hashes/legacy.js';
import {bytesToHex} from '@noble/hashes/utils.js';

const DEV_NULL = '/dev/null';
const NULL_SHA = '0000000000000000000000000000000000000000';
const FILE_MODE = '100644';

// ---- Git object ids, base85 and binary patch data

// The id of a file's content in Git (`git hash-object`).
function blobSha1(bytes) {
    const header = new TextEncoder().encode('blob ' + bytes.length + '\0');
    const data = new Uint8Array(header.length + bytes.length);
    data.set(header);
    data.set(bytes, header.length);
    return bytesToHex(sha1(data));
}

// Git's base85 alphabet (see base85.c in Git).
const B85 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&()*+-;<=>?@^_`{|}~';
const B85_VALUE = new Map(Array.from(B85, (c, i) => [c, i]));

function encodeBase85Line(bytes) {
    // The first character is the number of bytes in this line: A-Z = 1-26, a-z = 27-52.
    const length = bytes.length;
    let line = length <= 26 ? String.fromCharCode(64 + length) : String.fromCharCode(96 + length - 26);
    for (let i = 0; i < length; i += 4) {
        let acc = 0;
        for (let j = 0; j < 4; j++) {
            acc = acc * 256 + (i + j < length ? bytes[i + j] : 0);
        }
        let group = '';
        for (let j = 0; j < 5; j++) {
            group = B85[acc % 85] + group;
            acc = Math.floor(acc / 85);
        }
        line += group;
    }
    return line;
}

function decodeBase85Lines(lines) {
    const chunks = [];
    let total = 0;
    for (const line of lines) {
        const c = line.charCodeAt(0);
        let length;
        if (c >= 65 && c <= 90) length = c - 64;
        else if (c >= 97 && c <= 122) length = c - 96 + 26;
        else throw new Error('Corrupt binary patch line');
        const out = new Uint8Array(Math.ceil(length / 4) * 4);
        for (let i = 1, o = 0; o < out.length; i += 5, o += 4) {
            let acc = 0;
            for (let j = 0; j < 5; j++) {
                const value = B85_VALUE.get(line[i + j]);
                if (value === undefined) throw new Error('Corrupt binary patch data');
                acc = acc * 85 + value;
            }
            out[o] = acc >>> 24;
            out[o + 1] = (acc >>> 16) & 0xff;
            out[o + 2] = (acc >>> 8) & 0xff;
            out[o + 3] = acc & 0xff;
        }
        chunks.push(out.subarray(0, length));
        total += length;
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.length;
    }
    return result;
}

// "literal <size>" followed by the zlib-compressed, base85-encoded content.
function formatLiteral(bytes) {
    const compressed = zlibSync(bytes, {level: 9});
    const lines = ['literal ' + bytes.length];
    for (let i = 0; i < compressed.length; i += 52) {
        lines.push(encodeBase85Line(compressed.subarray(i, i + 52)));
    }
    return lines.join('\n') + '\n';
}

// Applies a Git delta (see patch-delta.c in Git) to the old content.
function applyDelta(base, delta) {
    let pos = 0;
    function varint() {
        let value = 0, shift = 0, byte;
        do {
            byte = delta[pos++];
            value += (byte & 0x7f) * Math.pow(2, shift);
            shift += 7;
        } while (byte & 0x80);
        return value;
    }
    const baseSize = varint();
    const resultSize = varint();
    if (baseSize !== base.length) throw new Error('The binary file does not match the patch');
    const result = new Uint8Array(resultSize);
    let out = 0;
    while (pos < delta.length) {
        const cmd = delta[pos++];
        if (cmd & 0x80) {
            let offset = 0, size = 0;
            if (cmd & 0x01) offset = delta[pos++];
            if (cmd & 0x02) offset |= delta[pos++] << 8;
            if (cmd & 0x04) offset |= delta[pos++] << 16;
            if (cmd & 0x08) offset = (offset | (delta[pos++] << 24)) >>> 0;
            if (cmd & 0x10) size = delta[pos++];
            if (cmd & 0x20) size |= delta[pos++] << 8;
            if (cmd & 0x40) size |= delta[pos++] << 16;
            if (size === 0) size = 0x10000;
            if (offset + size > base.length || out + size > resultSize) throw new Error('Corrupt binary delta');
            result.set(base.subarray(offset, offset + size), out);
            out += size;
        } else if (cmd) {
            if (out + cmd > resultSize) throw new Error('Corrupt binary delta');
            result.set(delta.subarray(pos, pos + cmd), out);
            pos += cmd;
            out += cmd;
        } else {
            throw new Error('Corrupt binary delta');
        }
    }
    if (out !== resultSize) throw new Error('Corrupt binary delta');
    return result;
}

// ---- Creating patches

function gitHeader(path, isCreate, isDelete, oldSha, newSha) {
    const lines = ['diff --git a/' + path + ' b/' + path];
    if (isCreate) lines.push('new file mode ' + FILE_MODE);
    if (isDelete) lines.push('deleted file mode ' + FILE_MODE);
    lines.push('index ' + oldSha + '..' + newSha + (isCreate || isDelete ? '' : ' ' + FILE_MODE));
    return lines;
}

/**
 * Creates a Git-style patch (like `git diff --binary`) for several files.
 *
 * @param {Array<object>} files Each file has a `path`, and either
 *     oldText/newText (text files) or oldBytes/newBytes (binary files, with
 *     binary: true). The old value is null for a new file, the new value is
 *     null for a removed file.
 * @param {function(number, number)} [onProgress] Called with (done, total)
 *     before each file.
 * @returns {string} The patch, or '' if nothing changed.
 */
function createGitPatch(files, onProgress) {
    const parts = [];
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (onProgress) onProgress(i, files.length);
        if (file.binary) {
            const part = binaryFilePatch(file);
            if (part) parts.push(part);
            continue;
        }
        const isCreate = file.oldText === null || file.oldText === undefined;
        const isDelete = file.newText === null || file.newText === undefined;
        const part = textFilePatch(file.path, isCreate ? null : file.oldText, isDelete ? null : file.newText);
        if (part) parts.push(part);
    }
    return parts.length ? parts.join('\n') + '\n' : '';
}

/**
 * The patch for one text file, without a trailing newline ('' if unchanged).
 * oldText is null for a new file, newText is null for a removed file.
 */
function textFilePatch(path, oldText, newText) {
    const isCreate = oldText === null;
    const isDelete = newText === null;
    const hunks = buildHunks(isCreate ? '' : oldText, isDelete ? '' : newText, 3);
    if (!hunks.length && !isCreate && !isDelete) return ''; // Unchanged.
    return formatPatch({
        oldFileName: isCreate ? DEV_NULL : 'a/' + path,
        newFileName: isDelete ? DEV_NULL : 'b/' + path,
        oldHeader: undefined,
        newHeader: undefined,
        hunks,
        isGit: true,
        isCreate,
        isDelete,
    }).replace(/\n$/, '');
}

function binaryFilePatch(file) {
    const isCreate = !file.oldBytes;
    const isDelete = !file.newBytes;
    const oldBytes = file.oldBytes || new Uint8Array(0);
    const newBytes = file.newBytes || new Uint8Array(0);
    const oldSha = isCreate ? NULL_SHA : blobSha1(oldBytes);
    const newSha = isDelete ? NULL_SHA : blobSha1(newBytes);
    if (oldSha === newSha) return '';
    // Like Git: the forward change, then the reverse change (for `git apply -R`).
    return gitHeader(file.path, isCreate, isDelete, oldSha, newSha)
        .concat(['GIT binary patch', formatLiteral(newBytes), formatLiteral(oldBytes)])
        .join('\n').replace(/\n+$/, '\n');
}

// ---- Reading patches

function stripPrefix(name, isGit) {
    if (!name || name === DEV_NULL) return null;
    // Git (and most tools) prefix paths with a/ and b/.
    return isGit || /^[ab]\//.test(name) ? name.replace(/^[ab]\//, '') : name;
}

// Splits the text into the parts of each file that has a Git binary patch,
// and the rest (which jsdiff parses).
function splitBinaryParts(text) {
    const lines = text.split(/\r?\n/);
    const starts = [];
    lines.forEach((line, i) => {
        if (line.startsWith('diff --git ')) starts.push(i);
    });
    const binaryParts = [];
    const textLines = starts.length ? lines.slice(0, starts[0]) : lines;
    starts.forEach((start, n) => {
        const part = lines.slice(start, n + 1 < starts.length ? starts[n + 1] : lines.length);
        if (part.includes('GIT binary patch')) {
            binaryParts.push(part);
        } else {
            textLines.push(...part);
        }
    });
    return {binaryParts, text: textLines.join('\n')};
}

function parseBinaryPart(lines) {
    const header = /^diff --git a\/(.+) b\/(.+)$/.exec(lines[0]);
    if (!header) throw new Error('Unsupported binary patch header: ' + lines[0]);
    let oldPath = header[1];
    let newPath = header[2];
    let isCreate = false, isDelete = false, isRename = false;
    let oldSha = null, newSha = null;
    let i = 1;
    for (; i < lines.length && lines[i] !== 'GIT binary patch'; i++) {
        const line = lines[i];
        let m;
        if (line.startsWith('new file mode')) isCreate = true;
        else if (line.startsWith('deleted file mode')) isDelete = true;
        else if ((m = /^rename from (.+)$/.exec(line))) { oldPath = m[1]; isRename = true; }
        else if ((m = /^rename to (.+)$/.exec(line))) { newPath = m[1]; isRename = true; }
        else if ((m = /^index ([0-9a-f]+)\.\.([0-9a-f]+)/.exec(line))) { oldSha = m[1]; newSha = m[2]; }
    }
    // The first hunk after "GIT binary patch" is the forward change.
    i++;
    const m = /^(literal|delta) (\d+)$/.exec(lines[i] || '');
    if (!m) throw new Error('Unsupported binary patch for ' + newPath);
    const dataLines = [];
    for (i++; i < lines.length && lines[i] !== ''; i++) dataLines.push(lines[i]);
    const data = unzlibSync(decodeBase85Lines(dataLines));
    if (m[1] === 'literal' && data.length !== +m[2]) throw new Error('Corrupt binary patch for ' + newPath);
    let kind = 'modify';
    if (isCreate) kind = 'create';
    else if (isDelete) kind = 'delete';
    else if (isRename || oldPath !== newPath) kind = 'rename';
    return {
        kind,
        binary: true,
        oldPath: isCreate ? null : oldPath,
        newPath: isDelete ? null : newPath,
        oldSha,
        newSha,
        hunk: {type: m[1], data},
    };
}

/**
 * Parses a patch (unified diff, also from `git diff --binary`) into a list of file changes.
 *
 * @returns {Array<object>} Each change has kind ('modify', 'create', 'delete',
 *     'rename'), oldPath, newPath, and either patch (text) or binary: true.
 *     kind is 'binary' for a binary change without data ("Binary files differ").
 */
function parse(text) {
    const split = splitBinaryParts(text);
    const binary = split.binaryParts.map(parseBinaryPart);
    const textChanges = parsePatch(split.text).filter((p) => p.oldFileName || p.newFileName).map((p) => {
        const oldPath = p.isCreate ? null : stripPrefix(p.oldFileName, p.isGit);
        const newPath = p.isDelete ? null : stripPrefix(p.newFileName, p.isGit);
        let kind = 'modify';
        if (p.isBinary) kind = 'binary';
        else if (!oldPath) kind = 'create';
        else if (!newPath) kind = 'delete';
        else if (p.isRename || oldPath !== newPath) kind = 'rename';
        return {kind, oldPath, newPath, patch: p};
    });
    return binary.concat(textChanges);
}

/**
 * Applies the patch of one text file. Like `patch`, it first requires an
 * exact match, then allows the context lines to differ slightly (fuzz).
 *
 * @returns {{text: string, fuzz: number}|null} null if the patch does not fit.
 */
function apply(text, patch) {
    for (const fuzzFactor of [0, 1, 2]) {
        const result = applyPatch(text, patch, {fuzzFactor});
        if (result !== false) return {text: result, fuzz: fuzzFactor};
    }
    return null;
}

function shaMatches(expected, bytes) {
    // Git may abbreviate ids; compare the given prefix.
    return !expected || /^0+$/.test(expected) || blobSha1(bytes).startsWith(expected);
}

/**
 * Applies a binary change (from parse) to the current content of the file.
 *
 * @param {?Uint8Array} oldBytes Current content (null for a new file).
 * @returns {{bytes: ?Uint8Array, error: ?string}} bytes is null for a removed file.
 */
function applyBinary(oldBytes, change) {
    const base = oldBytes || new Uint8Array(0);
    if (change.kind !== 'create' && !shaMatches(change.oldSha, base)) {
        return {bytes: null, error: 'the file does not match the patch (it may be a different version)'};
    }
    let result;
    try {
        result = change.hunk.type === 'literal' ? change.hunk.data : applyDelta(base, change.hunk.data);
    } catch (e) {
        return {bytes: null, error: e.message};
    }
    if (change.kind === 'delete') return {bytes: null, error: null};
    if (!shaMatches(change.newSha, result)) {
        return {bytes: null, error: 'the result does not match the patch'};
    }
    return {bytes: result, error: null};
}

/**
 * Like createGitPatch, but in a background worker (patch-worker.js), so that
 * the page stays responsive while large patches are created.
 *
 * @returns {Promise<string>}
 */
function createGitPatchAsync(files, onProgress) {
    return new Promise((resolve, reject) => {
        let worker;
        try {
            worker = new Worker('patch-worker.js');
        } catch (e) {
            resolve(createGitPatch(files, onProgress));
            return;
        }
        worker.onmessage = (event) => {
            const data = event.data;
            if (data.progress !== undefined) {
                if (onProgress) onProgress(data.progress, data.total);
                return;
            }
            worker.terminate();
            if (data.error) reject(new Error(data.error));
            else resolve(data.patch);
        };
        worker.onerror = (event) => {
            event.preventDefault();
            worker.terminate();
            reject(new Error(event.message || 'Could not create the patch'));
        };
        worker.postMessage({files});
    });
}

self.ZenPatch = {createGitPatch, createGitPatchAsync, textFilePatch, binaryFilePatch, parse, apply, applyBinary, blobSha1};
