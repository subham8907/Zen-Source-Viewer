/**
 * Copyright 2026 Subham Mahesh
 *
 * Licensed under the File-Level Permissive License (FLPL), Version 1.0
 * (the "License"). You may copy and distribute this file, with or
 * without changes, only in compliance with the License. You may obtain
 * a copy of the License in the LICENSE.txt file accompanying this work.
 *
 * Unless required by applicable law or agreed to in writing, this file
 * is distributed under the License on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See
 * the License for the specific language governing permissions and
 * limitations under the License.
 *
 * Added by Subham Mahesh, 2026: working on a folder of your computer.
 *
 *  - Opening a folder (chosen or dropped on the Open page): its files are
 *    packed into a zip in memory and shown like any add-on. .git and
 *    node_modules are left out. Nothing leaves the device.
 *  - Applying the changes in a terminal: Firefox does not let add-ons write
 *    into folders, so the changes are saved as a patch in the Downloads
 *    folder (zen-source-viewer-….patch, not in a subfolder: add-ons can
 *    delete downloaded files but not folders) and the dialog shows the command that
 *    applies it (git apply, or patch on macOS and Linux), with Copy buttons.
 *    The patch file is temporary by default: it is deleted when you choose
 *    Done, after 10 minutes, or (if the tab was closed first) the next time
 *    the viewer opens.
 *  - Reloading the folder after the command ran: the files are read from
 *    disk again and compared with the edits, so you can check that every
 *    change arrived. If some did not, the edits can be put back.
 */

/* jshint browser:true, devel:true, esversion:8 */
/* globals zip, browser, createChangesPatch, archiveBaseName, openAddonInViewer, editedFiles, addedEntries,
           getFileListItem, readCurrentBytes, applyPatchText */
/* exported ZenLocalFolder */
'use strict';

var ZenLocalFolder = (function() {
    var SKIPPED = /(?:^|\/)(?:\.git|node_modules)\/|(?:^|\/)(?:\.DS_Store|Thumbs\.db)$/;
    var TEMP_KEY = 'zen-temporary-patches';
    var TEMP_MINUTES = 10;
    var FOLDER_PATHS_KEY = 'zen-local-folder-paths';

    // The name of the folder shown, or '' when an archive is shown.
    var current = '';
    // How it was opened: {entry} for a dropped folder (which can be read
    // again directly), {} for one chosen with the folder picker.
    var source = null;

    var api = typeof browser !== 'undefined' ? browser : null;

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    // ---- Opening a folder

    // Packs [{path, file}] into a zip file named |name|.zip. |onRead(files)|
    // is called with the files that are packed. Rejects if there are none.
    function packFiles(name, files, status, onRead) {
        files = files.filter(function(item) { return item.path && !SKIPPED.test(item.path); });
        if (!files.length) {
            return Promise.reject(new Error('The folder ' + name + ' has no files (.git and node_modules are left out).'));
        }
        files.sort(function(a, b) { return a.path.localeCompare(b.path); });
        if (onRead) onRead(files);
        return new Promise(function(resolve, reject) {
            zip.createWriter(new zip.BlobWriter('application/zip'), function(writer) {
                var i = 0;
                (function addNext() {
                    if (i >= files.length) {
                        writer.close(resolve);
                        return;
                    }
                    var item = files[i++];
                    if (status && i % 25 === 0) status('Reading ' + name + ': ' + i + ' of ' + files.length + ' files\u2026');
                    writer.add(item.path, new zip.BlobReader(item.file), addNext);
                })();
            }, reject);
        }).then(function(blob) {
            var file = new File([blob], name + '.zip', {type: 'application/zip'});
            file.folderName = name;
            return file;
        });
    }

    // Packs [{path, file}] into a zip and opens it in the viewer as |name|.
    function openFiles(name, files, status, onRead) {
        return packFiles(name, files, status, onRead).then(function(blob) {
            blob._zenFolder = name;
            current = name;
            var openView = document.getElementById('advanced-open');
            if (openView) openView.classList.remove('visible');
            openAddonInViewer('', name + '.zip', blob);
        }).catch(function(error) {
            alert('Could not read the folder ' + name + ': ' + (error && error.message || error));
        });
    }

    // The files of <input type="file" webkitdirectory> as {name, files}:
    // their paths start with the folder name, which is removed.
    function fileListItems(fileList) {
        var list = Array.prototype.slice.call(fileList || []);
        if (!list.length) return null;
        return {
            name: (list[0].webkitRelativePath || list[0].name).split('/')[0],
            files: list.map(function(file) {
                var path = file.webkitRelativePath || file.name;
                return {path: path.slice(path.indexOf('/') + 1), file: file};
            }),
        };
    }

    function openFileList(fileList, status, onRead) {
        var items = fileListItems(fileList);
        if (!items) return Promise.resolve();
        var name = items.name;
        return openFiles(name, items.files, status, onRead).then(function() {
            if (current === name) source = {};
        });
    }

    // Reads every file below a dropped directory entry.
    function readEntries(entry, prefix, out) {
        if (entry.isFile) {
            return new Promise(function(resolve) {
                entry.file(function(file) {
                    out.push({path: prefix + entry.name, file: file});
                    resolve();
                }, function() { resolve(); });
            });
        }
        var path = prefix + entry.name + '/';
        if (SKIPPED.test(path)) return Promise.resolve();
        var reader = entry.createReader();
        return new Promise(function(resolve) {
            var children = [];
            (function readBatch() {
                reader.readEntries(function(batch) {
                    if (!batch.length) {
                        resolve(children);
                        return;
                    }
                    children = children.concat(Array.prototype.slice.call(batch));
                    readBatch();
                }, function() { resolve(children); });
            })();
        }).then(function(children) {
            return children.reduce(function(chain, child) {
                return chain.then(function() { return readEntries(child, path, out); });
            }, Promise.resolve());
        });
    }

    // The dropped folder of a drop event, or null if a file was dropped.
    function droppedFolder(dataTransfer) {
        var item = dataTransfer && dataTransfer.items && dataTransfer.items[0];
        var entry = item && item.webkitGetAsEntry && item.webkitGetAsEntry();
        return entry && entry.isDirectory ? entry : null;
    }

    // The files below a dropped folder, with paths relative to it.
    function droppedItems(entry) {
        var files = [];
        return readEntries(entry, '', files).then(function() {
            var prefix = entry.name + '/';
            return files.map(function(item) {
                return {path: item.path.slice(prefix.length), file: item.file};
            });
        });
    }

    function openDroppedFolder(entry, status, onRead) {
        if (status) status('Reading ' + entry.name + '\u2026');
        return droppedItems(entry).then(function(files) {
            return openFiles(entry.name, files, status, onRead).then(function() {
                if (current === entry.name) source = {entry: entry};
            });
        });
    }

    // For other pages (Compare): a chosen file list or a dropped folder
    // entry, packed into a zip File (with .folderName).
    function packFolder(fileListOrEntry, status) {
        if (fileListOrEntry && fileListOrEntry.isDirectory) {
            if (status) status('Reading ' + fileListOrEntry.name + '\u2026');
            return droppedItems(fileListOrEntry).then(function(files) {
                return packFiles(fileListOrEntry.name, files, status);
            });
        }
        var items = fileListItems(fileListOrEntry);
        if (!items) return Promise.reject(new Error('No folder was chosen.'));
        return packFiles(items.name, items.files, status);
    }

    // Called when an archive or URL is opened instead of a folder.
    function clear() {
        current = '';
        source = null;
    }

    // ---- Reloading the folder to check the changes

    // What the edited files should now contain on disk: path -> bytes, or
    // null for a removed file.
    function expectedFiles() {
        var paths = Array.from(editedFiles.keys());
        return Promise.all(paths.map(function(path) {
            var entry = (getFileListItem(path) || {}).zipEntry || addedEntries.get(path);
            return entry ? readCurrentBytes(entry) : Promise.resolve(null);
        })).then(function(contents) {
            var expected = new Map();
            paths.forEach(function(path, i) { expected.set(path, contents[i]); });
            return expected;
        });
    }

    function sameBytes(a, b) {
        if (a.length !== b.length) return false;
        for (var i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) return false;
        }
        return true;
    }

    // Compares the files read from disk with |expected|. Resolves to a list
    // of {path, problem} for the changes that did not arrive.
    function compare(expected, files) {
        var byPath = new Map(files.map(function(item) { return [item.path, item.file]; }));
        return Promise.all(Array.from(expected.keys()).map(function(path) {
            var want = expected.get(path);
            var file = byPath.get(path);
            if (want === null) {
                return file ? {path: path, problem: 'is still in the folder (it should be deleted)'} : null;
            }
            if (!file) return {path: path, problem: 'is not in the folder'};
            return file.arrayBuffer().then(function(buffer) {
                return sameBytes(new Uint8Array(buffer), want) ? null :
                    {path: path, problem: 'differs from your edit (the change was not applied, or the file changed since)'};
            });
        })).then(function(results) {
            return results.filter(Boolean);
        });
    }

    var reloadInput = null;

    // Reads the folder from disk again and shows whether every change
    // arrived. Must be called from a click: a folder chosen with the picker
    // has to be chosen again (browsers do not allow reading it again).
    function reload() {
        if (!current) return;
        var name = current;
        var edits = editedFiles.size;
        var patchPromise = edits ? createChangesPatch() : Promise.resolve('');
        var expectedPromise = expectedFiles();
        function opened(files) {
            Promise.all([expectedPromise, patchPromise]).then(function(values) {
                var expected = values[0];
                if (!expected.size) return;
                compare(expected, files).then(function(problems) {
                    showCheck(name, expected.size, problems, values[1]);
                });
            });
        }
        if (source && source.entry) {
            openDroppedFolder(source.entry, null, opened);
            return;
        }
        if (!reloadInput) {
            reloadInput = el('input');
            reloadInput.type = 'file';
            reloadInput.webkitdirectory = true;
            reloadInput.hidden = true;
            document.body.appendChild(reloadInput);
        }
        reloadInput.onchange = function() {
            var list = reloadInput.files;
            if (!list.length) return;
            var chosen = (list[0].webkitRelativePath || '').split('/')[0];
            if (chosen !== name && !confirm('You chose the folder ' + chosen + ', not ' + name +
                '. Open it and compare it with your edits anyway?')) {
                reloadInput.value = '';
                return;
            }
            openFileList(list, null, opened);
            reloadInput.value = '';
        };
        reloadInput.click();
    }

    // The result of a reload: every change arrived, or which did not (with
    // a way to put the edits back in the viewer).
    function showCheck(name, count, problems, patch) {
        var dialog = el('dialog', 'lf-dialog');
        var form = el('form', 'lf-form');
        form.method = 'dialog';
        var title = el('h2', 'lf-title', problems.length ? 'Some changes are not in ' + name :
            'All changes are in ' + name);
        title.id = 'lf-check-title';
        dialog.setAttribute('aria-labelledby', title.id);
        form.appendChild(title);
        if (!problems.length) {
            form.appendChild(el('p', 'lf-intro', 'The folder was read again from disk: ' + (count === 1 ?
                'the changed file matches' : 'all ' + count + ' changed files match') +
                ' your edits. The viewer now shows the folder as it is on disk.'));
        } else {
            form.appendChild(el('p', 'lf-intro', 'The folder was read again from disk. ' + (count === 1 ?
                'The changed file does not match your edit:' : (count - problems.length) + ' of ' + count +
                ' changed files match your edits; these do not:')));
            var list = el('ul', 'lf-problems');
            problems.forEach(function(problem) {
                var li = el('li');
                li.append(el('code', '', problem.path), ' ' + problem.problem);
                list.appendChild(li);
            });
            form.appendChild(list);
            form.appendChild(el('p', 'lf-hint', 'Your edits were replaced by the files on disk. Put them back to try ' +
                'again: they are applied to the reloaded files, like a patch.'));
        }
        var buttons = el('div', 'lf-buttons');
        if (problems.length && patch) {
            var restore = el('button', '', 'Put my edits back');
            restore.type = 'submit';
            restore.value = 'restore';
            buttons.appendChild(restore);
        }
        var ok = el('button', 'lf-primary', 'OK');
        ok.type = 'submit';
        ok.value = 'ok';
        buttons.appendChild(ok);
        form.appendChild(buttons);
        dialog.appendChild(form);
        document.body.appendChild(dialog);
        dialog.addEventListener('close', function() {
            dialog.remove();
            if (dialog.returnValue === 'restore') applyPatchText(patch, 'your edits');
        });
        dialog.showModal();
    }

    // ---- Temporary patch files

    function readTemporary() {
        try {
            return JSON.parse(localStorage.getItem(TEMP_KEY) || '[]');
        } catch (e) {
            return [];
        }
    }
    function writeTemporary(list) {
        try {
            localStorage.setItem(TEMP_KEY, JSON.stringify(list));
        } catch (e) {
            // The file is still deleted while this tab is open.
        }
    }

    // Deletes a downloaded patch file and forgets the download.
    function deleteDownload(id) {
        writeTemporary(readTemporary().filter(function(item) { return item.id !== id; }));
        if (!api || !api.downloads) return Promise.resolve();
        return api.downloads.removeFile(id).catch(function() {
            // Already deleted or moved.
        }).then(function() {
            return api.downloads.erase({id: id});
        }).catch(function() {});
    }

    // Deletes temporary patch files left by tabs that were closed in time.
    function cleanUpTemporary() {
        var now = Date.now();
        readTemporary().forEach(function(item) {
            if (now - item.created > TEMP_MINUTES * 60000) deleteDownload(item.id);
        });
    }

    // Saves |text| directly in the Downloads folder (a subfolder would stay
    // behind: add-ons can delete downloaded files, not folders) and resolves to
    // {id, path} once the file is written.
    function saveToDownloads(text, filename) {
        if (!api || !api.downloads) return Promise.reject(new Error('Downloads are not available.'));
        var url = URL.createObjectURL(new Blob([text], {type: 'text/x-diff'}));
        return api.downloads.download({
            url: url,
            filename: 'zen-source-viewer-' + filename,
            conflictAction: 'uniquify',
            saveAs: false,
        }).then(function(id) {
            return new Promise(function(resolve, reject) {
                function check() {
                    api.downloads.search({id: id}).then(function(items) {
                        var item = items[0];
                        if (!item) {
                            finish(reject, new Error('The download disappeared.'));
                        } else if (item.state === 'complete') {
                            finish(resolve, {id: id, path: item.filename});
                        } else if (item.state === 'interrupted') {
                            finish(reject, new Error('The download failed: ' + (item.error || 'interrupted')));
                        }
                    });
                }
                function onChanged(delta) {
                    if (delta.id === id && delta.state) check();
                }
                function finish(callback, value) {
                    api.downloads.onChanged.removeListener(onChanged);
                    URL.revokeObjectURL(url);
                    callback(value);
                }
                api.downloads.onChanged.addListener(onChanged);
                check();
            });
        });
    }

    // ---- The terminal dialog

    function quote(path, windows) {
        return windows ? '"' + path.replace(/"/g, '""') + '"' : "'" + path.replace(/'/g, "'\\''") + "'";
    }

    function isWindows(path) {
        return /^[A-Za-z]:\\|^\\\\/.test(path || '') || /^Win/.test(navigator.platform);
    }

    function readFolderPaths() {
        try {
            return JSON.parse(localStorage.getItem(FOLDER_PATHS_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    // A command line with a Copy button.
    function commandBlock(label) {
        var block = el('div', 'lf-command');
        block.appendChild(el('div', 'lf-command-label', label));
        var row = el('div', 'lf-command-row');
        var code = el('pre', 'lf-command-text');
        var copy = el('button', 'lf-copy', 'Copy');
        copy.type = 'button';
        copy.onclick = function() {
            navigator.clipboard.writeText(code.textContent).then(function() {
                copy.textContent = 'Copied';
                setTimeout(function() { copy.textContent = 'Copy'; }, 1500);
            }, function() {
                // Select the text so that it can be copied by hand.
                var range = document.createRange();
                range.selectNodeContents(code);
                window.getSelection().removeAllRanges();
                window.getSelection().addRange(range);
            });
        };
        row.append(code, copy);
        block.appendChild(row);
        return {block: block, set: function(text) { code.textContent = text; }};
    }

    // Saves the changes as a (temporary) patch and shows how to apply it in
    // a terminal, in the folder that was opened (or any copy of the add-on).
    function applyInTerminal() {
        createChangesPatch().then(function(patch) {
            if (!patch) {
                alert('There are no changes to apply.');
                return;
            }
            showDialog(patch);
        }).catch(function(error) {
            alert('Could not create the patch: ' + (error && error.message || error));
        });
    }

    function showDialog(patch) {
        var folder = current || archiveBaseName();
        var binary = /^GIT binary patch$/m.test(patch);
        var dialog = el('dialog', 'lf-dialog');
        var form = el('form', 'lf-form');
        form.method = 'dialog';
        var title = el('h2', 'lf-title', current ? 'Save your changes to ' + folder : 'Apply your changes in a terminal');
        title.id = 'lf-title';
        dialog.setAttribute('aria-labelledby', title.id);
        form.appendChild(title);
        form.appendChild(el('p', 'lf-intro', 'Firefox does not let add-ons write into your folders. Your changes are ' +
            'saved as a patch file in your Downloads folder instead; one command in a terminal then writes them into ' +
            (current ? 'the folder ' + folder : 'your copy of ' + folder) + '.'));

        var status = el('p', 'lf-status', 'Saving the patch file\u2026');
        form.appendChild(status);

        var temporary = el('label', 'lf-option');
        var temporaryCheck = el('input');
        temporaryCheck.type = 'checkbox';
        temporaryCheck.checked = true;
        temporary.append(temporaryCheck, ' Temporary: delete the patch file when I close this dialog (or after ' +
            TEMP_MINUTES + ' minutes)');
        form.appendChild(temporary);

        var folderLabel = el('label', 'lf-field-label', 'Folder path (optional, adds the cd command)');
        var folderInput = el('input', 'lf-field');
        folderInput.type = 'text';
        folderInput.spellcheck = false;
        folderInput.placeholder = isWindows() ? 'C:\\Users\\you\\projects\\' + folder : '~/projects/' + folder;
        folderInput.value = readFolderPaths()[folder] || '';
        folderInput.id = 'lf-folder-path';
        folderLabel.htmlFor = folderInput.id;
        form.append(folderLabel, folderInput);
        form.appendChild(el('p', 'lf-hint', 'Or open a terminal in the folder: in Finder, right-click it and choose ' +
            'New Terminal at Folder; in Windows Explorer, right-click it and choose Open in Terminal; in most Linux ' +
            'file managers, Open in Terminal.'));

        var check = commandBlock('1. Check that the patch fits (changes nothing)');
        var apply = commandBlock('2. Apply it');
        var plain = binary ? null : commandBlock('Without Git (macOS, Linux)');
        form.append(check.block, apply.block);
        if (plain) form.appendChild(plain.block);
        form.appendChild(el('p', 'lf-hint', 'git apply works in any folder, not only in Git repositories. Run the ' +
            'commands in the folder that has manifest.json at the same place as in the viewer.'));

        var buttons = el('div', 'lf-buttons');
        if (current) {
            var reloadButton = el('button', '', 'Reload folder to check');
            reloadButton.type = 'button';
            reloadButton.title = 'After running the command: read ' + folder + ' from disk again and check that ' +
                'every change arrived';
            reloadButton.onclick = function() {
                dialog.close('reload');
                reload();
            };
            buttons.appendChild(reloadButton);
        }
        var show = el('button', '', 'Show in folder');
        show.type = 'button';
        show.disabled = true;
        var done = el('button', 'lf-primary', 'Done');
        done.type = 'submit';
        done.value = 'done';
        buttons.append(show, done);
        form.appendChild(buttons);
        dialog.appendChild(form);
        document.body.appendChild(dialog);

        var download = null;
        var timer = null;
        function update() {
            var path = download ? download.path : 'zen-source-viewer-' + folder + '-changes.patch';
            var windows = isWindows(download && download.path);
            var dir = folderInput.value.trim();
            var cd = dir ? (windows ? 'cd ' + quote(dir, true) : 'cd ' + (/^~\//.test(dir) ?
                '~/' + quote(dir.slice(2), false) : quote(dir, false))) + '\n' : '';
            check.set(cd + 'git apply --check ' + quote(path, windows));
            apply.set(cd + 'git apply ' + quote(path, windows));
            if (plain) plain.set(cd + 'patch -p1 < ' + quote(path, false));
        }
        folderInput.oninput = function() {
            var paths = readFolderPaths();
            if (folderInput.value.trim()) paths[folder] = folderInput.value.trim(); else delete paths[folder];
            try {
                localStorage.setItem(FOLDER_PATHS_KEY, JSON.stringify(paths));
            } catch (e) {
                // Only a convenience.
            }
            update();
        };
        function remember() {
            var list = readTemporary().filter(function(item) { return item.id !== download.id; });
            if (temporaryCheck.checked) list.push({id: download.id, created: Date.now()});
            writeTemporary(list);
        }
        temporaryCheck.onchange = function() {
            if (download) remember();
        };
        show.onclick = function() {
            if (download) api.downloads.show(download.id);
        };
        update();

        saveToDownloads(patch, folder + '-changes.patch').then(function(result) {
            download = result;
            status.textContent = 'Saved: ' + result.path;
            show.disabled = false;
            remember();
            update();
            timer = setTimeout(function() {
                if (temporaryCheck.checked && dialog.open) {
                    deleteDownload(download.id);
                    status.textContent = 'The temporary patch file was deleted after ' + TEMP_MINUTES +
                        ' minutes. Close this dialog and save it again if you still need it.';
                }
            }, TEMP_MINUTES * 60000);
        }, function(error) {
            status.textContent = 'Could not save the patch file (' + (error && error.message || error) +
                '). Use Patch in the Changes panel to download it, then use these commands with its path.';
            status.classList.add('is-error');
        });

        dialog.addEventListener('close', function() {
            clearTimeout(timer);
            if (download && temporaryCheck.checked) deleteDownload(download.id);
            dialog.remove();
        });
        dialog.showModal();
    }

    cleanUpTemporary();

    return {
        openFileList: openFileList,
        packFolder: packFolder,
        droppedFolder: droppedFolder,
        openDroppedFolder: openDroppedFolder,
        applyInTerminal: applyInTerminal,
        reload: reload,
        clear: clear,
        isFolder: function() { return !!current; },
        name: function() { return current; },
    };
})();
