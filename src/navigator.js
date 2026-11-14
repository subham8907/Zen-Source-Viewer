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
 * Added by Subham Mahesh, 2026: faster ways to move around an add-on.
 *
 *  - Quick open (Ctrl/Cmd+P): find a file by typing parts of its name.
 *    Type "@" first to jump to a symbol of the shown file, ":" for a line.
 *  - Go to symbol (Ctrl/Cmd+Shift+O): functions, classes and methods of
 *    JavaScript, selectors of CSS, ids of HTML, keys of JSON, headings of
 *    Markdown.
 *  - Tabs: recently opened files above the code, like an editor.
 *  - Keyboard shortcuts: press "?" (or click "?" at the top) to see them all.
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals ZenFiles, ZenNotes, ZenReview, getFileListItem, openFileFromList */
'use strict';

var ZenNavigator = (function() {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    var MOD = isMac ? '⌘' : 'Ctrl';

    function el(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    // ---- Fuzzy matching

    // Scores how well a query matches a text (all query characters in order);
    // -1 if it does not match. Higher is better.
    function fuzzyScore(query, text) {
        if (!query) return 0;
        var q = query.toLowerCase();
        var t = text.toLowerCase();
        var score = 0;
        var ti = 0;
        var previous = -2;
        for (var qi = 0; qi < q.length; qi++) {
            var c = q[qi];
            if (c === ' ') continue;
            var found = t.indexOf(c, ti);
            if (found === -1) return -1;
            score += 1;
            if (found === previous + 1) score += 3; // Consecutive.
            if (found === 0 || /[\/._\-\s]/.test(t[found - 1])) score += 4; // Start of a word.
            if (text[found] !== t[found] && text[found] === query[qi]) score += 1; // Same case.
            previous = found;
            ti = found + 1;
        }
        // Prefer matches in the file name over the folders, and shorter paths.
        var slash = t.lastIndexOf('/');
        if (t.indexOf(q, slash + 1) !== -1) score += 10;
        return score - text.length / 100;
    }

    // Marks the matched characters of a text.
    function highlight(container, text, query) {
        var q = (query || '').toLowerCase().replace(/\s/g, '');
        var t = text.toLowerCase();
        var ti = 0;
        var marks = new Set();
        for (var qi = 0; qi < q.length; qi++) {
            var found = t.indexOf(q[qi], ti);
            if (found === -1) break;
            marks.add(found);
            ti = found + 1;
        }
        var run = '';
        var runMarked = false;
        function flush() {
            if (!run) return;
            container.appendChild(runMarked ? el('mark', '', run) : document.createTextNode(run));
            run = '';
        }
        for (var i = 0; i < text.length; i++) {
            var marked = marks.has(i);
            if (marked !== runMarked) {
                flush();
                runMarked = marked;
            }
            run += text[i];
        }
        flush();
    }

    // ---- Symbols of the shown file

    var JS_RULES = [
        [/^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/, 'function'],
        [/^\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/, 'class'],
        [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/, 'function'],
        [/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*class\b/, 'class'],
        [/^\s*([\w$.]+\.[A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/, 'function'],
        [/^\s*['"]?([A-Za-z_$][\w$]*)['"]?\s*:\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/, 'method'],
        [/^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{\s*$/, 'method'],
    ];
    var NOT_METHODS = /^(if|for|while|switch|catch|function|return|with|else|do|try|typeof|new)$/;

    function symbolsOf(text, filename) {
        var ext = ZenFiles.extension(filename);
        var lines = text.split('\n');
        var symbols = [];
        if (lines.length > 200000) return symbols;
        var i, match;
        if (/^(m?js|cjs|jsm|ts)$/.test(ext) || /^html?$/.test(ext)) {
            for (i = 0; i < lines.length; i++) {
                var line = lines[i];
                if (line.length > 2000) continue; // Minified: use Beautify first.
                for (var r = 0; r < JS_RULES.length; r++) {
                    match = JS_RULES[r][0].exec(line);
                    if (match && !(JS_RULES[r][1] === 'method' && NOT_METHODS.test(match[1]))) {
                        symbols.push({name: match[1], kind: JS_RULES[r][1], line: i + 1});
                        break;
                    }
                }
            }
        }
        if (/^html?$/.test(ext)) {
            for (i = 0; i < lines.length; i++) {
                var idRe = /\bid\s*=\s*["']([^"']+)["']/g;
                while ((match = idRe.exec(lines[i]))) symbols.push({name: '#' + match[1], kind: 'id', line: i + 1});
            }
        } else if (ext === 'css') {
            for (i = 0; i < lines.length; i++) {
                match = /^\s*([^{}\/][^{}]*?)\s*\{/.exec(lines[i]);
                if (match && match[1].trim()) symbols.push({name: match[1].trim().slice(0, 120), kind: 'selector', line: i + 1});
            }
        } else if (ext === 'json') {
            var minIndent = Infinity;
            var keys = [];
            for (i = 0; i < lines.length && i < 50000; i++) {
                match = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:/.exec(lines[i]);
                if (match) {
                    keys.push({indent: match[1].length, name: match[2], line: i + 1});
                    if (match[1].length < minIndent) minIndent = match[1].length;
                }
            }
            keys.forEach(function(key) {
                if (key.indent === minIndent) symbols.push({name: key.name, kind: 'key', line: key.line});
            });
        } else if (ext === 'md') {
            for (i = 0; i < lines.length; i++) {
                match = /^(#{1,6})\s+(.*)/.exec(lines[i]);
                if (match) symbols.push({name: match[2], kind: 'h' + match[1].length, line: i + 1});
            }
        }
        return symbols;
    }

    // ---- The palette (quick open and symbols)

    var palette = null;

    function closePalette() {
        if (!palette) return;
        palette.root.remove();
        palette = null;
    }

    // mode: 'files', 'symbols' or 'line'.
    function openPalette(initial) {
        closePalette();
        var root = el('div', 'palette-backdrop');
        var box = el('div', 'palette');
        box.setAttribute('role', 'dialog');
        box.setAttribute('aria-label', 'Quick open');
        var input = el('input', 'palette-input');
        input.type = 'text';
        input.spellcheck = false;
        input.setAttribute('aria-label', 'Search files');
        var hint = el('div', 'palette-hint');
        var list = el('ol', 'palette-list');
        list.setAttribute('role', 'listbox');
        box.append(input, hint, list);
        root.appendChild(box);
        document.body.appendChild(root);
        palette = {root: root, input: input, list: list, items: [], index: 0};
        root.addEventListener('mousedown', function(event) {
            if (event.target === root) closePalette();
        });
        input.value = initial || '';
        input.oninput = render;
        input.onkeydown = function(event) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                move(event.key === 'ArrowDown' ? 1 : -1);
            } else if (event.key === 'Enter') {
                event.preventDefault();
                choose(palette.items[palette.index]);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                closePalette();
            }
        };
        render();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);

        function render() {
            var value = input.value;
            list.textContent = '';
            palette.items = [];
            palette.index = 0;
            if (value[0] === ':') {
                renderLine(value.slice(1));
            } else if (value[0] === '@') {
                renderSymbols(value.slice(1));
            } else {
                renderFiles(value);
            }
            select(0);
        }

        function renderFiles(query) {
            hint.textContent = 'Type part of a file name · @ symbols of this file · : go to line';
            var files = ZenFiles.list();
            var scored = files.map(function(file) {
                return {file: file.filename, score: fuzzyScore(query.trim(), file.filename)};
            }).filter(function(item) { return item.score >= 0; });
            if (query.trim()) scored.sort(function(a, b) { return b.score - a.score; });
            else scored = recentFirst(scored);
            scored.slice(0, 60).forEach(function(item) {
                var slash = item.file.lastIndexOf('/');
                var li = el('li', 'palette-item');
                var name = el('span', 'palette-name');
                highlight(name, item.file.slice(slash + 1), query.trim());
                li.appendChild(name);
                if (slash !== -1) li.appendChild(el('span', 'palette-detail', item.file.slice(0, slash)));
                if (ZenFiles.isEdited(item.file)) li.appendChild(el('span', 'palette-badge', 'M'));
                addItem(li, {type: 'file', file: item.file});
            });
            if (!scored.length) list.appendChild(el('li', 'palette-empty', 'No matching files'));
        }

        function renderSymbols(query) {
            var editor = window.currentCodeEditor;
            var filename = ZenFiles.selectedFilename();
            if (!editor || !filename) {
                hint.textContent = 'Open a code file to see its symbols';
                return;
            }
            hint.textContent = 'Symbols of ' + filename;
            var symbols = symbolsOf(editor.getText(), filename);
            var q = query.trim();
            var scored = symbols.map(function(symbol) {
                return {symbol: symbol, score: fuzzyScore(q, symbol.name)};
            }).filter(function(item) { return item.score >= 0; });
            if (q) scored.sort(function(a, b) { return b.score - a.score; });
            scored.slice(0, 200).forEach(function(item) {
                var li = el('li', 'palette-item');
                li.appendChild(el('span', 'palette-kind is-' + item.symbol.kind, item.symbol.kind));
                var name = el('span', 'palette-name');
                highlight(name, item.symbol.name, q);
                li.appendChild(name);
                li.appendChild(el('span', 'palette-detail', 'line ' + item.symbol.line));
                addItem(li, {type: 'line', line: item.symbol.line});
            });
            if (!scored.length) {
                list.appendChild(el('li', 'palette-empty', symbols.length ? 'No matching symbols' :
                    'No symbols found' + (ZenFiles.extension(filename) === 'js' ? ' (for minified code, use Beautify first)' : '')));
            }
        }

        function renderLine(value) {
            var editor = window.currentCodeEditor;
            var line = parseInt(value, 10);
            hint.textContent = editor ? 'Go to a line of ' + ZenFiles.selectedFilename() + ' (1–' +
                editor.view.state.doc.lines + ')' : 'Open a code file first';
            if (editor && line > 0) {
                addItem(el('li', 'palette-item', 'Go to line ' + line), {type: 'line', line: line});
            }
        }

        function addItem(li, item) {
            var index = palette.items.length;
            li.setAttribute('role', 'option');
            li.onmousemove = function() { if (palette.index !== index) select(index); };
            li.onclick = function() { choose(item); };
            palette.items.push(item);
            list.appendChild(li);
        }
    }

    function select(index) {
        if (!palette) return;
        var items = palette.list.querySelectorAll('.palette-item');
        if (!items.length) return;
        palette.index = Math.max(0, Math.min(index, items.length - 1));
        Array.prototype.forEach.call(items, function(item, i) {
            item.classList.toggle('is-selected', i === palette.index);
            item.setAttribute('aria-selected', String(i === palette.index));
        });
        items[palette.index].scrollIntoView({block: 'nearest'});
    }
    function move(direction) {
        if (palette) select(palette.index + direction);
    }

    function choose(item) {
        if (!item) return;
        closePalette();
        if (item.type === 'file') {
            openFileFromList(item.file);
        } else if (item.type === 'line') {
            var editor = window.currentCodeEditor;
            if (editor) {
                editor.scrollToLine(item.line);
                editor.view.focus();
            }
        }
    }

    // ---- Tabs

    var tabs = []; // filenames, in order
    var MAX_TABS = 12;
    var tabsElem = null;

    function recentFirst(items) {
        var order = new Map(tabs.map(function(file, i) { return [file, i]; }));
        return items.sort(function(a, b) {
            var x = order.has(a.file) ? order.get(a.file) : 1e9;
            var y = order.has(b.file) ? order.get(b.file) : 1e9;
            return x - y || a.file.localeCompare(b.file);
        });
    }

    function renderTabs() {
        if (!tabsElem) return;
        tabs = tabs.filter(function(file) { return getFileListItem(file); });
        var active = ZenFiles.selectedFilename();
        tabsElem.textContent = '';
        tabsElem.hidden = !tabs.length;
        tabs.forEach(function(file) {
            var tab = el('div', 'file-tab');
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-selected', String(file === active));
            tab.classList.toggle('is-active', file === active);
            var li = getFileListItem(file);
            tab.classList.toggle('is-edited', !!(li && li.classList.contains('file-edited')));
            tab.title = file;
            var label = el('button', 'file-tab-label', file.slice(file.lastIndexOf('/') + 1));
            label.type = 'button';
            label.onclick = function() { openFileFromList(file); };
            var close = el('button', 'file-tab-close', '×');
            close.type = 'button';
            close.title = 'Close (Alt+W)';
            close.setAttribute('aria-label', 'Close ' + file);
            close.onclick = function(event) {
                event.stopPropagation();
                closeTab(file);
            };
            tab.onauxclick = function(event) {
                if (event.button === 1) closeTab(file);
            };
            tab.append(label, close);
            tabsElem.appendChild(tab);
            if (file === active) tab.scrollIntoView({block: 'nearest', inline: 'nearest'});
        });
    }

    function addTab(file) {
        if (tabs.indexOf(file) === -1) {
            tabs.push(file);
            while (tabs.length > MAX_TABS) {
                var oldest = tabs.findIndex(function(f) { return f !== file; });
                tabs.splice(oldest, 1);
            }
        }
        renderTabs();
    }

    function closeTab(file) {
        var index = tabs.indexOf(file);
        if (index === -1) return;
        var wasActive = ZenFiles.selectedFilename() === file;
        tabs.splice(index, 1);
        if (wasActive && tabs.length) {
            openFileFromList(tabs[Math.min(index, tabs.length - 1)]);
        }
        renderTabs();
    }

    function switchTab(direction) {
        if (!tabs.length) return;
        var index = tabs.indexOf(ZenFiles.selectedFilename());
        var next = index === -1 ? 0 : (index + direction + tabs.length) % tabs.length;
        openFileFromList(tabs[next]);
    }

    function watchSelection() {
        var fileList = document.getElementById('file-list');
        if (!fileList) return;
        var last = null;
        new MutationObserver(function() {
            var selected = ZenFiles.selectedFilename();
            if (selected && selected !== last) addTab(selected);
            else renderTabs();
            last = selected;
        }).observe(fileList, {attributes: true, attributeFilter: ['class'], subtree: true, childList: true});
        document.addEventListener('zen-archive', function() {
            tabs = [];
            renderTabs();
        });
    }

    // ---- Keyboard shortcuts

    var SHORTCUTS = [
        ['Files', [
            [MOD + '+P', 'Quick open: find a file by name'],
            [MOD + '+P, then @', 'Go to a symbol of the shown file'],
            [MOD + '+P, then :', 'Go to a line'],
            [MOD + '+Shift+O', 'Go to symbol'],
            ['Alt+[  /  Alt+]', 'Previous / next tab'],
            ['Alt+W', 'Close the tab'],
        ]],
        ['Code', [
            [MOD + '+F', 'Search in the shown file (or the file filter)'],
            [MOD + '+G  /  ' + MOD + '+Shift+G', 'Next / previous search result'],
            ['Alt+N', 'Add a review note to the line of the cursor'],
        ]],
        ['Locale diff', [
            ['F7  /  Shift+F7', 'Next / previous problem or key to review'],
            [MOD + '+Enter', 'Save the edited message'],
            ['Esc', 'Cancel editing'],
        ]],
        ['Other', [
            ['?', 'Show these shortcuts'],
            ['Esc', 'Close a dialog or the quick open'],
        ]],
    ];

    function showShortcuts() {
        var existing = document.querySelector('dialog.shortcuts-dialog');
        if (existing) {
            existing.close();
            return;
        }
        var dialog = el('dialog', 'shortcuts-dialog');
        dialog.appendChild(el('h3', '', 'Keyboard shortcuts'));
        SHORTCUTS.forEach(function(group) {
            dialog.appendChild(el('h4', '', group[0]));
            var table = el('table');
            group[1].forEach(function(item) {
                var tr = el('tr');
                var keys = el('td');
                item[0].split(/\s+\/\s+/).forEach(function(combo, i) {
                    if (i) keys.append(' / ');
                    keys.appendChild(el('kbd', '', combo));
                });
                tr.append(keys, el('td', '', item[1]));
                table.appendChild(tr);
            });
            dialog.appendChild(table);
        });
        var close = el('button', '', 'Close');
        close.onclick = function() { dialog.close(); };
        dialog.appendChild(close);
        dialog.onclose = function() { dialog.remove(); };
        document.body.appendChild(dialog);
        dialog.showModal();
    }

    function isTyping(target) {
        return target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
            (target.closest && target.closest('.cm-editor')));
    }

    window.addEventListener('keydown', function(event) {
        var mod = isMac ? event.metaKey : event.ctrlKey;
        var key = event.key.toLowerCase();
        if (mod && !event.altKey && key === 'p') {
            event.preventDefault();
            event.stopPropagation();
            if (palette) closePalette();
            else if (ZenFiles.list().length) openPalette(event.shiftKey ? '@' : '');
            return;
        }
        if (mod && event.shiftKey && !event.altKey && key === 'o') {
            event.preventDefault();
            event.stopPropagation();
            if (ZenFiles.list().length) openPalette('@');
            return;
        }
        if (event.altKey && !mod && (event.code === 'BracketLeft' || event.code === 'BracketRight')) {
            event.preventDefault();
            switchTab(event.code === 'BracketLeft' ? -1 : 1);
            return;
        }
        if (event.altKey && !mod && event.code === 'KeyW') {
            event.preventDefault();
            var current = ZenFiles.selectedFilename();
            if (current) closeTab(current);
            return;
        }
        if (event.key === '?' && !mod && !event.altKey && !isTyping(event.target)) {
            event.preventDefault();
            showShortcuts();
        }
    }, true);

    function init() {
        tabsElem = document.getElementById('file-tabs');
        watchSelection();
        var shortcutsButton = document.getElementById('shortcuts-button');
        if (shortcutsButton) shortcutsButton.onclick = showShortcuts;
        var quickOpenButton = document.getElementById('quick-open-button');
        if (quickOpenButton) {
            quickOpenButton.title = 'Find a file by name (' + MOD + '+P)';
            quickOpenButton.onclick = function() { openPalette(''); };
        }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();

    return {
        openPalette: openPalette,
        showShortcuts: showShortcuts,
        symbolsOf: symbolsOf,
        fuzzyScore: fuzzyScore,
    };
})();
