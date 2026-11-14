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
 * Added by Subham Mahesh, 2026: helpers for the review tools of the viewer.
 *
 *  - ZenMainView shows a view (a report, the notes, ...) in the main panel
 *    instead of a file, like the locale diff does. Opening a file replaces it.
 *  - ZenFiles lists the files of the opened add-on, reads their current text
 *    (with edits), opens a file at a line, and identifies the archive.
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals editedFiles, getFileListItem, readCurrentText, openFileFromList, viewFileInfo */
'use strict';

var ZenMainView = (function() {
    var current = null; // {id, onHide}

    function onSourceViewHide() {
        var code = document.getElementById('source-code');
        code.removeEventListener('sourceviewhide', onSourceViewHide);
        code.classList.remove('has-main-view');
        delete code.dataset.mainView;
        var hidden = current;
        current = null;
        if (hidden && hidden.onHide) hidden.onHide();
        document.dispatchEvent(new CustomEvent('zen-main-view', {detail: null}));
    }

    /**
     * Shows a view in the main panel. render(toolbar, body) fills the two
     * elements. Calling show() again with the same id re-renders it.
     */
    function show(id, render, onHide) {
        var toolbar = document.getElementById('source-toolbar');
        var code = document.getElementById('source-code');
        if (current) {
            var previous = current;
            current = null;
            if (previous.onHide) previous.onHide();
        } else {
            code.dispatchEvent(new CustomEvent('sourceviewhide'));
            if (viewFileInfo.forgetCurrentEntry) viewFileInfo.forgetCurrentEntry();
            Array.prototype.forEach.call(document.querySelectorAll('#file-list li.file-selected'), function(li) {
                li.classList.remove('file-selected');
            });
            code.addEventListener('sourceviewhide', onSourceViewHide);
        }
        current = {id: id, onHide: onHide};
        toolbar.textContent = '';
        code.textContent = '';
        code.dataset.filename = '';
        code.dataset.mainView = id;
        code.scrollTop = 0;
        code.classList.add('has-main-view');
        render(toolbar, code);
        document.dispatchEvent(new CustomEvent('zen-main-view', {detail: id}));
    }

    function currentId() {
        return current ? current.id : null;
    }

    return {show: show, currentId: currentId};
})();

var ZenFiles = (function() {
    var archiveKey = null;
    var archiveKeyPromise = Promise.resolve(null);

    // Called by viewer.js for each opened archive: identifies it by the
    // SHA-256 of its bytes (e.g. to keep review notes per add-on file).
    function setArchiveBlob(blob) {
        archiveKey = null;
        archiveKeyPromise = blob.arrayBuffer().then(function(buffer) {
            return crypto.subtle.digest('SHA-256', buffer);
        }).then(function(digest) {
            archiveKey = Array.from(new Uint8Array(digest), function(b) {
                return b.toString(16).padStart(2, '0');
            }).join('');
            document.dispatchEvent(new CustomEvent('zen-archive', {detail: archiveKey}));
            return archiveKey;
        }).catch(function() {
            return null;
        });
    }

    // The files of the opened add-on (not removed by an edit or patch).
    function list() {
        return Array.prototype.filter.call(document.querySelectorAll('#file-list li[data-filename]'), function(li) {
            return !li.classList.contains('file-removed') && li.zipEntry;
        }).map(function(li) {
            return {filename: li.dataset.filename, entry: li.zipEntry, size: li.zipEntry.uncompressedSize || 0};
        });
    }

    function extension(filename) {
        var match = /\.([a-z0-9]+)$/i.exec(filename);
        return match ? match[1].toLowerCase() : '';
    }
    function isCode(filename) {
        return /^(js|mjs|cjs|jsm|ts|html|htm|xhtml|css|json)$/.test(extension(filename));
    }

    // Reads the current text of many files, a few at a time, so the page
    // stays responsive. onProgress(done, total). Resolves to [{filename, text}].
    function readAll(files, onProgress) {
        var results = [];
        var index = 0;
        return new Promise(function(resolve) {
            (function next() {
                if (index >= files.length) {
                    resolve(results);
                    return;
                }
                var file = files[index++];
                readCurrentText(file.entry).then(function(text) {
                    if (typeof text === 'string') results.push({filename: file.filename, text: text});
                }, function() {}).then(function() {
                    if (onProgress && index % 10 === 0) onProgress(index, files.length);
                    setTimeout(next, 0);
                });
            })();
        });
    }

    // 1-based line numbers for offsets in a text.
    function lineIndex(text) {
        var starts = [0];
        for (var i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
        return {
            lineAt: function(offset) {
                var lo = 0, hi = starts.length - 1;
                while (lo < hi) {
                    var mid = (lo + hi + 1) >> 1;
                    if (starts[mid] <= offset) lo = mid;
                    else hi = mid - 1;
                }
                return lo + 1;
            },
            lineText: function(line) {
                var start = starts[line - 1];
                if (start === undefined) return '';
                var end = line < starts.length ? starts[line] - 1 : text.length;
                return text.slice(start, end);
            },
        };
    }

    // Opens a file of the add-on and moves the cursor to a line.
    function openAt(filename, line) {
        if (!getFileListItem(filename)) return;
        openFileFromList(filename);
        if (!line) return;
        var tries = 0;
        (function scroll() {
            var selected = document.querySelector('#file-list li.file-selected');
            var editor = window.currentCodeEditor;
            if (editor && editor.scrollToLine && selected && selected.dataset.filename === filename) {
                editor.scrollToLine(line);
                if (editor.view) editor.view.focus();
            } else if (++tries < 40) {
                setTimeout(scroll, 75);
            }
        })();
    }

    function selectedFilename() {
        var selected = document.querySelector('#file-list li.file-selected');
        return selected ? selected.dataset.filename : null;
    }

    function downloadText(text, filename, type) {
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], {type: type || 'text/plain;charset=utf-8'}));
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
    }

    function archiveName() {
        var name = (document.getElementById('download-link') || {}).download || 'extension.zip';
        return name.replace(/\.(zip|xpi)$/i, '');
    }

    return {
        setArchiveBlob: setArchiveBlob,
        archiveKey: function() { return archiveKey; },
        whenArchiveKey: function() { return archiveKeyPromise; },
        list: list,
        isCode: isCode,
        extension: extension,
        readAll: readAll,
        lineIndex: lineIndex,
        openAt: openAt,
        selectedFilename: selectedFilename,
        downloadText: downloadText,
        archiveName: archiveName,
        isEdited: function(filename) { return editedFiles.has(filename); },
    };
})();
