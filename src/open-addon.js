/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: replaces lib/crx-to-zip.js. Loads an add-on
 * and returns it as a zip file: Firefox add-ons (XPI) are plain zip files, and
 * the header of extensions for Chromium-based browsers (CRX2 and CRX3, also the
 * nested CRX files of Opera add-ons) is removed. The public key and extension
 * ID of a CRX file are found with the Web Crypto API (no CryptoJS).
 * Refuses add-on sites the user turned off (store-domains.js).
 * A Chrome update file (the XML file at an extension's update_url) is followed
 * to the .crx file it names. */

/* exported openAddonAsZip, ZenCrx */
/* jshint browser:true, devel:true, esversion:6 */
/* globals ZenStoreDomains, secure_download_url */
'use strict';

// Whether the data looks like a zip file: it starts with a local file header
// ("PK\3\4"), or has an end of central directory record near the end.
function isZipData(arraybuffer) {
    var view = new Uint8Array(arraybuffer);
    if (view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04) {
        return true;
    }
    // 0xFFFF is the maximum size of an optional trailing comment.
    for (var i = view.length - 22, ii = Math.max(0, i - 0xFFFF); i >= ii; --i) {
        if (view[i] === 0x50 && view[i + 1] === 0x4b &&
            view[i + 2] === 0x05 && view[i + 3] === 0x06) {
            return true;
        }
    }
    return false;
}

// CRX files: extensions for Chrome, Edge, Opera and other Chromium-based
// browsers. A CRX file is a zip file with a header in front of it.
// CRX2: https://web.archive.org/web/2018/https://developer.chrome.com/extensions/crx
// CRX3: https://source.chromium.org/chromium/chromium/src/+/main:components/crx_file/crx3.proto
var ZenCrx = (function() {
    // "Cr24"
    function isCrxData(view) {
        return view[0] === 0x43 && view[1] === 0x72 && view[2] === 0x32 && view[3] === 0x34;
    }

    function uint32(view, offset) {
        return (view[offset] | view[offset + 1] << 8 | view[offset + 2] << 16 | view[offset + 3] << 24) >>> 0;
    }

    function toBase64(bytes) {
        var binary = '';
        for (var i = 0; i < bytes.length; i += 0x8000) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        return btoa(binary);
    }

    function toHex(bytes) {
        return Array.prototype.map.call(bytes, function(b) {
            return (b < 16 ? '0' : '') + b.toString(16);
        }).join('');
    }

    // The extension ID is the first 128 bits of the SHA-256 hash of the public
    // key, written with the letters a-p instead of the hex digits 0-f.
    function hexToExtensionId(hex) {
        return hex.slice(0, 32).replace(/./g, function(digit) {
            return String.fromCharCode(97 + parseInt(digit, 16));
        });
    }

    function sha256Hex(bytes) {
        return crypto.subtle.digest('SHA-256', bytes).then(function(hash) {
            return toHex(new Uint8Array(hash));
        });
    }

    // Resolves to the extension ID of a public key (base64, as in the "key" of
    // manifest.json), or '' if it is not valid base64.
    function extensionIdFromKey(base64Key) {
        var bytes;
        try {
            bytes = Uint8Array.from(atob(base64Key.replace(/\s+/g, '')), function(c) { return c.charCodeAt(0); });
        } catch (e) {
            return Promise.resolve('');
        }
        return sha256Hex(bytes).then(hexToExtensionId, function() { return ''; });
    }

    // Reads the CrxFileHeader protocol buffer of a CRX3 file. Returns the
    // public keys of the RSA and ECDSA proofs and the crx_id (16 bytes), which
    // tells which of the keys belongs to the extension.
    // Wire format: https://protobuf.dev/programming-guides/encoding/
    function readCrx3Header(view, start, end) {
        var offset = start;
        var keys = [];
        var crxId = null;
        function varint() {
            var value = 0;
            var shift = 0;
            while (offset < end) {
                var b = view[offset++];
                value += (b & 0x7F) * Math.pow(2, shift);
                if (b < 0x80) return value;
                shift += 7;
                if (shift > 35) break;
            }
            throw new Error('Invalid CRX3 header.');
        }
        // Calls callback(fieldNumber, start, end) for every length-delimited
        // field between |from| and |to|; skips other fields.
        function fields(from, to, callback) {
            offset = from;
            while (offset < to) {
                var tag = varint();
                var wireType = tag % 8;
                var field = Math.floor(tag / 8);
                if (wireType === 0) {
                    varint();
                } else if (wireType === 2) {
                    var length = varint();
                    var fieldStart = offset;
                    if (fieldStart + length > to) throw new Error('Invalid CRX3 header.');
                    callback(field, fieldStart, fieldStart + length);
                    offset = fieldStart + length;
                } else if (wireType === 5) {
                    offset += 4;
                } else if (wireType === 1) {
                    offset += 8;
                } else {
                    throw new Error('Invalid CRX3 header.');
                }
            }
        }
        fields(start, end, function(field, from, to) {
            if (field === 2 || field === 3) {
                // sha256_with_rsa or sha256_with_ecdsa: AsymmetricKeyProof,
                // whose field 1 is the public key.
                fields(from, to, function(proofField, keyStart, keyEnd) {
                    if (proofField === 1) {
                        keys.push({rsa: field === 2, bytes: view.subarray(keyStart, keyEnd)});
                    }
                });
            } else if (field === 10000) {
                // signed_header_data: SignedData, whose field 1 is the crx_id.
                fields(from, to, function(dataField, idStart, idEnd) {
                    if (dataField === 1 && idEnd - idStart === 16) {
                        crxId = view.subarray(idStart, idEnd);
                    }
                });
            }
            offset = to;
        });
        return {keys: keys, crxId: crxId};
    }

    // Resolves to {zipOffset, version, publicKey, extensionId}, or rejects with
    // a message. publicKey (base64) and extensionId are '' if not found.
    function parse(arraybuffer) {
        var view = new Uint8Array(arraybuffer);
        var version = uint32(view, 4);
        if (version === 2) {
            // Magic number, version, key length, signature length, key, signature, zip.
            var keyLength = uint32(view, 8);
            var signatureLength = uint32(view, 12);
            var zipOffset = 16 + keyLength + signatureLength;
            if (zipOffset > view.length) return Promise.reject('This CRX file is incomplete.');
            var key = view.subarray(16, 16 + keyLength);
            return sha256Hex(key).then(function(hex) {
                return {zipOffset: zipOffset, version: 2, publicKey: toBase64(key), extensionId: hexToExtensionId(hex)};
            });
        }
        if (version !== 3) {
            return Promise.reject('Unsupported CRX format version ' + version + '.');
        }
        // Magic number, version, header length, header, zip.
        var headerLength = uint32(view, 8);
        var crx3ZipOffset = 12 + headerLength;
        if (crx3ZipOffset > view.length) return Promise.reject('This CRX file is incomplete.');
        var header;
        try {
            header = readCrx3Header(view, 12, crx3ZipOffset);
        } catch (e) {
            return Promise.reject(e.message);
        }
        var result = {zipOffset: crx3ZipOffset, version: 3, publicKey: '', extensionId: ''};
        if (!header.keys.length) {
            console.warn('CRX3: no public key found.');
            return Promise.resolve(result);
        }
        var expectedId = header.crxId ? toHex(header.crxId) : '';
        // The key whose hash starts with crx_id is the extension's own key; the
        // others are keys of the store. Without crx_id, prefer the first RSA key.
        return Promise.all(header.keys.map(function(k) { return sha256Hex(k.bytes); })).then(function(hashes) {
            var index = hashes.findIndex(function(hex) { return expectedId && hex.slice(0, 32) === expectedId; });
            if (index === -1) {
                console.warn('CRX3: ' + (expectedId ? 'no public key matches crx_id.' : 'crx_id not found.'));
                index = Math.max(0, header.keys.findIndex(function(k) { return k.rsa; }));
            }
            result.publicKey = toBase64(header.keys[index].bytes);
            result.extensionId = hexToExtensionId(hashes[index]);
            return result;
        });
    }

    // Resolves to {zip: Blob, crx: info or null}. Rejects with a message if the
    // data is neither a CRX file nor a zip file.
    function toZip(arraybuffer) {
        var view = new Uint8Array(arraybuffer);
        if (!isCrxData(view)) {
            if (isZipData(arraybuffer)) {
                return Promise.resolve({zip: new Blob([arraybuffer], {type: 'application/zip'}), crx: null});
            }
            return Promise.reject('This is not a browser add-on (XPI or CRX) or zip file.');
        }
        return parse(arraybuffer).then(function(info) {
            var zipData = arraybuffer.slice(info.zipOffset);
            // Opera add-ons serves CRX3 files that contain a CRX2 file instead of
            // the zip data. Keep the outer key, which is the one Opera uses.
            if (isCrxData(new Uint8Array(zipData))) {
                console.warn('Nested CRX: expected zip data, found another CRX file.');
                return toZip(zipData).then(function(inner) {
                    if (inner.crx && info.extensionId && inner.crx.extensionId !== info.extensionId) {
                        console.warn('Nested CRX: the inner file has extension ID ' + inner.crx.extensionId);
                    }
                    if (!info.publicKey && inner.crx) {
                        info.publicKey = inner.crx.publicKey;
                        info.extensionId = inner.crx.extensionId;
                    }
                    info.raw = new Blob([arraybuffer], {type: 'application/octet-stream'});
                    return {zip: inner.zip, crx: info};
                });
            }
            info.raw = new Blob([arraybuffer], {type: 'application/octet-stream'});
            return {zip: new Blob([zipData], {type: 'application/zip'}), crx: info};
        });
    }

    // Chrome update files ("gupdate" XML, the file at an extension's update_url):
    //   <gupdate><app appid="..."><updatecheck codebase="https://.../x.crx" version="1.0"/></app></gupdate>
    // Returns {codebase, version, appid} of the app (the one whose ID is in
    // |url| as x=id%3D<id>, else the first), or null if this is not one.
    // https://developer.chrome.com/docs/extensions/how-to/distribute/host-on-linux#update_manifest
    function readUpdateManifest(arraybuffer, url) {
        var head = new Uint8Array(arraybuffer, 0, Math.min(arraybuffer.byteLength, 512));
        var start = String.fromCharCode.apply(null, head).replace(/^\uFEFF/, '').trim();
        if (!/^<(\?xml|gupdate)\b/.test(start) || arraybuffer.byteLength > 1048576) return null;
        var text = new TextDecoder().decode(arraybuffer);
        if (!/<gupdate\b/.test(text)) return null;
        var apps = [];
        if (typeof DOMParser === 'function') {
            var doc = new DOMParser().parseFromString(text, 'application/xml');
            Array.prototype.forEach.call(doc.getElementsByTagName('app'), function(app) {
                var check = app.getElementsByTagName('updatecheck')[0];
                if (check && check.getAttribute('codebase')) {
                    apps.push({appid: app.getAttribute('appid') || '', codebase: check.getAttribute('codebase'),
                        version: check.getAttribute('version') || ''});
                }
            });
        }
        if (!apps.length) return null;
        var wanted = /[?&]x=id%3D([a-p]{32})/i.exec(url || '');
        var app = wanted && apps.filter(function(a) { return a.appid === wanted[1]; })[0] || apps[0];
        try {
            app.codebase = new URL(app.codebase, url).href;
        } catch (e) {
            return null;
        }
        // Keep the download on https when the update file came over https
        // (see secure_download_url in addon-urls.js).
        if (/^https:/i.test(url || '') && typeof secure_download_url === 'function') {
            app.codebase = secure_download_url(app.codebase) || app.codebase;
        }
        return /^https?:/i.test(app.codebase) ? app : null;
    }

    return {
        readUpdateManifest: readUpdateManifest,
        isCrxData: isCrxData,
        toZip: toZip,
        extensionIdFromKey: extensionIdFromKey,
    };
})();

// Calls callback(zipBlob, crxInfo). crxInfo is null for XPI and zip files, and
// for CRX files {version, publicKey, extensionId, raw}, where raw is the
// original CRX file as a Blob.
function arrayBufferToZip(arraybuffer, callback, errCallback) {
    ZenCrx.toZip(arraybuffer).then(function(result) {
        callback(result.zip, result.crx);
    }, function(error) {
        errCallback(typeof error === 'string' ? error : 'Cannot read this file: ' + error);
    });
}

/**
 * @param {string|Blob|File|ArrayBuffer} source - Add-on file data or URL.
 * @param {function(Blob, ?Object)} callback - Receives the zip file as a Blob,
 *   and for CRX files {version, publicKey, extensionId, raw}.
 * @param {function(string)} errCallback - Receives an error message.
 * @param {function(ProgressEvent)} progressListener - Download/read progress.
 */
function openAddonAsZip(source, callback, errCallback, progressListener) {
    if (!errCallback) errCallback = console.log.bind(console);
    if (source instanceof Blob) { // Blob or File
        openAddonBlobAsZip(source, callback, errCallback, progressListener);
    } else if (typeof source == 'string') {
        openAddonUrlAsZip(source, callback, errCallback, progressListener);
    } else {
        arrayBufferToZip(source, callback, errCallback);
    }
}

function openAddonBlobAsZip(blob, callback, errCallback, progressListener) {
    function readAll() {
        var fr = new FileReader();
        fr.onprogress = progressListener;
        fr.onload = function() {
            arrayBufferToZip(fr.result, callback, errCallback);
        };
        fr.onerror = function() {
            errCallback('Unexpected error while reading ' + (blob.name || 'the file'));
        };
        fr.readAsArrayBuffer(blob);
    }
    // A file that starts like a zip file is used as it is, without reading it
    // all into memory. Anything else (CRX files) is read and converted.
    var head = new FileReader();
    head.onload = function() {
        var view = new Uint8Array(head.result);
        if (view[0] === 0x50 && view[1] === 0x4b && view[2] === 0x03 && view[3] === 0x04) {
            callback(blob, null);
        } else {
            readAll();
        }
    };
    head.onerror = readAll;
    head.readAsArrayBuffer(blob.slice(0, 4));
}

// |hops| counts the Chrome update files followed so far (at most 3).
function openAddonUrlAsZip(url, callback, errCallback, progressListener, hops) {
    // Never contact an add-on site that is turned off in Settings.
    var blocked = typeof ZenStoreDomains === 'object' ? ZenStoreDomains.blockedReason(url) : '';
    if (blocked) {
        errCallback(blocked);
        return;
    }
    var x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onprogress = progressListener;
    x.onload = function() {
        // A redirect may end at an add-on site that is turned off.
        var redirected = typeof ZenStoreDomains === 'object' && x.responseURL ? ZenStoreDomains.blockedReason(x.responseURL) : '';
        if (redirected) {
            errCallback(redirected);
            return;
        }
        if (x.status >= 400) {
            errCallback('Failed to load ' + url + '. Server responded with ' + x.status + ' ' + x.statusText);
            return;
        }
        if (!x.response || !x.response.byteLength) {
            // The Chrome Web Store answers 204 (no content) for extensions that
            // are not available, e.g. removed ones or those for another platform.
            errCallback('Failed to load ' + url + '. Server did not send any response.' +
                (x.status === 204 ? ' The extension may have been removed from the store, or is not available for this platform.' : ''));
            return;
        }
        // A Chrome update file: open the .crx file it names.
        var update = ZenCrx.readUpdateManifest(x.response, x.responseURL || url);
        if (update) {
            if ((hops || 0) >= 3) {
                errCallback('Too many Chrome update files in a row, starting at ' + url);
                return;
            }
            console.log('Chrome update file: version ' + (update.version || '?') + ' of ' +
                (update.appid || 'the extension') + ' is at ' + update.codebase);
            openAddonUrlAsZip(update.codebase, function(blob, crx) {
                if (crx) {
                    crx.updateVersion = update.version;
                    crx.codebase = update.codebase;
                }
                callback(blob, crx);
            }, errCallback, progressListener, (hops || 0) + 1);
            return;
        }
        arrayBufferToZip(x.response, callback, function(err) {
            var mimeType = x.getResponseHeader('Content-Type');
            if (mimeType) {
                err += ' According to the server, the file type is ' + mimeType;
            }
            errCallback(err);
        });
    };
    x.onerror = function() {
        errCallback('Network error for ' + url);
    };
    x.send();
}
