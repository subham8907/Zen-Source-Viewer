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
 * Added by Subham Mahesh, 2026: a diff view for locales, like the diff editor
 * of VS Code, shown in the main panel. Two locales (e.g. en and de) are
 * compared message by message, aligned by key:
 *
 *  - Messages: side by side (or inline), one row per key. Keys missing from
 *    the locale are red on the left, keys only in the locale are green on the
 *    right, text that is the same as the reference is marked "untranslated",
 *    and messages whose placeholders ($1, $NAME$) differ are flagged.
 *    Up/down arrows jump between the rows that need attention, and an
 *    overview ruler on the right shows where they are.
 *  - File diff: the two messages.json files in the code editor's diff view.
 *
 * Messages can be edited in place, missing keys added (one or all at once,
 * with the reference text to translate). Only the changed message is written
 * into the locale's messages.json, so the rest of the file keeps its format;
 * the edit appears in the Changes panel like any other edit.
 *
 * The data comes from the locale scan of viewer.js (localeCoverageResults).
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals localeCoverageResults, normalizeLocaleCode, getFileListItem, readCurrentText, readEntryText,
           setPatchedText, openFileFromList, renderLocaleCoverage, scanLocaleCoverage, viewFileInfo,
           ZenEditor */
'use strict';

var ZenLocaleDiff = (function() {
    var PREFS_KEY = 'zen-locale-diff-prefs';
    var prefs = {layout: 'split', mode: 'messages', filter: 'all'};
    try {
        var saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        ['layout', 'mode', 'filter'].forEach(function(name) {
            if (typeof saved[name] === 'string') prefs[name] = saved[name];
        });
    } catch (e) {
        // Storage may be unavailable; use the defaults.
    }
    function savePrefs() {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
        } catch (e) {
            // Not important.
        }
    }

    // The open view: {referenceKey, localeKey, rows, search, focusIndex, ...} or null.
    var state = null;

    // Two kinds of differences, shown differently:
    //  - problems (red/amber, with ✕ or ⚠): the locale has no entry for a key
    //    (Firefox then shows the reference text), the entry is invalid, or its
    //    placeholders do not match;
    //  - to review (blue/green, with = or +): the entry is the same text as the
    //    reference (often fine, e.g. names), or the key is only in the locale.
    var FILTERS = [
        ['all', 'All'],
        ['problems', 'Problems'],
        ['review', 'To review'],
        ['missing', '\u2715 Missing'],
        ['invalid', '\u2715 Invalid'],
        ['placeholders', '\u26a0 Placeholders'],
        ['untranslated', '= Same as reference'],
        ['extra', '+ Only in locale'],
        ['translated', 'Translated'],
    ];
    // Top-level filters only; the others are shown when they have rows.
    var ALWAYS_SHOWN = ['all', 'problems', 'review'];

    function referenceName() {
        return state.result.locales[state.referenceKey].name;
    }

    function el(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }

    // ---- Comparing two locales

    // $1 .. $9 and named placeholders ($NAME$) used in a message.
    function placeholders(message) {
        var found = (message || '').match(/\$[A-Za-z0-9_@]+\$|\$[1-9]/g) || [];
        var unique = [];
        found.forEach(function(token) {
            token = token.toLowerCase();
            if (unique.indexOf(token) === -1) unique.push(token);
        });
        return unique.sort();
    }

    // One row per key, in the order of the reference file; keys that only the
    // locale has are placed after the key that precedes them in the locale file.
    function buildRows(reference, locale, sameLocale) {
        var referenceKeys = Object.keys(reference.messages);
        var rows = referenceKeys.map(function(nk, i) {
            return {nk: nk, key: reference.messages[nk].key, left: reference.messages[nk], leftLine: i + 1};
        });
        var indexByKey = new Map();
        rows.forEach(function(row, i) { indexByKey.set(row.nk, i); });
        var inserted = new Map(); // index of the previous common row -> rows
        var last = -1;
        Object.keys(locale.messages).forEach(function(nk, i) {
            if (indexByKey.has(nk)) {
                last = indexByKey.get(nk);
                rows[last].right = locale.messages[nk];
                rows[last].rightLine = i + 1;
                return;
            }
            if (!inserted.has(last)) inserted.set(last, []);
            inserted.get(last).push({nk: nk, key: locale.messages[nk].key, right: locale.messages[nk], rightLine: i + 1});
        });
        var merged = (inserted.get(-1) || []).slice();
        rows.forEach(function(row, i) {
            merged.push(row);
            if (inserted.has(i)) merged.push.apply(merged, inserted.get(i));
        });
        merged.forEach(function(row) {
            if (!row.right) {
                row.status = 'missing';
            } else if (!row.left) {
                row.status = 'extra';
            } else if (!row.left.valid || !row.right.valid) {
                row.status = 'invalid';
            } else if (sameLocale) {
                row.status = 'same';
            } else if (row.left.message === row.right.message) {
                row.status = 'untranslated';
            } else {
                row.status = 'translated';
            }
            if (row.left && row.right && row.left.valid && row.right.valid && !sameLocale) {
                var a = placeholders(row.left.message);
                var b = placeholders(row.right.message);
                if (a.join(' ') !== b.join(' ')) {
                    row.placeholderIssue = {
                        missing: a.filter(function(t) { return b.indexOf(t) === -1; }),
                        extra: b.filter(function(t) { return a.indexOf(t) === -1; }),
                    };
                }
            }
            row.problem = row.status === 'missing' || row.status === 'invalid' || !!row.placeholderIssue;
            row.review = !row.problem && (row.status === 'untranslated' || row.status === 'extra');
            row.attention = row.problem || row.review;
        });
        return merged;
    }

    function matchesFilter(row, filter) {
        switch (filter) {
        case 'attention': return row.attention;
        case 'problems': return row.problem;
        case 'review': return row.review;
        case 'missing': return row.status === 'missing';
        case 'invalid': return row.status === 'invalid';
        case 'extra': return row.status === 'extra';
        case 'untranslated': return row.status === 'untranslated';
        case 'placeholders': return !!row.placeholderIssue;
        case 'translated': return row.status === 'translated';
        default: return true;
        }
    }
    function matchesSearch(row, search) {
        if (!search) return true;
        var haystack = (row.key + '\n' + (row.left ? row.left.message : '') + '\n' +
            (row.right ? row.right.message : '')).toLowerCase();
        return haystack.indexOf(search) !== -1;
    }

    // ---- Taking over the main panel

    function onSourceViewHide() {
        var code = document.getElementById('source-code');
        code.removeEventListener('sourceviewhide', onSourceViewHide);
        code.classList.remove('has-locale-diff');
        destroyFileDiff();
        state = null;
        markSidebarSelection();
    }

    function takeOverMainPanel() {
        var toolbar = document.getElementById('source-toolbar');
        var code = document.getElementById('source-code');
        if (!state || !state.ownsPanel) {
            code.dispatchEvent(new CustomEvent('sourceviewhide'));
            // Clicking the previously shown file must show it again.
            if (viewFileInfo.forgetCurrentEntry) viewFileInfo.forgetCurrentEntry();
            Array.prototype.forEach.call(document.querySelectorAll('#file-list li.file-selected'), function(li) {
                li.classList.remove('file-selected');
            });
            code.addEventListener('sourceviewhide', onSourceViewHide);
        }
        destroyFileDiff();
        toolbar.textContent = '';
        code.textContent = '';
        code.dataset.filename = '';
        code.scrollTop = 0;
        code.classList.add('has-locale-diff');
    }

    function destroyFileDiff() {
        if (state && state.fileDiff) {
            state.fileDiff.destroy();
            state.fileDiff = null;
        }
    }

    function markSidebarSelection() {
        Array.prototype.forEach.call(document.querySelectorAll('#locale-list .locale-entry'), function(item) {
            item.classList.toggle('is-active', !!state && item.dataset.locale === state.localeKey);
        });
    }

    // ---- Opening

    // Opens the diff of localeKey against referenceKey (normalized locale codes).
    function open(referenceKey, localeKey) {
        var result = localeCoverageResults;
        if (!result || !result.locales[referenceKey] || !result.locales[localeKey]) return;
        var keepSearch = state ? state.search : '';
        takeOverMainPanel();
        state = {
            ownsPanel: true,
            // The scan this view shows; the global results are cleared when a file is edited.
            result: result,
            referenceKey: referenceKey,
            localeKey: localeKey,
            rows: buildRows(result.locales[referenceKey], result.locales[localeKey], referenceKey === localeKey),
            search: keepSearch,
            focusIndex: -1,
            fileDiff: null,
            stale: false,
        };
        markSidebarSelection();
        renderToolbar();
        renderBody();
        if (pendingRestore) {
            var restore = pendingRestore;
            pendingRestore = null;
            var rows = document.querySelector('#source-code .ld-rows');
            if (rows) rows.scrollTop = restore.scrollTop;
        }
    }
    var pendingRestore = null;

    // After a rescan or a change of the reference locale.
    function refresh() {
        if (!state) return;
        var result = localeCoverageResults;
        if (!result) return; // Still scanning; called again when done.
        if (!result.locales[state.referenceKey] || !result.locales[state.localeKey]) {
            showMessage('These locales are no longer in the add-on. Choose a locale in the Locales panel.');
            return;
        }
        open(state.referenceKey, state.localeKey);
    }

    // A file was edited: the shown data may be out of date.
    function markStale() {
        if (!state || state.stale) return;
        state.stale = true;
        var banner = document.querySelector('#source-code .ld-stale');
        if (banner) banner.hidden = false;
    }

    function isOpen() {
        return !!state;
    }

    function showMessage(text) {
        var code = document.getElementById('source-code');
        code.textContent = '';
        code.appendChild(el('p', 'ld-empty-message', text));
    }

    // ---- Toolbar (like the header of VS Code's diff editor)

    function localeSelect(selectedKey, title, onChange) {
        var select = el('select', 'ld-select');
        select.title = title;
        var result = state.result;
        Object.keys(result.locales).sort(function(a, b) {
            return result.locales[a].name.localeCompare(result.locales[b].name);
        }).forEach(function(key) {
            var option = el('option', '', result.locales[key].name);
            option.value = key;
            select.appendChild(option);
        });
        select.value = selectedKey;
        select.onchange = function() { onChange(select.value); };
        return select;
    }

    function segmented(options, value, label, onChange) {
        var group = el('span', 'ld-segmented');
        group.setAttribute('role', 'group');
        group.setAttribute('aria-label', label);
        options.forEach(function(option) {
            var button = el('button', '', option[1]);
            button.type = 'button';
            button.title = option[2] || '';
            button.classList.toggle('is-active', option[0] === value);
            button.setAttribute('aria-pressed', String(option[0] === value));
            button.onclick = function() { onChange(option[0]); };
            group.appendChild(button);
        });
        return group;
    }

    function setReference(referenceKey) {
        if (!localeCoverageResults) {
            // A file was edited: scan again first.
            scanLocaleCoverage();
            return;
        }
        // The reference of the Locales panel follows, so the coverage matches.
        var sidebarSelect = document.getElementById('locale-reference');
        if (sidebarSelect && sidebarSelect.value !== referenceKey) {
            sidebarSelect.value = referenceKey;
            renderLocaleCoverage(localeCoverageResults, referenceKey);
        }
        open(referenceKey, state.localeKey);
    }

    function renderToolbar() {
        var toolbar = document.getElementById('source-toolbar');
        toolbar.textContent = '';
        var bar = el('div', 'ld-toolbar');

        var title = el('span', 'ld-title');
        title.appendChild(el('span', 'ld-title-file', 'messages.json'));
        bar.appendChild(title);

        var pair = el('span', 'ld-pair');
        pair.appendChild(localeSelect(state.referenceKey, 'Reference locale (left)', setReference));
        var swap = el('button', 'ld-swap', '⇄');
        swap.type = 'button';
        swap.title = 'Swap the two locales';
        swap.setAttribute('aria-label', 'Swap the two locales');
        swap.onclick = function() {
            var reference = state.referenceKey;
            state.referenceKey = state.localeKey;
            state.localeKey = reference;
            setReference(state.referenceKey);
        };
        pair.appendChild(swap);
        pair.appendChild(localeSelect(state.localeKey, 'Locale to compare (right)', function(value) {
            if (!localeCoverageResults) {
                scanLocaleCoverage();
                return;
            }
            open(state.referenceKey, value);
        }));
        bar.appendChild(pair);

        bar.appendChild(segmented([
            ['messages', 'Messages', 'Compare the messages key by key'],
            ['file', 'File diff', 'Compare the two messages.json files line by line'],
        ], prefs.mode, 'What to compare', function(mode) {
            prefs.mode = mode;
            savePrefs();
            renderToolbar();
            renderBody();
        }));
        bar.appendChild(segmented([
            ['split', 'Side by side', 'Reference on the left, locale on the right'],
            ['inline', 'Inline', 'Reference and locale above each other'],
        ], prefs.layout, 'Layout', function(layout) {
            prefs.layout = layout;
            savePrefs();
            renderToolbar();
            if (prefs.mode === 'file' && state.fileDiff) {
                state.fileDiff.setMode(layout === 'inline' ? 'unified' : 'split');
            } else {
                renderBody();
            }
        }));

        var nav = el('span', 'ld-nav');
        var prev = el('button', 'ld-prev', '↑');
        prev.type = 'button';
        prev.title = 'Previous problem or key to review (Shift+F7)';
        prev.onclick = function() { goToDifference(-1); };
        var next = el('button', 'ld-next', '↓');
        next.type = 'button';
        next.title = 'Next problem or key to review (F7)';
        next.onclick = function() { goToDifference(1); };
        nav.append(prev, next, el('span', 'ld-nav-status'));
        bar.appendChild(nav);

        var openFile = el('button', 'ld-open-file', 'Open file');
        openFile.type = 'button';
        openFile.title = 'Open the messages.json of ' + state.result.locales[state.localeKey].name;
        openFile.onclick = function() { openLocaleFile(state.localeKey); };
        bar.appendChild(openFile);

        toolbar.appendChild(bar);
    }

    // ---- Body

    function renderBody() {
        var code = document.getElementById('source-code');
        destroyFileDiff();
        code.textContent = '';
        var stale = el('div', 'ld-stale');
        stale.hidden = !state.stale;
        stale.appendChild(el('span', '', 'A file was edited, so this comparison may be out of date. '));
        var rescan = el('button', '', 'Rescan');
        rescan.type = 'button';
        rescan.onclick = function() { scanLocaleCoverage(); };
        stale.appendChild(rescan);
        code.appendChild(stale);
        if (prefs.mode === 'file') {
            renderFileDiff(code);
        } else {
            renderMessages(code);
        }
    }

    function renderFileDiff(code) {
        var host = el('div', 'ld-file-diff');
        code.appendChild(host);
        var result = state.result;
        var files = [result.locales[state.referenceKey].filename, result.locales[state.localeKey].filename];
        var current = state;
        Promise.all(files.map(function(filename) {
            var item = getFileListItem(filename);
            return item && item.zipEntry ? readCurrentText(item.zipEntry) : Promise.resolve('');
        })).then(function(texts) {
            if (state !== current || prefs.mode !== 'file') return;
            state.fileDiff = ZenEditor.createDiffView({
                parent: host,
                original: texts[0] || '',
                modified: texts[1] || '',
                filename: 'messages.json',
                mode: prefs.layout === 'inline' ? 'unified' : 'split',
                wrap: true,
            });
            updateNavStatus();
        });
    }

    function counts() {
        var c = {};
        FILTERS.forEach(function(filter) { c[filter[0]] = 0; });
        state.rows.forEach(function(row) {
            FILTERS.forEach(function(filter) {
                if (matchesFilter(row, filter[0])) c[filter[0]]++;
            });
        });
        return c;
    }

    function renderMessages(code) {
        var result = state.result;
        var referenceName = result.locales[state.referenceKey].name;
        var localeName = result.locales[state.localeKey].name;
        var c = counts();

        // Filters and search, above the diff.
        var head = el('div', 'ld-head');
        var filters = el('div', 'ld-filters');
        if (!c[prefs.filter] && ALWAYS_SHOWN.indexOf(prefs.filter) === -1) prefs.filter = 'all';
        FILTERS.forEach(function(filter) {
            if (ALWAYS_SHOWN.indexOf(filter[0]) === -1 && !c[filter[0]]) return;
            var chip = el('button', 'ld-chip ld-chip-' + filter[0]);
            chip.type = 'button';
            chip.classList.toggle('is-active', prefs.filter === filter[0]);
            chip.setAttribute('aria-pressed', String(prefs.filter === filter[0]));
            chip.title = FILTER_HELP[filter[0]] ? FILTER_HELP[filter[0]](referenceName) : '';
            chip.append(filter[1].replace('reference', referenceName) + ' ',
                el('span', 'ld-chip-count', String(c[filter[0]])));
            chip.onclick = function() {
                prefs.filter = filter[0];
                savePrefs();
                renderBody();
            };
            filters.appendChild(chip);
        });
        head.appendChild(filters);
        var search = el('input', 'ld-search');
        search.type = 'search';
        search.placeholder = 'Filter keys and messages';
        search.value = state.search;
        search.oninput = function() {
            state.search = search.value;
            renderRows(list, ruler);
        };
        head.appendChild(search);
        if (c.missing && state.referenceKey !== state.localeKey) {
            var addAll = el('button', 'ld-add-all', '+ Add ' + c.missing + ' missing');
            addAll.type = 'button';
            addAll.title = 'Add every missing key to ' + localeName + '/messages.json with the ' +
                referenceName + ' text, to translate';
            addAll.onclick = addAllMissing;
            head.appendChild(addAll);
        }
        code.appendChild(head);
        code.appendChild(legend(referenceName));

        // Column headers, like the two file names of a diff editor.
        var columns = el('div', 'ld-columns ld-layout-' + prefs.layout);
        if (prefs.layout === 'split') {
            columns.append(el('div', 'ld-column-title is-reference', referenceName + ' · reference'),
                el('div', 'ld-column-title is-locale', localeName));
        } else {
            columns.appendChild(el('div', 'ld-column-title', referenceName + ' → ' + localeName));
        }
        code.appendChild(columns);

        var wrapper = el('div', 'ld-body');
        var list = el('div', 'ld-rows ld-layout-' + prefs.layout);
        var ruler = el('div', 'ld-ruler');
        ruler.title = 'Overview: click to jump';
        wrapper.append(list, ruler);
        code.appendChild(wrapper);
        renderRows(list, ruler);
    }

    function messageText(entry) {
        if (!entry.valid) return 'Invalid: no string "message" value';
        return entry.message === '' ? '(empty string)' : entry.message;
    }

    var FILTER_HELP = {
        all: function() { return 'Every key'; },
        problems: function(ref) {
            return 'Keys this locale gets wrong: missing (users see the ' + ref + ' text), invalid, or different placeholders';
        },
        review: function(ref) {
            return 'Keys to check: text that is the same as ' + ref + ' (often fine, e.g. names), and keys only this locale has';
        },
        missing: function(ref) { return 'No entry in this locale: Firefox shows the ' + ref + ' text instead'; },
        invalid: function() { return 'The entry has no string "message" value'; },
        placeholders: function(ref) { return 'The $1 / $NAME$ placeholders differ from ' + ref; },
        untranslated: function(ref) {
            return 'The entry exists but its text is the same as ' + ref + ': fine for names, or not translated yet';
        },
        extra: function(ref) { return 'Not in ' + ref + ': nothing uses it unless the code asks for this key'; },
        translated: function(ref) { return 'Translated: the text differs from ' + ref; },
    };

    function badge(kind, icon, text, title) {
        var b = el('span', 'ld-badge is-' + kind);
        b.appendChild(el('span', 'ld-badge-icon', icon));
        b.appendChild(document.createTextNode(text));
        if (title) b.title = title;
        return b;
    }

    function badges(row) {
        var ref = referenceName();
        var span = el('span', 'ld-badges');
        switch (row.status) {
        case 'missing':
            span.appendChild(badge('missing', '\u2715', 'Missing', FILTER_HELP.missing(ref)));
            break;
        case 'invalid':
            span.appendChild(badge('invalid', '\u2715', 'Invalid', FILTER_HELP.invalid(ref)));
            break;
        case 'untranslated':
            span.appendChild(badge('untranslated', '=', 'Same as ' + ref, FILTER_HELP.untranslated(ref)));
            break;
        case 'extra':
            span.appendChild(badge('extra', '+', 'Only in locale', FILTER_HELP.extra(ref)));
            break;
        }
        if (row.placeholderIssue) {
            var parts = [];
            if (row.placeholderIssue.missing.length) parts.push('missing ' + row.placeholderIssue.missing.join(' '));
            if (row.placeholderIssue.extra.length) parts.push('extra ' + row.placeholderIssue.extra.join(' '));
            span.appendChild(badge('placeholders', '\u26a0', 'Placeholders',
                'Placeholders differ from ' + ref + ': ' + parts.join('; ')));
        }
        return span;
    }

    // What the two kinds of differences mean, above the rows.
    function legend(ref) {
        var box = el('div', 'ld-legend');
        [
            ['missing', '\u2715', 'Missing', 'no entry; users see the ' + ref + ' text'],
            ['placeholders', '\u26a0', 'Placeholders', 'differ from ' + ref],
            ['untranslated', '=', 'Same as ' + ref, 'entry exists, same text; fine for names'],
            ['extra', '+', 'Only in locale', 'not used by ' + ref],
        ].forEach(function(item) {
            var entry = el('span', 'ld-legend-item');
            entry.appendChild(badge(item[0], item[1], item[2], ''));
            entry.appendChild(document.createTextNode(' ' + item[3]));
            box.appendChild(entry);
        });
        return box;
    }

    function sideCell(row, side) {
        var entry = side === 'left' ? row.left : row.right;
        var cell = el('div', 'ld-cell ld-' + side);
        if (!entry) {
            cell.classList.add('is-empty');
            cell.appendChild(el('span', 'ld-ln', ''));
            if (side === 'left') {
                cell.appendChild(el('span', 'ld-placeholder', 'Not in ' + referenceName()));
            } else {
                var missing = el('span', 'ld-placeholder is-missing');
                missing.appendChild(el('strong', '', '\u2715 Missing in this locale'));
                missing.appendChild(el('span', 'ld-fallback', 'Users see the ' + referenceName() + ' text: ' +
                    (row.left && row.left.valid ? '\u201c' + row.left.message + '\u201d' : '(none)')));
                cell.appendChild(missing);
                if (row.left && row.left.valid) {
                    var add = actionButton('+ Add', 'Add this key to ' + localeName() + ', starting from the ' +
                        referenceName() + ' text', function() { editMessage(row, cell); });
                    add.classList.add('ld-add');
                    cell.appendChild(add);
                }
            }
            return cell;
        }
        cell.appendChild(el('span', 'ld-ln', String(side === 'left' ? row.leftLine : row.rightLine)));
        var content = el('span', 'ld-content');
        var keyLine = el('span', 'ld-key', entry.key);
        content.appendChild(keyLine);
        if (side === 'right') content.appendChild(badges(row));
        content.appendChild(el('span', 'ld-msg' + (entry.valid ? '' : ' is-invalid'), messageText(entry)));
        cell.appendChild(content);
        if (side === 'right') {
            cell.appendChild(actionButton('Edit', 'Edit this message (Ctrl/Cmd+Enter saves)', function() {
                editMessage(row, cell);
            }));
        }
        return cell;
    }

    function localeName() {
        return state.result.locales[state.localeKey].name;
    }

    function actionButton(text, title, onClick) {
        var button = el('button', 'ld-action', text);
        button.type = 'button';
        button.title = title;
        button.onclick = function(event) {
            event.stopPropagation();
            onClick();
        };
        button.ondblclick = function(event) { event.stopPropagation(); };
        return button;
    }

    // ---- Editing messages

    // Replaces the right side of a row with a text box.
    function editMessage(row, cell) {
        var isNew = !row.right;
        var initial = isNew ? (row.left && row.left.valid ? row.left.message : '') :
            (row.right.valid ? row.right.message : '');
        cell.textContent = '';
        cell.classList.remove('is-empty');
        cell.classList.add('is-editing');
        cell.appendChild(el('span', 'ld-ln', isNew ? '+' : String(row.rightLine)));
        var form = el('form', 'ld-edit');
        form.appendChild(el('span', 'ld-key', row.key + (isNew ? ' (new in ' + localeName() + ')' : '')));
        var input = el('textarea', 'ld-edit-input');
        input.value = initial;
        input.rows = Math.min(8, Math.max(2, Math.ceil(initial.length / 60)));
        input.setAttribute('aria-label', 'Message of ' + row.key + ' in ' + localeName());
        form.appendChild(input);
        if (row.left && row.left.valid) {
            form.appendChild(el('span', 'ld-edit-reference', referenceName() + ': ' + row.left.message));
        }
        var buttons = el('span', 'ld-edit-buttons');
        var save = el('button', 'ld-edit-save', isNew ? 'Add' : 'Save');
        save.type = 'submit';
        var cancel = el('button', '', 'Cancel');
        cancel.type = 'button';
        cancel.onclick = function() { renderBody(); };
        buttons.append(save, cancel);
        form.appendChild(buttons);
        form.onsubmit = function(event) {
            event.preventDefault();
            save.disabled = true;
            var description = isNew && row.left && row.left.description;
            writeMessages([{key: row.key, message: input.value, description: description}]).catch(function(error) {
                save.disabled = false;
                alert('Could not change ' + localeName() + '/messages.json: ' + (error && error.message || error));
            });
        };
        input.onkeydown = function(event) {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                event.preventDefault();
                form.requestSubmit();
            } else if (event.key === 'Escape') {
                event.preventDefault();
                renderBody();
            }
        };
        form.ondblclick = function(event) { event.stopPropagation(); };
        cell.appendChild(form);
        input.focus();
        input.select();
    }

    // Adds every missing key, with the reference text as a start.
    function addAllMissing() {
        var missing = state.rows.filter(function(row) {
            return row.status === 'missing' && row.left && row.left.valid;
        });
        if (!missing.length) return;
        if (!confirm('Add ' + missing.length + ' missing key' + (missing.length === 1 ? '' : 's') + ' to ' +
            localeName() + '/messages.json with the ' + referenceName() + ' text? They show as \u201cSame as ' +
            referenceName() + '\u201d until they are translated.')) return;
        writeMessages(missing.map(function(row) {
            return {key: row.key, message: row.left.message, description: row.left.description};
        })).catch(function(error) {
            alert('Could not change ' + localeName() + '/messages.json: ' + (error && error.message || error));
        });
    }

    // Writes messages into the locale's messages.json, then scans again.
    function writeMessages(changes) {
        var locale = state.result.locales[state.localeKey];
        var item = getFileListItem(locale.filename);
        if (!item || !item.zipEntry) return Promise.reject(new Error('The file is not in the add-on.'));
        var entry = item.zipEntry;
        var rowsElem = document.querySelector('#source-code .ld-rows');
        pendingRestore = {scrollTop: rowsElem ? rowsElem.scrollTop : 0};
        return Promise.all([readEntryText(entry), readCurrentText(entry)]).then(function(texts) {
            var text = texts[1];
            changes.forEach(function(change) {
                text = setMessageInJson(text, change.key, change.message, change.description);
            });
            setPatchedText(entry, texts[0], text);
            scanLocaleCoverage();
        }, function(error) {
            pendingRestore = null;
            throw error;
        });
    }

    // Finds the top-level keys of a messages.json text, with the position of
    // each value and of its "message" string. Allows comments.
    function scanMessagesJson(text) {
        var i = 0;
        var n = text.length;
        function skipSpace() {
            while (i < n) {
                var c = text[i];
                if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\ufeff') {
                    i++;
                } else if (c === '/' && text[i + 1] === '/') {
                    i = text.indexOf('\n', i);
                    if (i === -1) i = n;
                } else if (c === '/' && text[i + 1] === '*') {
                    var end = text.indexOf('*/', i + 2);
                    i = end === -1 ? n : end + 2;
                } else {
                    break;
                }
            }
        }
        function readString() {
            var start = i++;
            while (i < n) {
                var c = text[i];
                if (c === '\\') {
                    i += 2;
                } else if (c === '"') {
                    i++;
                    return {start: start, end: i, value: JSON.parse(text.slice(start, i))};
                } else {
                    i++;
                }
            }
            throw new Error('Unterminated string');
        }
        function skipValue() {
            skipSpace();
            var c = text[i];
            if (c === '"') {
                readString();
                return;
            }
            if (c === '{' || c === '[') {
                var depth = 0;
                while (i < n) {
                    c = text[i];
                    if (c === '"') {
                        readString();
                        continue;
                    }
                    if (c === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
                        skipSpace();
                        continue;
                    }
                    if (c === '{' || c === '[') depth++;
                    else if (c === '}' || c === ']') {
                        depth--;
                        if (depth === 0) {
                            i++;
                            return;
                        }
                    }
                    i++;
                }
                return;
            }
            while (i < n && !/[,}\]\s]/.test(text[i])) i++;
        }
        skipSpace();
        if (text[i] !== '{') throw new Error('messages.json is not a JSON object');
        var objectStart = i++;
        var entries = new Map();
        var firstKeyStart = -1;
        var lastValueEnd = -1;
        var messageStart = -1;
        for (;;) {
            skipSpace();
            if (i >= n) throw new Error('Unexpected end of messages.json');
            if (text[i] === '}') break;
            if (text[i] !== '"') throw new Error('Unexpected character at position ' + i);
            var key = readString();
            if (firstKeyStart === -1) firstKeyStart = key.start;
            skipSpace();
            if (text[i] !== ':') throw new Error('Expected ":" after ' + key.value);
            i++;
            skipSpace();
            var record = {valueStart: i, message: null};
            if (text[i] === '{') {
                i++;
                for (;;) {
                    skipSpace();
                    if (text[i] === '}') {
                        i++;
                        break;
                    }
                    var inner = readString();
                    skipSpace();
                    i++; // ':'
                    skipSpace();
                    if (inner.value === 'message' && text[i] === '"') {
                        record.message = readString();
                        if (messageStart === -1) messageStart = inner.start;
                    } else {
                        skipValue();
                    }
                    skipSpace();
                    if (text[i] === ',') i++;
                }
            } else {
                skipValue();
            }
            record.valueEnd = i;
            lastValueEnd = i;
            entries.set(key.value.toLowerCase(), record);
            skipSpace();
            if (text[i] === ',') i++;
        }
        function indentAt(position, fallback) {
            if (position === -1) return fallback;
            var lineStart = text.lastIndexOf('\n', position - 1) + 1;
            var indent = text.slice(lineStart, position);
            return /^[ \t]*$/.test(indent) ? indent : fallback;
        }
        var indent = indentAt(firstKeyStart, '    ');
        return {
            entries: entries,
            objectStart: objectStart,
            lastValueEnd: lastValueEnd,
            indent: indent,
            innerIndent: indentAt(messageStart, indent + indent),
            newline: text.indexOf('\r\n') !== -1 ? '\r\n' : '\n',
        };
    }

    // Sets the message of a key, adding the key (at the end) if needed.
    function setMessageInJson(text, key, message, description) {
        var info = scanMessagesJson(text);
        var record = info.entries.get(key.toLowerCase());
        if (record && record.message) {
            return text.slice(0, record.message.start) + JSON.stringify(message) + text.slice(record.message.end);
        }
        var nl = info.newline;
        var value = '{' + nl + info.innerIndent + '"message": ' + JSON.stringify(message) +
            (description ? ',' + nl + info.innerIndent + '"description": ' + JSON.stringify(description) : '') +
            nl + info.indent + '}';
        if (record) {
            // An entry without a valid message: replace its value.
            return text.slice(0, record.valueStart) + value + text.slice(record.valueEnd);
        }
        var entryText = JSON.stringify(key) + ': ' + value;
        if (info.lastValueEnd === -1) {
            return text.slice(0, info.objectStart + 1) + nl + info.indent + entryText + nl + text.slice(info.objectStart + 1);
        }
        return text.slice(0, info.lastValueEnd) + ',' + nl + info.indent + entryText + text.slice(info.lastValueEnd);
    }

    function inlineBlock(row, referenceName, localeName) {
        var block = el('div', 'ld-inline');
        var header = el('div', 'ld-inline-key');
        header.append(el('span', 'ld-key', row.key), badges(row));
        block.appendChild(header);
        function line(kind, sign, name, entry, absent) {
            var lineElem = el('div', 'ld-inline-line is-' + kind);
            lineElem.append(el('span', 'ld-sign', sign), el('span', 'ld-inline-locale', name),
                el('span', 'ld-msg' + (entry && !entry.valid ? ' is-invalid' : ''), entry ? messageText(entry) : absent));
            block.appendChild(lineElem);
        }
        if (row.status === 'untranslated' || row.status === 'same') {
            line('same', '=', referenceName + ' = ' + localeName, row.left);
        } else {
            line(row.left ? 'del' : 'absent', row.left ? '\u2212' : ' ', referenceName, row.left, 'Not in ' + referenceName);
            line(row.right ? 'add' : 'missing', row.right ? '+' : '\u2715', localeName, row.right,
                'Missing \u2014 users see the ' + referenceName + ' text');
        }
        return block;
    }

    function visibleRows() {
        var search = state.search.trim().toLowerCase();
        return state.rows.filter(function(row) {
            return matchesFilter(row, prefs.filter) && matchesSearch(row, search);
        });
    }

    function renderRows(list, ruler) {
        var result = state.result;
        var referenceName = result.locales[state.referenceKey].name;
        var localeName = result.locales[state.localeKey].name;
        var rows = visibleRows();
        state.visible = rows;
        state.focusIndex = -1;
        list.textContent = '';
        ruler.textContent = '';
        if (!rows.length) {
            list.appendChild(el('p', 'ld-empty-message', state.rows.length ?
                'No keys match this filter.' : 'These locales have no messages.'));
            updateNavStatus();
            return;
        }
        var fragment = document.createDocumentFragment();
        rows.forEach(function(row, index) {
            var rowElem;
            if (prefs.layout === 'split') {
                rowElem = el('div', 'ld-row');
                rowElem.append(sideCell(row, 'left'), sideCell(row, 'right'));
            } else {
                rowElem = inlineBlock(row, referenceName, localeName);
            }
            rowElem.classList.add('is-' + row.status);
            if (row.placeholderIssue) rowElem.classList.add('has-placeholder-issue');
            if (row.problem) rowElem.classList.add('is-problem');
            if (row.review) rowElem.classList.add('is-review');
            rowElem.dataset.index = index;
            rowElem.title = 'Double-click to open this key in ' +
                (row.right ? localeName : referenceName) + '/messages.json';
            rowElem.ondblclick = function() {
                openLocaleFile(row.right ? state.localeKey : state.referenceKey, row.key);
            };
            row.elem = rowElem;
            fragment.appendChild(rowElem);
            if (row.attention) {
                var mark = el('span', 'ld-mark is-' + (row.placeholderIssue && row.status === 'translated' ?
                    'placeholders' : row.status) + (row.problem ? ' is-problem' : ' is-review'));
                mark.style.top = (index / rows.length * 100) + '%';
                mark.style.height = Math.max(100 / rows.length, 0.4) + '%';
                mark.onclick = function() { focusRow(index); };
                ruler.appendChild(mark);
            }
        });
        list.appendChild(fragment);
        updateNavStatus();
    }

    // ---- Navigation between differences

    function attentionIndexes() {
        var indexes = [];
        (state.visible || []).forEach(function(row, i) {
            if (row.attention) indexes.push(i);
        });
        return indexes;
    }

    function focusRow(index) {
        var row = state.visible[index];
        if (!row || !row.elem) return;
        if (state.focusIndex !== -1 && state.visible[state.focusIndex] && state.visible[state.focusIndex].elem) {
            state.visible[state.focusIndex].elem.classList.remove('is-focused');
        }
        state.focusIndex = index;
        row.elem.classList.add('is-focused');
        row.elem.scrollIntoView({block: 'center'});
        updateNavStatus();
    }

    function goToDifference(direction) {
        if (!state) return;
        if (prefs.mode === 'file') {
            if (state.fileDiff) state.fileDiff.goToChange(direction);
            return;
        }
        var indexes = attentionIndexes();
        if (!indexes.length) return;
        var current = state.focusIndex;
        var target;
        if (direction > 0) {
            target = indexes.find(function(i) { return i > current; });
            if (target === undefined) target = indexes[0];
        } else {
            target = indexes.slice().reverse().find(function(i) { return i < current; });
            if (target === undefined) target = indexes[indexes.length - 1];
        }
        focusRow(target);
    }

    function updateNavStatus() {
        var status = document.querySelector('#source-toolbar .ld-nav-status');
        if (!status || !state) return;
        if (prefs.mode === 'file') {
            status.textContent = '';
            return;
        }
        var indexes = attentionIndexes();
        var position = indexes.indexOf(state.focusIndex);
        var problems = 0;
        (state.visible || []).forEach(function(row) { if (row.problem) problems++; });
        var review = indexes.length - problems;
        status.textContent = '';
        if (!indexes.length) {
            status.textContent = 'No differences';
            return;
        }
        if (position !== -1) status.appendChild(document.createTextNode((position + 1) + ' of ' + indexes.length + ' \u00b7 '));
        var p = el('span', 'ld-nav-problems', problems + ' problem' + (problems === 1 ? '' : 's'));
        var r = el('span', 'ld-nav-review', review + ' to review');
        status.append(p, ' \u00b7 ', r);
    }

    document.addEventListener('keydown', function(event) {
        if (!state || event.key !== 'F7' || event.ctrlKey || event.metaKey || event.altKey) return;
        event.preventDefault();
        goToDifference(event.shiftKey ? -1 : 1);
    });

    // ---- Opening a messages.json file

    function openLocaleFile(localeKey, key) {
        var result = state ? state.result : localeCoverageResults;
        var locale = result && result.locales[localeKey];
        if (!locale) return;
        var item = getFileListItem(locale.filename);
        if (!item) return;
        openFileFromList(locale.filename);
        if (!key || !item.zipEntry) return;
        readCurrentText(item.zipEntry).then(function(text) {
            var index = (text || '').indexOf('"' + key + '"');
            if (index === -1) return;
            var line = text.slice(0, index).split('\n').length;
            // The editor is created asynchronously.
            var tries = 0;
            (function scroll() {
                if (window.currentCodeEditor && window.currentCodeEditor.scrollToLine) {
                    window.currentCodeEditor.scrollToLine(line);
                } else if (++tries < 20) {
                    setTimeout(scroll, 100);
                }
            })();
        });
    }

    return {
        open: open,
        refresh: refresh,
        // For tests.
        setMessageInJson: setMessageInJson,
        markStale: markStale,
        isOpen: isOpen,
        currentLocale: function() { return state && state.localeKey; },
    };
})();
