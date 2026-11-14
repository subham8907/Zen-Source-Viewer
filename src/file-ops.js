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
 * Added by Subham Mahesh, 2026: create, rename and delete files and folders
 * of the opened add-on, like in a file explorer.
 *
 *  - "New file" / "New folder" above the folder tree, or right-click a folder.
 *  - Right-click a file to rename it (also to another extension, e.g. .js to
 *    .mjs or .txt to .md) or delete it; F2 renames the selected file.
 *  - Right-click a folder to rename or delete it with everything in it.
 *
 * Changes are made like the changes of a patch: a new file is "added", a
 * deleted file "removed", a renamed file is removed under its old name and
 * added under the new one. They appear in the Changes panel, in patches and
 * in the edited zip, and can be reverted there.
 */

/* jshint browser:true, devel:true, esversion:8 */
/* globals addedEntries, editedFiles, archiveEntries, getFileListItem, createAddedEntry, createPatchChange,
           createBinaryChange, addBinaryFile, setFileEdited, rebuildFileTree, readCurrentBytes, readEntryText,
           openFileFromList, revealInFileTree, editorPrefs, fileTreeCollapsedFolders, updateFileTree */
'use strict';

var ZenFileOps = (function() {
    function el(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    // ---- Paths

    // Checks a file or folder name typed by the user. Returns an error text, or ''.
    function nameError(name) {
        if (!name) return 'Enter a name.';
        if (/[\\:*?"<>|]/.test(name)) return 'A name cannot contain \\ : * ? " < > |';
        if (name.split('/').some(function(part) { return part === '' || part === '.' || part === '..'; })) {
            return 'Use names without empty parts, "." or "..".';
        }
        return '';
    }

    // Files that are currently in the add-on (not removed).
    function currentFiles() {
        return Array.prototype.filter.call(document.querySelectorAll('#file-list li[data-filename]'), function(li) {
            return !li.classList.contains('file-removed');
        }).map(function(li) { return li.dataset.filename; });
    }
    function fileExists(path) {
        var li = getFileListItem(path);
        return !!li && !li.classList.contains('file-removed');
    }
    function folderExists(path) {
        var prefix = path.replace(/\/?$/, '/');
        return currentFiles().some(function(file) { return file.indexOf(prefix) === 0; }) ||
            addedEntries.has(prefix);
    }

    function isBinary(path, bytes) {
        if (/\.(png|jpe?g|gif|webp|ico|bmp|avif|woff2?|ttf|otf|eot|wasm|zip|xpi|jar|mp3|ogg|mp4|webm|pdf)$/i.test(path)) {
            return true;
        }
        for (var i = 0; i < Math.min(bytes.length, 8000); i++) {
            if (bytes[i] === 0) return true;
        }
        return false;
    }

    // ---- Dialog

    // Asks for a name. check(value) returns an error text or ''. Resolves to the
    // value, or null if cancelled.
    function ask(title, description, initial, check, selectBase) {
        return new Promise(function(resolve) {
            var dialog = el('dialog', 'fileop-dialog');
            var form = el('form');
            form.appendChild(el('h3', '', title));
            if (description) form.appendChild(el('p', 'fileop-description', description));
            var input = el('input', 'fileop-input');
            input.type = 'text';
            input.value = initial;
            input.spellcheck = false;
            input.setAttribute('aria-label', title);
            form.appendChild(input);
            var error = el('p', 'fileop-error');
            error.setAttribute('role', 'alert');
            form.appendChild(error);
            var buttons = el('div', 'fileop-buttons');
            var ok = el('button', 'primary', 'OK');
            ok.type = 'submit';
            var cancel = el('button', '', 'Cancel');
            cancel.type = 'button';
            buttons.append(ok, cancel);
            form.appendChild(buttons);
            // Finishes once, without relying on the dialog's close event.
            var finished = false;
            function finish(value) {
                if (finished) return;
                finished = true;
                if (dialog.open) dialog.close();
                dialog.remove();
                resolve(value);
            }
            cancel.onclick = function() { finish(null); };
            dialog.addEventListener('cancel', function(event) {
                event.preventDefault();
                finish(null);
            });
            form.onsubmit = function(event) {
                event.preventDefault();
                var value = input.value.trim().replace(/^\/+/, '');
                var message = check(value);
                if (message) {
                    error.textContent = message;
                    input.focus();
                    return;
                }
                finish(value);
            };
            input.oninput = function() { error.textContent = ''; };
            dialog.appendChild(form);
            dialog.onclose = function() { finish(null); };
            document.body.appendChild(dialog);
            dialog.showModal();
            input.focus();
            // Select the name without the folder and (for files) the extension, like file explorers.
            var start = selectBase ? initial.lastIndexOf('/') + 1 : initial.length;
            var dot = initial.lastIndexOf('.');
            var end = selectBase && dot > start ? dot : initial.length;
            input.setSelectionRange(start, end);
        });
    }

    // ---- Operations

    function afterChange(selectPath) {
        rebuildFileTree();
        if (selectPath) {
            revealInFileTree(selectPath);
            openFileFromList(selectPath);
        }
    }

    function addTextFile(path, text) {
        var entry = createAddedEntry(path, text);
        entry._addedChange = createPatchChange(entry, 'added', null, text);
        addedEntries.set(path, entry);
        editedFiles.set(path, entry._addedChange);
    }

    // Removes a file: files added in the viewer disappear, files of the
    // add-on are marked as removed (like a patch that deletes them).
    async function removeFile(path) {
        var li = getFileListItem(path);
        if (!li || !li.zipEntry) return;
        var entry = li.zipEntry;
        if (entry._isAdded) {
            if (entry._addedChange) {
                entry._addedChange.revert();
            } else {
                addedEntries.delete(path);
                editedFiles.delete(path);
            }
            return;
        }
        var bytes = await readCurrentBytes(entry);
        if (bytes && isBinary(path, bytes)) {
            setFileEdited(entry, createBinaryChange(entry, 'removed', null));
        } else {
            setFileEdited(entry, createPatchChange(entry, 'removed', await readEntryText(entry), null));
        }
    }

    // Moves a file to a new path, with its current content (and edits).
    async function moveFile(from, to) {
        var li = getFileListItem(from);
        if (!li || !li.zipEntry) return;
        var bytes = await readCurrentBytes(li.zipEntry);
        if (bytes === null) return;
        await removeFile(from);
        if (isBinary(from, bytes) || isBinary(to, bytes)) {
            addBinaryFile(to, bytes);
        } else {
            addTextFile(to, new TextDecoder().decode(bytes));
        }
        document.dispatchEvent(new CustomEvent('zen-file-renamed', {detail: {from: from, to: to}}));
    }

    function createFile(folder) {
        folder = folder || '';
        return ask('New file', 'Name of the new file' + (folder ? ' in ' + folder : '') +
            '. Use / to put it in a new folder, e.g. "js/helper.js".', folder, function(value) {
            var error = nameError(value);
            if (error) return error;
            if (fileExists(value)) return 'A file with this name already exists.';
            if (folderExists(value)) return 'A folder with this name already exists.';
            return '';
        }).then(function(path) {
            if (!path) return;
            addTextFile(path, '');
            afterChange(path);
            // Ready to type.
            var tries = 0;
            (function edit() {
                var toggle = document.querySelector('#source-toolbar .toggle-edit');
                if (toggle && window.currentCodeEditor) {
                    if (!editorPrefs.editable) toggle.click();
                    window.currentCodeEditor.view.focus();
                } else if (++tries < 30) {
                    setTimeout(edit, 100);
                }
            })();
        });
    }

    function createFolder(parent) {
        parent = parent || '';
        return ask('New folder', 'Name of the new folder' + (parent ? ' in ' + parent : '') + '.', parent,
            function(value) {
                var error = nameError(value.replace(/\/$/, ''));
                if (error) return error;
                if (fileExists(value.replace(/\/$/, ''))) return 'A file with this name already exists.';
                if (folderExists(value)) return 'This folder already exists.';
                return '';
            }).then(function(path) {
            if (!path) return;
            var folder = path.replace(/\/?$/, '/');
            addedEntries.set(folder, {filename: folder, directory: true, _isUserFolder: true, uncompressedSize: 0});
            fileTreeCollapsedFolders.delete(folder);
            afterChange();
            var row = document.querySelector('#file-list li.folder-row[data-folder="' + folder.replace(/"/g, '\\"') + '"]');
            if (row) row.scrollIntoView({block: 'nearest'});
        });
    }

    function renameFile(path) {
        return ask('Rename file', 'New name or path. Change the extension to change the file type, ' +
            'e.g. notes.txt → notes.md.', path, function(value) {
            var error = nameError(value);
            if (error) return error;
            if (value === path) return 'Enter a different name.';
            if (fileExists(value)) return 'A file with this name already exists.';
            if (folderExists(value)) return 'A folder with this name already exists.';
            return '';
        }, true).then(async function(to) {
            if (!to) return;
            await moveFile(path, to);
            afterChange(to);
        });
    }

    function deleteFile(path) {
        if (!confirm('Delete ' + path + '? You can undo this in the Changes panel.')) return Promise.resolve();
        return removeFile(path).then(function() { afterChange(); });
    }

    function filesIn(folder) {
        return currentFiles().filter(function(file) { return file.indexOf(folder) === 0; });
    }
    function userFoldersIn(folder) {
        return Array.from(addedEntries.keys()).filter(function(key) {
            return key.indexOf(folder) === 0 && addedEntries.get(key)._isUserFolder;
        });
    }

    function renameFolder(folder) {
        var current = folder.replace(/\/$/, '');
        return ask('Rename folder', 'New name or path of the folder. Everything in it moves too.', current,
            function(value) {
                var error = nameError(value);
                if (error) return error;
                if (value === current) return 'Enter a different name.';
                if (fileExists(value) || folderExists(value)) return 'A file or folder with this name already exists.';
                if ((value + '/').indexOf(folder) === 0) return 'A folder cannot be moved into itself.';
                return '';
            }, true).then(async function(to) {
            if (!to) return;
            var target = to + '/';
            var files = filesIn(folder);
            for (var i = 0; i < files.length; i++) {
                await moveFile(files[i], target + files[i].slice(folder.length));
            }
            userFoldersIn(folder).forEach(function(key) {
                addedEntries.delete(key);
                var moved = target + key.slice(folder.length);
                addedEntries.set(moved, {filename: moved, directory: true, _isUserFolder: true, uncompressedSize: 0});
            });
            if (!files.length && !userFoldersIn(target).length) {
                addedEntries.set(target, {filename: target, directory: true, _isUserFolder: true, uncompressedSize: 0});
            }
            afterChange();
        });
    }

    async function deleteFolder(folder) {
        var files = filesIn(folder);
        if (!confirm('Delete the folder ' + folder + (files.length ? ' and the ' + files.length + ' file' +
            (files.length === 1 ? '' : 's') + ' in it' : '') + '? You can undo this in the Changes panel.')) return;
        for (var i = 0; i < files.length; i++) await removeFile(files[i]);
        userFoldersIn(folder).forEach(function(key) { addedEntries.delete(key); });
        afterChange();
    }

    // ---- Context menu

    var menu = null;
    function closeMenu() {
        if (menu) menu.remove();
        menu = null;
    }
    function showMenu(x, y, items) {
        closeMenu();
        menu = el('div', 'fileop-menu');
        menu.setAttribute('role', 'menu');
        items.forEach(function(item) {
            if (item === '-') {
                menu.appendChild(el('div', 'fileop-menu-separator'));
                return;
            }
            var button = el('button', 'fileop-menu-item' + (item.danger ? ' is-danger' : ''));
            button.type = 'button';
            button.setAttribute('role', 'menuitem');
            button.append(el('span', '', item.label), el('span', 'fileop-menu-key', item.key || ''));
            button.onclick = function() {
                closeMenu();
                item.run();
            };
            menu.appendChild(button);
        });
        document.body.appendChild(menu);
        var rect = menu.getBoundingClientRect();
        menu.style.left = Math.min(x, innerWidth - rect.width - 8) + 'px';
        menu.style.top = Math.min(y, innerHeight - rect.height - 8) + 'px';
        menu.querySelector('button').focus();
    }

    function onContextMenu(event) {
        var fileList = document.getElementById('file-list');
        if (!fileList || !fileList.contains(event.target) && event.target !== fileList) return;
        var fileRow = event.target.closest('li[data-filename]');
        var folderRow = event.target.closest('li.folder-row');
        event.preventDefault();
        if (fileRow && !fileRow.classList.contains('file-removed')) {
            var path = fileRow.dataset.filename;
            var folder = path.slice(0, path.lastIndexOf('/') + 1);
            showMenu(event.clientX, event.clientY, [
                {label: 'Rename…', key: 'F2', run: function() { renameFile(path); }},
                {label: 'Delete', danger: true, run: function() { deleteFile(path); }},
                '-',
                {label: 'New file' + (folder ? ' in ' + folder : '') + '…', run: function() { createFile(folder); }},
                {label: 'New folder' + (folder ? ' in ' + folder : '') + '…', run: function() { createFolder(folder); }},
            ]);
        } else if (folderRow) {
            var folderPath = folderRow.dataset.folder;
            showMenu(event.clientX, event.clientY, [
                {label: 'New file in ' + folderPath + '…', run: function() { createFile(folderPath); }},
                {label: 'New folder in ' + folderPath + '…', run: function() { createFolder(folderPath); }},
                '-',
                {label: 'Rename folder…', run: function() { renameFolder(folderPath); }},
                {label: 'Delete folder', danger: true, run: function() { deleteFolder(folderPath); }},
            ]);
        } else {
            showMenu(event.clientX, event.clientY, [
                {label: 'New file…', run: function() { createFile(''); }},
                {label: 'New folder…', run: function() { createFolder(''); }},
            ]);
        }
    }

    function init() {
        document.addEventListener('contextmenu', onContextMenu);
        document.addEventListener('mousedown', function(event) {
            if (menu && !menu.contains(event.target)) closeMenu();
        }, true);
        document.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') closeMenu();
            if (event.key === 'F2' && !event.ctrlKey && !event.metaKey && !event.altKey) {
                var target = event.target;
                if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.closest && target.closest('.cm-editor'))) return;
                var selected = document.querySelector('#file-list li.file-selected');
                if (selected && !document.querySelector('dialog[open]')) {
                    event.preventDefault();
                    renameFile(selected.dataset.filename);
                }
            }
        });
        var newFile = document.getElementById('new-file-button');
        if (newFile) newFile.onclick = function() { createFile(selectedFolder()); };
        var newFolder = document.getElementById('new-folder-button');
        if (newFolder) newFolder.onclick = function() { createFolder(selectedFolder()); };
    }
    // The folder of the selected file, for the buttons above the tree.
    function selectedFolder() {
        var selected = document.querySelector('#file-list li.file-selected');
        if (!selected) return '';
        var path = selected.dataset.filename;
        return path.slice(0, path.lastIndexOf('/') + 1);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return {
        createFile: createFile,
        createFolder: createFolder,
        renameFile: renameFile,
        deleteFile: deleteFile,
        renameFolder: renameFolder,
        deleteFolder: deleteFolder,
        showMenu: showMenu,
    };
})();
