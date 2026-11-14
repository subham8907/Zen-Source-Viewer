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
 * Added by Subham Mahesh, 2026: review notes. Add a note to a line of code
 * ("+ Note" in the file's toolbar, or Alt+N), see markers next to noted lines,
 * list all notes ("Notes" at the top), and export them as a text file
 * (.txt, with the file, line and code of each note) or as Markdown.
 *
 * Notes are kept only for this browser session (sessionStorage), per add-on
 * file (by the SHA-256 of the archive): they survive reloading the tab, and
 * are gone when the tab is closed. Export them to keep them. They are never
 * uploaded.
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals ZenMainView, ZenFiles, getFileListItem */
'use strict';

var ZenNotes = (function() {
    var notes = [];
    var key = null;
    var storageFailed = false;

    function storageKey(archiveKey) {
        return 'zen-review-notes:' + archiveKey;
    }
    function load(archiveKey) {
        key = archiveKey;
        notes = [];
        try {
            var saved = JSON.parse(sessionStorage.getItem(storageKey(archiveKey)) || '[]');
            if (Array.isArray(saved)) notes = saved;
        } catch (e) {
            storageFailed = true;
        }
        changed(false);
    }
    function save() {
        if (!key) return;
        try {
            if (notes.length) sessionStorage.setItem(storageKey(key), JSON.stringify(notes));
            else sessionStorage.removeItem(storageKey(key));
            storageFailed = false;
        } catch (e) {
            storageFailed = true;
        }
    }
    function changed(store) {
        if (store !== false) save();
        updateButton();
        refreshMarkers();
        if (ZenMainView.currentId() === 'notes') open();
    }

    function el(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    // ---- The current file

    function currentView() {
        var filename = ZenFiles.selectedFilename();
        var editor = window.currentCodeEditor;
        if (!filename || !editor || !editor.getCursorLine) return null;
        var beautified = !!document.querySelector('#source-toolbar .toggle-beautifier.was-beautify-enabled');
        return {filename: filename, editor: editor, beautified: beautified};
    }

    // The line of a note in the shown code: the saved line if its text still
    // matches, else the first line with the same text (e.g. raw vs beautified).
    function locate(editor, note) {
        var wanted = (note.code || '').trim();
        if (!wanted || editor.getLineText(note.line).trim() === wanted) return note.line;
        var lines = editor.view.state.doc.lines;
        for (var i = 1; i <= lines; i++) {
            if (editor.getLineText(i).trim() === wanted) return i;
        }
        return note.line <= lines ? note.line : null;
    }

    function notesOf(filename) {
        return notes.filter(function(note) { return note.file === filename; });
    }

    var markerTimer = null;
    function refreshMarkers() {
        clearTimeout(markerTimer);
        var tries = 0;
        (function apply() {
            var view = currentView();
            if (!view) {
                if (++tries < 30) markerTimer = setTimeout(apply, 100);
                return;
            }
            var markers = [];
            notesOf(view.filename).forEach(function(note) {
                var line = locate(view.editor, note);
                if (line) markers.push({line: line, title: note.text});
            });
            view.editor.setNotes(markers, function(line) {
                var here = notesOf(view.filename).filter(function(note) { return locate(view.editor, note) === line; });
                if (here.length) editNote(here[0]);
            });
            updateFileButton(view.filename);
        })();
    }

    // ---- Adding and editing

    function addNoteHere() {
        var view = currentView();
        if (!view) {
            alert('Open a code file to add a note to a line.');
            return;
        }
        var cursor = view.editor.getCursorLine();
        editNote({file: view.filename, line: cursor.line, code: cursor.text, text: ''}, true);
    }

    function editNote(note, isNew) {
        var dialog = el('dialog', 'note-dialog');
        var form = el('form');
        form.method = 'dialog';
        form.appendChild(el('h3', '', (isNew ? 'Add a note' : 'Note') + ' · ' + note.file + ':' + note.line));
        if (note.code && note.code.trim()) form.appendChild(el('pre', 'note-code', note.code.trim().slice(0, 300)));
        var input = el('textarea', 'note-input');
        input.value = note.text;
        input.rows = 5;
        input.placeholder = 'What should be checked or changed here?';
        input.setAttribute('aria-label', 'Note');
        form.appendChild(input);
        var buttons = el('div', 'note-buttons');
        var saveButton = el('button', 'primary', isNew ? 'Add note' : 'Save');
        saveButton.type = 'submit';
        var cancel = el('button', '', 'Cancel');
        cancel.type = 'button';
        cancel.onclick = function() { dialog.close(); };
        buttons.append(saveButton, cancel);
        if (!isNew) {
            var remove = el('button', 'note-delete', 'Delete');
            remove.type = 'button';
            remove.onclick = function() {
                notes = notes.filter(function(n) { return n.id !== note.id; });
                dialog.close();
                changed();
            };
            var goTo = el('button', '', 'Go to line');
            goTo.type = 'button';
            goTo.onclick = function() {
                dialog.close();
                ZenFiles.openAt(note.file, note.line);
            };
            buttons.append(goTo, remove);
        }
        form.appendChild(buttons);
        form.onsubmit = function(event) {
            event.preventDefault();
            var text = input.value.trim();
            if (!text) {
                input.focus();
                return;
            }
            if (isNew) {
                note.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
                note.time = Date.now();
                note.text = text;
                notes.push(note);
            } else {
                note.text = text;
            }
            dialog.close();
            changed();
        };
        input.onkeydown = function(event) {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                form.requestSubmit();
            }
        };
        dialog.appendChild(form);
        dialog.onclose = function() { dialog.remove(); };
        document.body.appendChild(dialog);
        dialog.showModal();
        input.focus();
    }

    // ---- Buttons

    function updateButton() {
        var button = document.getElementById('notes-toggle');
        if (!button) return;
        button.textContent = notes.length ? 'Notes ' + notes.length : 'Notes';
        button.title = notes.length ? notes.length + ' review note' + (notes.length === 1 ? '' : 's') +
            ' (kept until you close this tab; export them to keep them)' :
            'Review notes: add notes to lines of code and export them';
    }

    function updateFileButton(filename) {
        var button = document.querySelector('#source-toolbar .note-add');
        if (!button) return;
        var count = notesOf(filename).length;
        button.textContent = count ? '+ Note (' + count + ')' : '+ Note';
    }

    // Adds "+ Note" to the toolbar of each code file.
    function watchToolbar() {
        var toolbar = document.getElementById('source-toolbar');
        if (!toolbar) return;
        new MutationObserver(function() {
            var heading = toolbar.querySelector('.file-specific-toolbar');
            if (!heading || heading.querySelector('.note-add')) return;
            if (!heading.querySelector('.toggle-edit, .toggle-beautifier')) return; // Not a code view.
            var button = el('button', 'note-add', '+ Note');
            button.type = 'button';
            button.title = 'Add a review note to the line of the cursor (Alt+N)';
            button.onclick = addNoteHere;
            var anchor = heading.querySelector('.language-label');
            heading.insertBefore(button, anchor || null);
            refreshMarkers();
        }).observe(toolbar, {childList: true, subtree: true});
    }

    // ---- The Notes view

    function open() {
        ZenMainView.show('notes', function(toolbar, body) {
            var bar = el('div', 'rv-toolbar');
            bar.appendChild(el('span', 'rv-title', 'Review notes'));
            bar.appendChild(el('span', 'rv-spacer'));
            var exportText = el('button', 'notes-export-txt', 'Export .txt');
            exportText.type = 'button';
            exportText.title = 'Download the notes as a text file, with the file, line and code of each note';
            exportText.disabled = !notes.length;
            exportText.onclick = function() {
                ZenFiles.downloadText(toText(), ZenFiles.archiveName() + '-notes.txt', 'text/plain;charset=utf-8');
            };
            var exportButton = el('button', '', 'Export Markdown');
            exportButton.type = 'button';
            exportButton.disabled = !notes.length;
            exportButton.onclick = function() {
                ZenFiles.downloadText(toMarkdown(), ZenFiles.archiveName() + '-notes.md', 'text/markdown;charset=utf-8');
            };
            var clear = el('button', '', 'Delete all');
            clear.type = 'button';
            clear.disabled = !notes.length;
            clear.onclick = function() {
                if (!confirm('Delete all ' + notes.length + ' notes of this add-on?')) return;
                notes = [];
                changed();
            };
            bar.append(exportText, exportButton, clear);
            toolbar.appendChild(bar);

            body.classList.add('rv-body');
            var box = el('div', 'rv-report');
            body.appendChild(box);
            box.appendChild(el('p', 'rv-note', storageFailed ?
                'Notes cannot be stored in this browser session; they are lost when you reload or close this tab. Export them to keep them.' :
                'Notes are kept until you close this tab. Use \u201cExport .txt\u201d or \u201cExport Markdown\u201d to keep them.'));
            if (!notes.length) {
                box.appendChild(el('p', 'rv-empty', 'No notes yet. Open a code file, put the cursor on a line ' +
                    'and click “+ Note” (or press Alt+N).'));
                return;
            }
            var byFile = new Map();
            notes.slice().sort(function(a, b) {
                return a.file.localeCompare(b.file) || a.line - b.line;
            }).forEach(function(note) {
                if (!byFile.has(note.file)) byFile.set(note.file, []);
                byFile.get(note.file).push(note);
            });
            byFile.forEach(function(fileNotes, file) {
                var section = el('section', 'rv-section');
                var title = el('h3', 'rv-section-title');
                title.appendChild(el('code', '', file));
                title.appendChild(el('span', 'rv-count', String(fileNotes.length)));
                if (!getFileListItem(file)) title.appendChild(el('span', 'rv-muted', ' (not in this add-on)'));
                section.appendChild(title);
                fileNotes.forEach(function(note) {
                    var item = el('div', 'note-item');
                    var link = el('a', 'rv-place', 'Line ' + note.line);
                    link.href = '#';
                    link.onclick = function(e) {
                        e.preventDefault();
                        ZenFiles.openAt(note.file, note.line);
                    };
                    var head = el('div', 'note-item-head');
                    head.appendChild(link);
                    if (note.code && note.code.trim()) head.appendChild(el('code', 'rv-snippet', note.code.trim().slice(0, 160)));
                    var edit = el('button', 'note-edit', 'Edit');
                    edit.type = 'button';
                    edit.onclick = function() { editNote(note); };
                    head.appendChild(edit);
                    item.appendChild(head);
                    item.appendChild(el('p', 'note-text', note.text));
                    section.appendChild(item);
                });
                box.appendChild(section);
            });
        });
    }

    function sortedByFile() {
        var byFile = new Map();
        notes.slice().sort(function(a, b) {
            return a.file.localeCompare(b.file) || a.line - b.line;
        }).forEach(function(note) {
            if (!byFile.has(note.file)) byFile.set(note.file, []);
            byFile.get(note.file).push(note);
        });
        return byFile;
    }

    // A plain text file: for each note, the file, the line, the code of that
    // line, when it was written, and the note.
    function toText() {
        var rule = new Array(61).join('=');
        var lines = [
            'Review notes',
            rule,
            'Add-on file: ' + ZenFiles.archiveName() + (ZenFiles.archiveKey() ? ' (SHA-256 ' + ZenFiles.archiveKey() + ')' : ''),
            'Exported:    ' + new Date().toLocaleString(),
            'Notes:       ' + notes.length,
            '',
        ];
        sortedByFile().forEach(function(fileNotes, file) {
            lines.push(rule, 'File: ' + file + ' (' + fileNotes.length + ' note' + (fileNotes.length === 1 ? '' : 's') + ')', rule, '');
            fileNotes.forEach(function(note, i) {
                lines.push('[' + (i + 1) + '] Line ' + note.line + (note.time ? '  \u00b7  ' + new Date(note.time).toLocaleString() : ''));
                if (note.code && note.code.trim()) lines.push('    Code: ' + note.code.trim().slice(0, 300));
                note.text.split('\n').forEach(function(line) { lines.push('    ' + line); });
                lines.push('');
            });
        });
        lines.push('Created with Zen Source Viewer.', '');
        return lines.join('\n');
    }

    // A file was renamed in the viewer (file-ops.js): its notes move with it.
    document.addEventListener('zen-file-renamed', function(event) {
        var moved = false;
        notes.forEach(function(note) {
            if (note.file === event.detail.from) {
                note.file = event.detail.to;
                moved = true;
            }
        });
        if (moved) changed();
    });

    function toMarkdown() {
        var lines = ['# Review notes: ' + ZenFiles.archiveName(), ''];
        var byFile = new Map();
        notes.slice().sort(function(a, b) {
            return a.file.localeCompare(b.file) || a.line - b.line;
        }).forEach(function(note) {
            if (!byFile.has(note.file)) byFile.set(note.file, []);
            byFile.get(note.file).push(note);
        });
        byFile.forEach(function(fileNotes, file) {
            lines.push('## `' + file + '`', '');
            fileNotes.forEach(function(note) {
                lines.push('- **Line ' + note.line + '**' + (note.code && note.code.trim() ?
                    ': `' + note.code.trim().slice(0, 160).replace(/`/g, "'") + '`' : ''));
                note.text.split('\n').forEach(function(line) { lines.push('  ' + line); });
            });
            lines.push('');
        });
        lines.push('_Created with Zen Source Viewer on ' + new Date().toISOString().slice(0, 10) + '._', '');
        return lines.join('\n');
    }

    // ---- Set up

    document.addEventListener('zen-archive', function(event) {
        load(event.detail);
    });
    // Earlier versions kept notes in localStorage; notes are now kept only for
    // the session, so remove those.
    try {
        Object.keys(localStorage).forEach(function(storedKey) {
            if (storedKey.indexOf('zen-review-notes:') === 0) localStorage.removeItem(storedKey);
        });
    } catch (e) {
        // Storage is not available.
    }
    window.addEventListener('keydown', function(event) {
        if (event.altKey && !event.ctrlKey && !event.metaKey && (event.code === 'KeyN')) {
            event.preventDefault();
            addNoteHere();
        }
    }, true);
    function init() {
        var button = document.getElementById('notes-toggle');
        if (button) button.onclick = open;
        updateButton();
        watchToolbar();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return {
        open: open,
        add: addNoteHere,
        count: function() { return notes.length; },
    };
})();
