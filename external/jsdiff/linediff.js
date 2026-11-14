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
 * A fast line diff for creating patches of large files.
 *
 * Lines are turned into numbers first, so lines are compared as integers.
 * The common start and end are skipped, then the "patience" method lines up
 * the lines that occur exactly once in both versions, and the gaps between
 * them are diffed the same way. Only small gaps without such lines are
 * compared line by line (Myers' algorithm). The result is always a correct
 * diff: applying it to the old text gives exactly the new text.
 */

// Gaps that need more edits than this are written as removed + added lines,
// which is still a correct diff, so a pathological file cannot hang the page.
const MAX_MYERS_EDITS = 4000;

/**
 * Splits text into lines. Each line keeps its "\n", so that a last line
 * without a newline differs from the same line with one (like jsdiff and git).
 */
export function splitLines(text) {
    const lines = [];
    let start = 0;
    for (;;) {
        const end = text.indexOf('\n', start);
        if (end === -1) break;
        lines.push(text.slice(start, end + 1));
        start = end + 1;
    }
    if (start < text.length) lines.push(text.slice(start));
    return lines;
}

/**
 * Compares two arrays of lines.
 *
 * @returns {Array<number>} A flat list of [type, oldIndex, newIndex, count]
 *     operations in order, where type 0 = same, 1 = removed, 2 = added.
 */
export function diffLineArrays(oldLines, newLines) {
    const ids = new Map();
    const toIds = (lines) => {
        const out = new Int32Array(lines.length);
        for (let i = 0; i < lines.length; i++) {
            let id = ids.get(lines[i]);
            if (id === undefined) ids.set(lines[i], id = ids.size);
            out[i] = id;
        }
        return out;
    };
    const a = toIds(oldLines);
    const b = toIds(newLines);
    const ops = [];
    const emit = (type, ai, bi, count) => {
        if (count <= 0) return;
        const n = ops.length;
        // Merge with the previous operation of the same type when adjacent.
        if (n && ops[n - 4] === type &&
            ops[n - 3] + (type === 2 ? 0 : ops[n - 1]) === ai &&
            ops[n - 2] + (type === 1 ? 0 : ops[n - 1]) === bi) {
            ops[n - 1] += count;
            return;
        }
        ops.push(type, ai, bi, count);
    };
    diffRange(a, 0, a.length, b, 0, b.length, emit, ids.size);
    return ops;
}

function diffRange(a, aLo, aHi, b, bLo, bHi, emit, idCount) {
    // A work list instead of recursion, so deep files cannot overflow the stack.
    // Each item is either a range to diff or an "equal" run to emit, in order.
    const stack = [[aLo, aHi, bLo, bHi]];
    while (stack.length) {
        const item = stack.pop();
        if (item.length === 3) {
            emit(0, item[0], item[1], item[2]);
            continue;
        }
        let [lo1, hi1, lo2, hi2] = item;
        // Common start.
        let pre = 0;
        while (lo1 + pre < hi1 && lo2 + pre < hi2 && a[lo1 + pre] === b[lo2 + pre]) pre++;
        emit(0, lo1, lo2, pre);
        lo1 += pre;
        lo2 += pre;
        // Common end.
        let suf = 0;
        while (hi1 - suf > lo1 && hi2 - suf > lo2 && a[hi1 - suf - 1] === b[hi2 - suf - 1]) suf++;
        const tail = suf ? [hi1 - suf, hi2 - suf, suf] : null;
        hi1 -= suf;
        hi2 -= suf;

        if (lo1 === hi1 || lo2 === hi2) {
            emit(1, lo1, lo2, hi1 - lo1);
            emit(2, hi1, lo2, hi2 - lo2);
            if (tail) emit(0, tail[0], tail[1], tail[2]);
            continue;
        }

        const anchors = uniqueAnchors(a, lo1, hi1, b, lo2, hi2);
        const todo = [];
        if (anchors.length) {
            let p1 = lo1, p2 = lo2;
            for (let k = 0; k < anchors.length; k += 2) {
                todo.push([p1, anchors[k], p2, anchors[k + 1]]);
                // Extend the anchor over the equal lines that follow it.
                let len = 1;
                while (anchors[k] + len < hi1 && anchors[k + 1] + len < hi2 &&
                    (k + 2 >= anchors.length || (anchors[k] + len < anchors[k + 2] && anchors[k + 1] + len < anchors[k + 3])) &&
                    a[anchors[k] + len] === b[anchors[k + 1] + len]) len++;
                todo.push([anchors[k], anchors[k + 1], len]);
                p1 = anchors[k] + len;
                p2 = anchors[k + 1] + len;
            }
            todo.push([p1, hi1, p2, hi2]);
        } else {
            myers(a, lo1, hi1, b, lo2, hi2, emit);
        }
        if (tail) todo.push(tail);
        // Push in reverse so they are handled in order.
        for (let k = todo.length - 1; k >= 0; k--) stack.push(todo[k]);
    }
}

/**
 * Finds lines that occur exactly once in both ranges, and returns the
 * longest list of them that is in the same order in both, as a flat list of
 * [oldIndex, newIndex] pairs.
 */
function uniqueAnchors(a, lo1, hi1, b, lo2, hi2) {
    // Count occurrences: in the old range, then remember where in the new range.
    const count = new Map(); // id -> count in a (capped at 2)
    const posA = new Map();
    for (let i = lo1; i < hi1; i++) {
        const c = count.get(a[i]);
        if (c === undefined) { count.set(a[i], 1); posA.set(a[i], i); }
        else if (c === 1) count.set(a[i], 2);
    }
    const countB = new Map();
    const posB = new Map();
    for (let j = lo2; j < hi2; j++) {
        const id = b[j];
        if (count.get(id) !== 1) continue;
        const c = countB.get(id);
        if (c === undefined) { countB.set(id, 1); posB.set(id, j); }
        else if (c === 1) countB.set(id, 2);
    }
    // Pairs in the order of the old range.
    const pairsA = [];
    const pairsB = [];
    for (let i = lo1; i < hi1; i++) {
        const id = a[i];
        if (count.get(id) === 1 && countB.get(id) === 1) {
            pairsA.push(i);
            pairsB.push(posB.get(id));
        }
    }
    if (!pairsA.length) return [];
    // Longest increasing subsequence of the new positions (patience sorting).
    const n = pairsB.length;
    const tails = new Int32Array(n);
    const prev = new Int32Array(n);
    let len = 0;
    for (let k = 0; k < n; k++) {
        const v = pairsB[k];
        let lo = 0, hi = len;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pairsB[tails[mid]] < v) lo = mid + 1;
            else hi = mid;
        }
        prev[k] = lo ? tails[lo - 1] : -1;
        tails[lo] = k;
        if (lo === len) len++;
    }
    const result = new Array(len * 2);
    for (let k = tails[len - 1], r = len - 1; k >= 0; k = prev[k], r--) {
        result[r * 2] = pairsA[k];
        result[r * 2 + 1] = pairsB[k];
    }
    return result;
}

/**
 * Myers' O(ND) diff for a small range without unique lines. The ranges have
 * no common start or end. Emits the operations in order.
 */
function myers(a, lo1, hi1, b, lo2, hi2, emit) {
    const n = hi1 - lo1;
    const m = hi2 - lo2;
    const max = Math.min(n + m, MAX_MYERS_EDITS);
    const offset = max + 1;
    const v = new Int32Array(2 * max + 3);
    const trace = [];
    let found = -1;
    for (let d = 0; d <= max && found < 0; d++) {
        trace.push(v.slice(offset - d - 1, offset + d + 2));
        for (let k = -d; k <= d; k += 2) {
            let x;
            if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
            else x = v[offset + k - 1] + 1;
            let y = x - k;
            while (x < n && y < m && a[lo1 + x] === b[lo2 + y]) { x++; y++; }
            v[offset + k] = x;
            if (x >= n && y >= m) { found = d; break; }
        }
    }
    if (found < 0) {
        // Too different to line up: remove the old lines, add the new ones.
        emit(1, lo1, lo2, n);
        emit(2, hi1, lo2, m);
        return;
    }
    // Walk back through the saved states to find the edit script.
    const steps = [];
    let x = n, y = m;
    for (let d = found; d > 0; d--) {
        const vd = trace[d]; // state before step d, indexed by k + d + 1
        const at = (k) => vd[k + d + 1];
        const k = x - y;
        let prevK;
        if (k === -d || (k !== d && at(k - 1) < at(k + 1))) prevK = k + 1;
        else prevK = k - 1;
        const prevX = at(prevK);
        const prevY = prevX - prevK;
        const snake = Math.min(x - (prevK === k + 1 ? prevX : prevX + 1), y - (prevK === k + 1 ? prevY + 1 : prevY));
        if (snake > 0) steps.push([0, x - snake, y - snake, snake]);
        if (prevK === k + 1) steps.push([2, prevX, prevY, 1]); // added b[prevY]
        else steps.push([1, prevX, prevY, 1]); // removed a[prevX]
        x = prevX;
        y = prevY;
    }
    if (x > 0) steps.push([0, 0, 0, x]); // the snake at d = 0
    for (let s = steps.length - 1; s >= 0; s--) {
        const [type, sx, sy, count] = steps[s];
        emit(type, lo1 + sx, lo2 + sy, count);
    }
}

/**
 * Builds jsdiff-style hunks (for formatPatch) from two texts.
 */
export function buildHunks(oldText, newText, context) {
    const oldLines = splitLines(oldText);
    const newLines = splitLines(newText);
    const ops = diffLineArrays(oldLines, newLines);
    const hunks = [];
    const pushLine = (lines, prefix, text) => {
        if (text.endsWith('\n')) {
            lines.push(prefix + text.slice(0, -1));
        } else {
            lines.push(prefix + text, '\\ No newline at end of file');
        }
    };
    let hunk = null;
    for (let o = 0; o < ops.length; o += 4) {
        const type = ops[o], ai = ops[o + 1], bi = ops[o + 2], count = ops[o + 3];
        if (type === 0) {
            if (!hunk) continue;
            const isLast = o + 4 >= ops.length;
            if (!isLast && count <= context * 2) {
                for (let i = 0; i < count; i++) pushLine(hunk.lines, ' ', oldLines[ai + i]);
                hunk.oldLines += count;
                hunk.newLines += count;
                continue;
            }
            const take = Math.min(count, context);
            for (let i = 0; i < take; i++) pushLine(hunk.lines, ' ', oldLines[ai + i]);
            hunk.oldLines += take;
            hunk.newLines += take;
            hunks.push(hunk);
            hunk = null;
            continue;
        }
        if (!hunk) {
            // Start a hunk with up to `context` lines before the change.
            const before = o >= 4 && ops[o - 4] === 0 ? Math.min(ops[o - 1], context) : 0;
            hunk = {oldStart: ai - before + 1, oldLines: before, newStart: bi - before + 1, newLines: before, lines: []};
            for (let i = before; i > 0; i--) pushLine(hunk.lines, ' ', oldLines[ai - i]);
        }
        if (type === 1) {
            for (let i = 0; i < count; i++) pushLine(hunk.lines, '-', oldLines[ai + i]);
            hunk.oldLines += count;
        } else {
            for (let i = 0; i < count; i++) pushLine(hunk.lines, '+', newLines[bi + i]);
            hunk.newLines += count;
        }
    }
    if (hunk) hunks.push(hunk);
    return hunks;
}
