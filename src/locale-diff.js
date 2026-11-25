/**
 * Copyright 2026 Subham Mahesh
 * SPDX-License-Identifier: LicenseRef-21CLL-1.0-CV-LGPL-3.0-only OR LGPL-3.0-only
 *
 * Licensed under The 21st Century Liberation License, Version 1.0
 * (the "License"). You may copy and distribute this file, with or
 * without changes, only in compliance with the License. You may obtain
 * a copy of the License in the LICENSE.txt file accompanying this work.
 *
 * Unless required by applicable law or agreed to in writing, this file
 * is distributed under the License on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See
 * the License for the specific language governing permissions and
 * limitations under the License.
 * This file is also subject to the Contributor Variation set named
 * "LGPL-3.0-only" in Exception.txt.
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
 * with the reference text to translate), and placeholder problems fixed: an
 * automatic fix is suggested where a placeholder was clearly damaged (e.g. "1"
 * for "$1"), and every fix is shown in a review dialog to check, edit or skip
 * before anything is written. The keys that need work (missing, wrong
 * placeholders and, optionally, the same as the reference) can be exported to
 * a JSON file for translation and imported again, also with a review dialog.
 *
 * The All languages view compares every language with the reference: a table
 * of counts by category (missing, placeholders, invalid, same as the
 * reference, only in the locale), and the keys of one category in every
 * messages.json. From there, placeholders can be auto-fixed, and keys
 * exported and imported, for all languages at once. Only the changed message is written
 * into the locale's messages.json, so the rest of the file keeps its format;
 * the edit appears in the Changes panel like any other edit.
 *
 * The data comes from the locale scan of viewer.js (localeCoverageResults).
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals localeCoverageResults, normalizeLocaleCode, getFileListItem, readCurrentText, readEntryText,
           setPatchedText, openFileFromList, renderLocaleCoverage, scanLocaleCoverage, viewFileInfo,
           ZenEditor, ZenI18nUsage */
'use strict';

var ZenLocaleDiff = (function() {
    var PREFS_KEY = 'zen-locale-diff-prefs';
    var prefs = {layout: 'split', mode: 'messages', filter: 'all', category: 'missing', codeCategory: 'missing'};
    try {
        var saved = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
        ['layout', 'mode', 'filter', 'category', 'codeCategory'].forEach(function(name) {
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

    // Keeps the category chips of a scrolling view just below its sticky head.
    function pinBelow(view, head) {
        requestAnimationFrame(function() {
            view.style.setProperty('--ld-all-head-height', head.offsetHeight + 'px');
        });
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
            var rows = document.querySelector('#source-code .ld-rows, #source-code .ld-all-view');
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
            ['all', 'All languages', 'Problems by category in the messages.json of every language'],
            ['code', 'In code', 'Message keys used in the JS, HTML, CSS and manifest, including keys built at ' +
                'run time, compared with the reference messages.json'],
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
        } else if (prefs.mode === 'all') {
            renderAllLanguages(code);
        } else if (prefs.mode === 'code') {
            renderCodeUsage(code);
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
        if (c.placeholders && state.referenceKey !== state.localeKey) {
            var autoFix = el('button', 'ld-add-all ld-auto-fix', 'Auto-fix ' + c.placeholders + ' placeholder' +
                (c.placeholders === 1 ? '' : 's'));
            autoFix.type = 'button';
            autoFix.title = 'Suggest fixes for placeholders that differ from ' + referenceName +
                ', and review them before they are written to ' + localeName + '/messages.json';
            autoFix.onclick = function() { reviewPlaceholderFixes(false); };
            head.appendChild(autoFix);
        }
        if (state.referenceKey !== state.localeKey) {
            var exportButton = el('button', 'ld-add-all ld-export', 'Export JSON');
            exportButton.type = 'button';
            exportButton.title = 'Export the keys of ' + localeName + ' that need work (missing, placeholders and, ' +
                'if you choose, the same as ' + referenceName + ') to a JSON file for translation';
            exportButton.onclick = function() { exportForTranslation(false); };
            var importButton = el('button', 'ld-add-all ld-import', 'Import JSON');
            importButton.type = 'button';
            importButton.title = 'Import translations from an exported JSON file; you review every change first';
            importButton.onclick = importTranslations;
            head.append(exportButton, importButton);
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

    // ---- Fixing placeholders

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // The placeholders of |message| as written there (e.g. "$1", "$COUNT$"),
    // keyed by their lower-case form.
    function placeholderForms(message) {
        var forms = {};
        ((message || '').match(/\$[A-Za-z0-9_@]+\$|\$[1-9]/g) || []).forEach(function(token) {
            if (!forms[token.toLowerCase()]) forms[token.toLowerCase()] = token;
        });
        return forms;
    }

    // Suggests a fixed locale message for a row with a placeholder problem, as
    // {text, notes, careful}, or null if no safe fix is found. Only clearly
    // damaged placeholders are repaired; the result must have exactly the
    // placeholders of the reference.
    function suggestPlaceholderFix(row) {
        var reference = row.left.message;
        var text = row.right.message;
        var wanted = placeholderForms(reference);
        var notes = [];
        var careful = false;
        function missing() {
            var have = placeholders(text);
            return Object.keys(wanted).filter(function(t) { return have.indexOf(t) === -1; });
        }
        function extra() {
            return placeholders(text).filter(function(t) { return !wanted[t]; });
        }
        function replaceOnce(pattern, replacement, note) {
            var matches = text.match(new RegExp(pattern.source, pattern.flags.replace('g', '') + 'g')) || [];
            if (matches.length !== 1) return false;
            var before = text;
            text = text.replace(pattern, function(match, lead) {
                return (typeof lead === 'string' ? lead : '') + replacement;
            });
            if (text === before) return false;
            notes.push(note.replace('{found}', matches[0].replace(/^[^$＄%{0-9A-Za-z]/, '')));
            return true;
        }
        missing().forEach(function(token) {
            var form = wanted[token];
            var number = /^\$([1-9])$/.exec(form);
            if (number) {
                var n = number[1];
                // Full-width, spaced or other common forms of $N.
                if (replaceOnce(new RegExp('(^|[^0-9])(?:＄\\s*' + n + '|\\$\\s+' + n + '|%' + n + '(?:\\$s)?|\\{' + n +
                    '\\})(?![0-9])'), form, 'Replaced “{found}” with “' + form + '”')) return;
                // A bare number that lost its "$", if the reference does not use that number as text.
                if (!new RegExp('(^|[^0-9$])' + n + '(?![0-9])').test(reference) &&
                    replaceOnce(new RegExp('(^|[^0-9$＄%{])' + n + '(?![0-9])'), form,
                        'Replaced “{found}” with “' + form + '”')) return;
            } else {
                var name = escapeRegExp(form.slice(1, -1));
                // Full-width or spaced forms, or a missing closing "$" (any case).
                if (replaceOnce(new RegExp('(^|[^A-Za-z0-9_@])(?:[$＄]\\s*' + name + '\\s*[＄]|＄\\s*' + name +
                    '\\s*[$]|\\$\\s+' + name + '\\s*\\$|\\$' + name + '\\s+\\$)', 'i'), form,
                    'Replaced “{found}” with “' + form + '”')) return;
                if (replaceOnce(new RegExp('(^|[^A-Za-z0-9_@$])[$＄]' + name + '(?![A-Za-z0-9_@$＄])', 'i'), form,
                    'Replaced “{found}” with “' + form + '”')) return;
            }
        });
        // One wrong placeholder where one is missing (e.g. "$2" for "$1").
        var stillMissing = missing();
        var surplus = extra();
        if (stillMissing.length === 1 && surplus.length === 1) {
            var found = placeholderForms(text)[surplus[0]];
            text = text.split(found).join(wanted[stillMissing[0]]);
            notes.push('Replaced “' + found + '” with “' + wanted[stillMissing[0]] + '”');
            careful = true;
        }
        if (!notes.length || missing().length || extra().length) return null;
        return {text: text, notes: notes, careful: careful};
    }

    // ---- Other locales (the All languages view and actions on all languages)

    // Every locale except the reference, by name.
    function otherLocaleKeys() {
        var locales = state.result.locales;
        return Object.keys(locales).filter(function(k) { return k !== state.referenceKey; })
            .sort(function(a, b) { return locales[a].name.localeCompare(locales[b].name); });
    }
    function nameOf(localeKey) {
        return state.result.locales[localeKey].name;
    }
    // The rows of |localeKey| compared with the reference.
    function rowsFor(localeKey) {
        if (localeKey === state.localeKey) return state.rows;
        if (!state.rowCache) state.rowCache = {};
        if (!state.rowCache[localeKey]) {
            state.rowCache[localeKey] = buildRows(state.result.locales[state.referenceKey],
                state.result.locales[localeKey], localeKey === state.referenceKey);
        }
        return state.rowCache[localeKey];
    }
    // The locales an action applies to: all of them, or the one shown.
    function scopeKeys(all) {
        return all ? otherLocaleKeys() : [state.localeKey];
    }

    // A small modal dialog with |body| and buttons; |onClose(value)| gets the
    // value of the button that closed it ('' if closed otherwise).
    function modal(titleText, introText, body, buttons, onClose) {
        var dialog = el('dialog', 'ld-fix-dialog');
        var form = el('form', 'ld-fix-form');
        form.method = 'dialog';
        var title = el('h2', 'ld-fix-title', titleText);
        title.id = 'ld-modal-title';
        dialog.setAttribute('aria-labelledby', title.id);
        form.appendChild(title);
        if (introText) form.appendChild(el('p', 'ld-fix-intro', introText));
        form.appendChild(body);
        var row = el('div', 'ld-fix-buttons');
        buttons.forEach(function(spec) {
            var button = el('button', spec.primary ? 'ld-edit-save' : '', spec.text);
            button.type = 'submit';
            button.value = spec.value;
            row.appendChild(button);
        });
        form.appendChild(row);
        dialog.appendChild(form);
        document.body.appendChild(dialog);
        dialog.addEventListener('close', function() {
            var value = dialog.returnValue;
            dialog.remove();
            onClose(value);
        });
        dialog.showModal();
        var first = body.querySelector('textarea, input');
        if (first) first.focus();
        return dialog;
    }

    // A review card for one proposed message: {localeKey, row, text, note,
    // careful, selected, isNew}. Adds item.check, item.input and keeps item.ok
    // (whether the placeholders match the reference) up to date.
    function reviewCard(item, showLocale) {
        var card = el('div', 'ld-fix-item' + (item.careful ? ' is-careful' : ''));
        var label = el('label', 'ld-fix-check');
        var check = el('input');
        check.type = 'checkbox';
        check.checked = item.selected;
        label.append(check, ' ');
        if (showLocale) label.append(el('span', 'ld-fix-locale', nameOf(item.localeKey)), ' ');
        label.append(el('code', 'ld-key', item.row.key), item.isNew ? ' (new in ' + nameOf(item.localeKey) + ')' : '');
        card.appendChild(label);
        card.appendChild(el('div', 'ld-fix-line', referenceName() + ': ' + item.row.left.message));
        var current = item.row.right && item.row.right.valid ? item.row.right.message : null;
        card.appendChild(el('div', 'ld-fix-line is-current', 'Current: ' + (current === null ? '(missing)' : current)));
        var input = el('textarea', 'ld-fix-input');
        input.value = item.text;
        input.rows = Math.min(6, Math.max(2, Math.ceil(input.value.length / 70)));
        input.setAttribute('aria-label', 'Message of ' + item.row.key + ' in ' + nameOf(item.localeKey));
        card.appendChild(input);
        if (item.note) card.appendChild(el('div', 'ld-fix-note', item.note));
        var status = el('div', 'ld-fix-status');
        card.appendChild(status);
        function update() {
            var want = placeholders(item.row.left.message).join(' ');
            var have = placeholders(input.value).join(' ');
            item.ok = want === have;
            status.textContent = item.ok ? 'Placeholders match ' + referenceName() :
                'Placeholders differ: ' + (have || 'none') + ' (needs ' + (want || 'none') + ')';
            status.className = 'ld-fix-status ' + (item.ok ? 'is-ok' : 'is-bad');
        }
        input.oninput = function() {
            update();
            if (!check.checked && input.value !== (current === null ? '' : current)) check.checked = true;
        };
        update();
        item.check = check;
        item.input = input;
        return card;
    }

    // Writes the chosen review items, after asking about any whose
    // placeholders still differ.
    function applyReviewed(items) {
        var chosen = items.filter(function(item) {
            var current = item.row.right && item.row.right.valid ? item.row.right.message : null;
            return item.check.checked && item.input.value.trim() && item.input.value !== current;
        });
        if (!chosen.length) return;
        var wrong = chosen.filter(function(item) { return !item.ok; });
        if (wrong.length && !confirm(wrong.length + ' selected message' + (wrong.length === 1 ? ' has' : 's have') +
            ' placeholders that differ from ' + referenceName() + '. Save anyway?')) return;
        writeChanges(chosen.map(function(item) {
            return {localeKey: item.localeKey, key: item.row.key, message: item.input.value,
                description: item.isNew ? item.row.left.description : undefined};
        })).catch(function(error) {
            alert('Could not save the changes: ' + (error && error.message || error));
        });
    }

    // Lists the review items in groups ([heading, items]), by locale when
    // several locales are involved.
    function reviewList(groups, several) {
        var list = el('div', 'ld-fix-list');
        groups.forEach(function(group) {
            if (!group[1].length) return;
            list.appendChild(el('h3', 'ld-fix-group', group[0]));
            group[1].forEach(function(item) { list.appendChild(reviewCard(item, several)); });
        });
        return list;
    }

    // Opens a dialog listing every placeholder problem (in the locale shown,
    // or in all languages): suggested fixes are selected, the others are
    // listed for manual review. Nothing is written until "Apply" is chosen.
    function reviewPlaceholderFixes(all) {
        var keys = scopeKeys(all === true);
        var items = [];
        keys.forEach(function(localeKey) {
            rowsFor(localeKey).forEach(function(row) {
                if (!row.placeholderIssue || !row.left || !row.right || !row.left.valid || !row.right.valid) return;
                var fix = suggestPlaceholderFix(row);
                items.push({localeKey: localeKey, row: row, text: fix ? fix.text : row.right.message,
                    note: fix ? fix.notes.join('; ') + (fix.careful ? ' — check carefully: this replaces a placeholder' : '') : '',
                    careful: !!(fix && fix.careful), selected: !!fix, fixed: !!fix});
            });
        });
        if (!items.length) return;
        var fixable = items.filter(function(item) { return item.fixed; });
        var manual = items.filter(function(item) { return !item.fixed; });
        var where = keys.length === 1 ? nameOf(keys[0]) + '/messages.json' :
            new Set(items.map(function(item) { return item.localeKey; })).size + ' languages';
        modal('Review placeholder fixes',
            fixable.length + ' suggested fix' + (fixable.length === 1 ? '' : 'es') + ' and ' + manual.length +
            ' for manual review in ' + where + '. Check each one: edit the fixed text if needed and untick any you ' +
            'do not want. Nothing is changed until you choose Apply.',
            reviewList([['Suggested fixes', fixable], ['Needs manual review', manual]], keys.length > 1),
            [{text: 'Apply selected', value: 'apply', primary: true}, {text: 'Cancel', value: 'cancel'}],
            function(value) {
                if (value === 'apply') applyReviewed(items);
            });
    }

    // ---- Exporting and importing translations

    var EXPORT_FORMAT = 'zen-source-viewer-locale-translation';
    var EXPORT_KINDS = [
        ['missing', 'Missing', 'keys with no entry', true],
        ['placeholders', 'Placeholders', 'keys whose $1 / $NAME$ placeholders differ', true],
        ['same', 'Same as reference', 'keys whose text is still the same as the reference (optional; fine for names)', false],
    ];

    // The rows of |localeKey| of each kind that can be exported.
    function exportGroups(localeKey) {
        var rows = rowsFor(localeKey);
        return {
            missing: rows.filter(function(row) { return row.status === 'missing' && row.left && row.left.valid; }),
            placeholders: rows.filter(function(row) {
                return row.placeholderIssue && row.left && row.right && row.left.valid && row.right.valid;
            }),
            same: rows.filter(function(row) {
                return row.status === 'untranslated' && !row.placeholderIssue && row.left && row.left.valid;
            }),
        };
    }

    function exportEntry(row, issue) {
        var entry = {key: row.key, issue: issue, reference: row.left.message};
        var forms = placeholderForms(row.left.message);
        var tokens = placeholders(row.left.message);
        if (tokens.length) entry.placeholders = tokens.map(function(t) { return forms[t]; });
        if (row.left.description) entry.description = row.left.description;
        entry.current = row.right && row.right.valid ? row.right.message : null;
        entry.translation = entry.current === null ? '' : entry.current;
        return entry;
    }

    function downloadText(text, filename) {
        var url = URL.createObjectURL(new Blob([text], {type: 'application/json'}));
        var a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function() { URL.revokeObjectURL(url); }, 60000);
    }

    // Asks which languages to export, then exports them as
    // exportForTranslation does.
    function exportChosenLanguages() {
        var keys = otherLocaleKeys();
        var body = el('div', 'ld-fix-list ld-export-options ld-export-languages');
        var checks = keys.map(function(localeKey) {
            var label = el('label', 'ld-fix-check');
            var check = el('input');
            check.type = 'checkbox';
            check.value = localeKey;
            label.append(check, ' ', el('strong', '', nameOf(localeKey)),
                ' — ' + state.result.locales[localeKey].filename);
            body.appendChild(label);
            return check;
        });
        modal('Export for translation (choose languages)',
            'Choose the languages to export. Next, you choose which keys to export.',
            body, [{text: 'Next', value: 'next', primary: true}, {text: 'Cancel', value: 'cancel'}],
            function(value) {
                if (value !== 'next') return;
                var chosen = checks.filter(function(check) { return check.checked; })
                    .map(function(check) { return check.value; });
                if (!chosen.length) {
                    alert('Nothing to export: choose at least one language.');
                    return;
                }
                exportForTranslation(chosen);
            });
    }

    // Exports the chosen kinds of keys, of the locale shown, of all languages
    // (|scope| true) or of the languages listed in |scope|, to a JSON file
    // for translation.
    function exportForTranslation(scope) {
        var keys = Array.isArray(scope) ? scope : scopeKeys(scope === true);
        var every = scope === true;
        var all = every || keys.length > 1;
        var groupsByLocale = {};
        var totals = {missing: 0, placeholders: 0, same: 0};
        keys.forEach(function(localeKey) {
            groupsByLocale[localeKey] = exportGroups(localeKey);
            Object.keys(totals).forEach(function(kind) { totals[kind] += groupsByLocale[localeKey][kind].length; });
        });
        var body = el('div', 'ld-fix-list ld-export-options');
        var checks = {};
        EXPORT_KINDS.forEach(function(kind) {
            var label = el('label', 'ld-fix-check');
            var check = el('input');
            check.type = 'checkbox';
            check.checked = kind[3] && totals[kind[0]] > 0;
            check.disabled = !totals[kind[0]];
            checks[kind[0]] = check;
            label.append(check, ' ', el('strong', '', kind[1].replace('reference', referenceName()) +
                ' (' + totals[kind[0]] + ')'), ' — ' + kind[2].replace('the reference', referenceName()));
            body.appendChild(label);
        });
        var what = every ? 'all ' + keys.length + ' languages' :
            all ? keys.length + ' languages' : nameOf(keys[0]);
        modal('Export for translation' + (every ? ' (all languages)' : all ? ' (' + keys.length + ' languages)' : ''),
            'Choose which keys of ' + what + ' to export. The file lists each key with the ' + referenceName() +
            ' text and the current translation; fill in "translation" and import the file again.',
            body, [{text: 'Export', value: 'export', primary: true}, {text: 'Cancel', value: 'cancel'}],
            function(value) {
                if (value !== 'export') return;
                var locales = keys.map(function(localeKey) {
                    var entries = [];
                    EXPORT_KINDS.forEach(function(kind) {
                        if (!checks[kind[0]].checked) return;
                        groupsByLocale[localeKey][kind[0]].forEach(function(row) {
                            entries.push(exportEntry(row, kind[0]));
                        });
                    });
                    return {locale: nameOf(localeKey), file: state.result.locales[localeKey].filename, entries: entries};
                }).filter(function(locale) { return locale.entries.length; });
                if (!locales.length) {
                    alert('Nothing to export: choose at least one kind of key that has entries.');
                    return;
                }
                var data = {
                    format: EXPORT_FORMAT,
                    version: 1,
                    reference: referenceName(),
                    exported: new Date().toISOString(),
                    instructions: 'Fill in "translation" for each entry. Keep every placeholder listed in ' +
                        '"placeholders" (such as $1 or $NAME$). Then import this file in the locale diff.',
                };
                if (all) {
                    data.locales = locales;
                } else {
                    data.locale = locales[0].locale;
                    data.file = locales[0].file;
                    data.entries = locales[0].entries;
                }
                downloadText(JSON.stringify(data, null, 2) + '\n', (every ? 'all-languages' :
                    all ? keys.length + '-languages' :
                    locales[0].locale.replace(/[^\w.-]+/g, '_')) + '-translation.json');
            });
    }

    // Asks for an exported JSON file (one language or all) and reviews it.
    function importTranslations() {
        var input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,application/json';
        input.onchange = function() {
            var file = input.files[0];
            if (!file) return;
            file.text().then(function(text) {
                var data;
                try {
                    data = JSON.parse(text);
                } catch (e) {
                    throw new Error('The file is not valid JSON.');
                }
                if (!data || data.format !== EXPORT_FORMAT ||
                    !(Array.isArray(data.entries) || Array.isArray(data.locales))) {
                    throw new Error('This is not a translation file exported by Zen Source Viewer.');
                }
                reviewImport(data);
            }).catch(function(error) {
                alert('Cannot import ' + file.name + ': ' + (error && error.message || error));
            });
        };
        input.click();
    }

    // The locale key for a locale name in an imported file, or ''.
    function localeKeyForName(name) {
        if (typeof name !== 'string') return '';
        var wanted = name.toLowerCase().replace(/-/g, '_');
        return Object.keys(state.result.locales).filter(function(key) {
            return key !== state.referenceKey && state.result.locales[key].name.toLowerCase().replace(/-/g, '_') === wanted;
        })[0] || '';
    }

    function reviewImport(data) {
        var notes = [];
        // [{localeKey, entries}]
        var parts = [];
        if (Array.isArray(data.locales)) {
            data.locales.forEach(function(part) {
                var localeKey = part && localeKeyForName(part.locale);
                if (!localeKey || !Array.isArray(part.entries)) {
                    notes.push('Language ' + (part && part.locale || '?') + ' is not in this add-on and is skipped.');
                    return;
                }
                parts.push({localeKey: localeKey, entries: part.entries});
            });
        } else {
            var key = localeKeyForName(data.locale);
            if (!key) {
                key = state.localeKey;
                if (data.locale) notes.push('The file was exported for ' + data.locale + ', but ' + nameOf(key) + ' is open.');
            }
            parts.push({localeKey: key, entries: data.entries});
        }
        var unknown = 0;
        var unchanged = 0;
        var items = [];
        parts.forEach(function(part) {
            var byKey = new Map();
            rowsFor(part.localeKey).forEach(function(row) {
                if (row.left && row.left.valid) byKey.set(row.key.toLowerCase(), row);
            });
            part.entries.forEach(function(entry) {
                var row = entry && typeof entry.key === 'string' && typeof entry.translation === 'string' &&
                    byKey.get(entry.key.toLowerCase());
                if (!row) {
                    unknown++;
                    return;
                }
                var current = row.right && row.right.valid ? row.right.message : null;
                if (!entry.translation.trim() || entry.translation === current) {
                    unchanged++;
                    return;
                }
                items.push({localeKey: part.localeKey, row: row, text: entry.translation, isNew: !row.right,
                    selected: true});
            });
        });
        if (unchanged) notes.push(unchanged + ' entr' + (unchanged === 1 ? 'y is' : 'ies are') + ' empty or unchanged.');
        if (unknown) notes.push(unknown + ' entr' + (unknown === 1 ? 'y does' : 'ies do') + ' not match a key of ' +
            referenceName() + ' and ' + (unknown === 1 ? 'is' : 'are') + ' skipped.');
        if (!items.length) {
            alert('Nothing to import. ' + notes.join(' '));
            return;
        }
        var localeKeys = [];
        items.forEach(function(item) {
            if (localeKeys.indexOf(item.localeKey) === -1) localeKeys.push(item.localeKey);
        });
        var groups = localeKeys.map(function(localeKey) {
            return [nameOf(localeKey), items.filter(function(item) { return item.localeKey === localeKey; })];
        });
        modal('Review imported translations',
            items.length + ' change' + (items.length === 1 ? '' : 's') + ' in ' + (localeKeys.length === 1 ?
                nameOf(localeKeys[0]) + '/messages.json' : localeKeys.length + ' languages') + '. ' + notes.join(' ') +
            ' Check each one, edit it if needed and untick any you do not want. Nothing is changed until you choose Apply.',
            reviewList(groups, false),
            [{text: 'Apply selected', value: 'apply', primary: true}, {text: 'Cancel', value: 'cancel'}],
            function(value) {
                if (value === 'apply') applyReviewed(items);
            });
    }

    // ---- All languages view

    var CATEGORIES = [
        ['missing', '✕ Missing', 'no entry; users see the reference text'],
        ['placeholders', '⚠ Placeholders', 'placeholders differ from the reference'],
        ['invalid', '✕ Invalid', 'the entry cannot be read'],
        ['untranslated', '= Same as reference', 'same text as the reference'],
        ['extra', '+ Only in locale', 'key not used by the reference'],
    ];

    function categoryLabel(category) {
        return category[1].replace('reference', referenceName());
    }

    // Every language compared with the reference: a table of counts by
    // category, and the keys of one category in all languages.
    function renderAllLanguages(code) {
        // The view scrolls as a whole.
        var view = el('div', 'ld-all-view');
        code.appendChild(view);
        code = view;
        var keys = otherLocaleKeys();
        var head = el('div', 'ld-head ld-all-head');
        head.appendChild(el('span', 'ld-all-title', keys.length + ' language' + (keys.length === 1 ? '' : 's') +
            ' compared with ' + referenceName()));
        var countsByLocale = {};
        var totals = {};
        CATEGORIES.forEach(function(category) { totals[category[0]] = 0; });
        keys.forEach(function(localeKey) {
            countsByLocale[localeKey] = {};
            CATEGORIES.forEach(function(category) {
                var n = rowsFor(localeKey).filter(function(row) { return matchesFilter(row, category[0]); }).length;
                countsByLocale[localeKey][category[0]] = n;
                totals[category[0]] += n;
            });
        });
        if (totals.placeholders) {
            var fix = el('button', 'ld-add-all ld-auto-fix', 'Auto-fix placeholders in all languages');
            fix.type = 'button';
            fix.onclick = function() { reviewPlaceholderFixes(true); };
            head.appendChild(fix);
        }
        var exportAll = el('button', 'ld-add-all ld-export', 'Export JSON (all languages)');
        exportAll.type = 'button';
        exportAll.onclick = function() { exportForTranslation(true); };
        var exportSome = el('button', 'ld-add-all ld-export', 'Export JSON (choose languages)');
        exportSome.type = 'button';
        exportSome.title = 'Choose which languages to export';
        exportSome.onclick = exportChosenLanguages;
        var importButton = el('button', 'ld-add-all ld-import', 'Import JSON');
        importButton.type = 'button';
        importButton.title = 'Import an exported file for one language or for all languages; you review every change first';
        importButton.onclick = importTranslations;
        head.append(exportAll, exportSome, importButton);
        code.appendChild(head);
        pinBelow(view, head);

        if (!keys.length) {
            code.appendChild(el('p', 'ld-empty-message', 'The add-on has no other languages than ' + referenceName() + '.'));
            return;
        }

        // Counts by language and category; a count opens that language, filtered.
        var tableWrap = el('div', 'ld-all-table-wrap');
        var table = el('table', 'ld-all-table');
        var thead = el('thead');
        var headRow = el('tr');
        headRow.appendChild(el('th', '', 'Language'));
        CATEGORIES.forEach(function(category) {
            var th = el('th', 'ld-all-cat-' + category[0], categoryLabel(category));
            th.title = category[2].replace('the reference', referenceName());
            headRow.appendChild(th);
        });
        thead.appendChild(headRow);
        table.appendChild(thead);
        var tbody = el('tbody');
        keys.forEach(function(localeKey) {
            var tr = el('tr');
            tr.appendChild(el('th', '', nameOf(localeKey)));
            CATEGORIES.forEach(function(category) {
                var td = el('td');
                var n = countsByLocale[localeKey][category[0]];
                var button = el('button', 'ld-all-count' + (n ? ' has-entries' : ''), String(n));
                button.type = 'button';
                button.disabled = !n;
                button.title = n ? 'Show the ' + n + ' ' + categoryLabel(category).replace(/^\W+\s*/, '') +
                    ' key' + (n === 1 ? '' : 's') + ' of ' + nameOf(localeKey) : '';
                button.onclick = function() { openLocaleCategory(localeKey, category[0], ''); };
                td.appendChild(button);
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tableWrap.appendChild(table);
        code.appendChild(tableWrap);

        // The keys of one category, in every language.
        if (!totals[prefs.category]) {
            var firstWithEntries = CATEGORIES.filter(function(category) { return totals[category[0]]; })[0];
            prefs.category = firstWithEntries ? firstWithEntries[0] : 'missing';
        }
        var chips = el('div', 'ld-filters ld-all-categories');
        CATEGORIES.forEach(function(category) {
            var chip = el('button', 'ld-chip ld-chip-' + category[0]);
            chip.type = 'button';
            chip.classList.toggle('is-active', prefs.category === category[0]);
            chip.setAttribute('aria-pressed', String(prefs.category === category[0]));
            chip.title = category[2].replace('the reference', referenceName());
            chip.append(categoryLabel(category) + ' ', el('span', 'ld-chip-count', String(totals[category[0]])));
            chip.onclick = function() {
                prefs.category = category[0];
                savePrefs();
                renderBody();
            };
            chips.appendChild(chip);
        });
        code.appendChild(chips);

        var list = el('div', 'ld-all-list');
        var any = false;
        keys.forEach(function(localeKey) {
            var rows = rowsFor(localeKey).filter(function(row) { return matchesFilter(row, prefs.category); });
            if (!rows.length) return;
            any = true;
            list.appendChild(el('h3', 'ld-all-locale', nameOf(localeKey) + ' · ' + rows.length));
            rows.forEach(function(row) {
                var item = el('div', 'ld-all-item');
                item.appendChild(el('code', 'ld-key', row.key));
                if (row.left) item.appendChild(el('div', 'ld-all-text', referenceName() + ': ' + messageText(row.left)));
                item.appendChild(el('div', 'ld-all-text is-locale', nameOf(localeKey) + ': ' +
                    (row.right ? messageText(row.right) : '(missing)')));
                var openButton = el('button', 'ld-action', 'Open');
                openButton.type = 'button';
                openButton.title = 'Open this key in the diff of ' + nameOf(localeKey);
                openButton.onclick = function() { openLocaleCategory(localeKey, prefs.category, row.key); };
                item.appendChild(openButton);
                list.appendChild(item);
            });
        });
        if (!any) list.appendChild(el('p', 'ld-empty-message', 'No language has keys in this category.'));
        code.appendChild(list);
    }

    // ---- Message keys used in the code

    var CODE_CATEGORIES = [
        ['missing', '✕ Missing from reference', 'used in the code, but reference has no such message: ' +
            'getMessage returns an empty string'],
        ['unmatched', '⚠ Generated, no match', 'a key built at run time (e.g. prefix_* or *_line1) that ' +
            'matches no message in reference'],
        ['invalid', '✕ Invalid name', 'message names may only have letters, digits, _ and @'],
        ['patterns', '* Generated keys', 'keys built at run time, with the messages in reference they match'],
        ['unknown', '? Not worked out', 'the key comes from a value the scan cannot follow'],
        ['unused', '○ Not found in code', 'messages in reference that no code is found to use'],
    ];

    // The scan of the code for one locale scan: {result, promise, data}.
    var codeScan = null;

    // Reads every code file of the add-on (next to its manifest) and finds
    // the message keys it uses. Resolves to the uses of ZenI18nUsage.
    function scanCode(result) {
        if (codeScan && codeScan.result === result) return codeScan.promise;
        var prefix = result.manifestFilename ?
            result.manifestFilename.slice(0, result.manifestFilename.lastIndexOf('/') + 1) : '';
        var items = [].filter.call(document.querySelectorAll('#file-list li[data-filename]'), function(item) {
            var filename = item.dataset.filename;
            return item.zipEntry && !item.classList.contains('file-removed') &&
                filename.toLowerCase().indexOf(prefix.toLowerCase()) === 0 && ZenI18nUsage.isCodeFile(filename);
        });
        var texts = new Array(items.length);
        var next = 0;
        function worker() {
            if (next >= items.length) return Promise.resolve();
            var index = next++;
            return readCurrentText(items[index].zipEntry).then(function(text) {
                texts[index] = typeof text === 'string' ? text : '';
            }, function() {
                texts[index] = '';
            }).then(worker);
        }
        var workers = [];
        for (var i = 0; i < 6; i++) workers.push(worker());
        var promise = Promise.all(workers).then(function() {
            var scripts = texts.filter(function(text, index) {
                return /\.(?:m?js|cjs|jsx|tsx?)$/i.test(items[index].dataset.filename);
            });
            var wrappers = ZenI18nUsage.collectWrappers(scripts);
            var uses = [];
            items.forEach(function(item, index) {
                uses = uses.concat(ZenI18nUsage.scanText(item.dataset.filename, texts[index], wrappers));
            });
            return {files: items.length, uses: uses};
        });
        codeScan = {result: result, promise: promise};
        return promise;
    }

    // Opens |filename| and scrolls to |line| once the editor is ready.
    function openFileAtLine(filename, line) {
        if (!getFileListItem(filename)) return;
        openFileFromList(filename);
        var tries = 0;
        (function scroll() {
            if (window.currentCodeEditor && window.currentCodeEditor.scrollToLine) {
                window.currentCodeEditor.scrollToLine(line);
            } else if (++tries < 20) {
                setTimeout(scroll, 100);
            }
        })();
    }

    function codeCategoryLabel(category) {
        return category[1].replace('reference', referenceName());
    }

    // Keys used by the JS, HTML, CSS and manifest of the add-on, compared
    // with the messages of the reference locale.
    function renderCodeUsage(code) {
        var view = el('div', 'ld-all-view ld-code-view');
        code.appendChild(view);
        var current = state;
        view.appendChild(el('p', 'ld-empty-message', 'Reading the code of the add-on…'));
        scanCode(state.result).then(function(scan) {
            if (state !== current || prefs.mode !== 'code' || !view.isConnected) return;
            view.textContent = '';
            fillCodeUsage(view, scan);
        }, function(error) {
            if (!view.isConnected) return;
            view.textContent = '';
            view.appendChild(el('p', 'ld-empty-message', 'Could not read the code: ' + (error && error.message || error)));
        });
    }

    function fillCodeUsage(view, scan) {
        var reference = state.result.locales[state.referenceKey];
        var analysis = ZenI18nUsage.analyze(scan.uses, reference, state.result.locales);
        // Mentions (key names found as text) only mark messages as used.
        scan = {files: scan.files, uses: scan.uses.filter(function(use) { return use.how !== 'mention'; })};
        var head = el('div', 'ld-head ld-all-head');
        var literal = new Set(scan.uses.filter(function(use) { return use.pattern !== '*'; })
            .map(function(use) { return use.pattern.toLowerCase(); })).size;
        head.appendChild(el('span', 'ld-all-title', scan.uses.length + ' use' + (scan.uses.length === 1 ? '' : 's') +
            ' of ' + literal + ' key' + (literal === 1 ? '' : 's') + ' in ' + scan.files + ' file' +
            (scan.files === 1 ? '' : 's') + ', compared with ' + referenceName()));
        if (analysis.missing.length) {
            var add = el('button', 'ld-add-all', '+ Add ' + analysis.missing.length + ' to ' + referenceName() + '…');
            add.type = 'button';
            add.title = 'Write the missing keys into ' + referenceName() + '/messages.json; you enter each message first';
            add.onclick = function() { addKeysFromCode(analysis.missing); };
            head.appendChild(add);
        }
        var rescan = el('button', 'ld-add-all', 'Rescan code');
        rescan.type = 'button';
        rescan.onclick = function() {
            codeScan = null;
            renderBody();
        };
        head.appendChild(rescan);
        view.appendChild(head);
        pinBelow(view, head);

        var totals = {};
        CODE_CATEGORIES.forEach(function(category) { totals[category[0]] = analysis[category[0]].length; });
        if (!totals[prefs.codeCategory]) {
            var first = CODE_CATEGORIES.filter(function(category) { return totals[category[0]]; })[0];
            prefs.codeCategory = first ? first[0] : 'missing';
        }
        var chips = el('div', 'ld-filters ld-all-categories');
        CODE_CATEGORIES.forEach(function(category) {
            var chip = el('button', 'ld-chip ld-chip-code-' + category[0]);
            chip.type = 'button';
            chip.classList.toggle('is-active', prefs.codeCategory === category[0]);
            chip.setAttribute('aria-pressed', String(prefs.codeCategory === category[0]));
            chip.title = category[2].replace('reference', referenceName());
            chip.append(codeCategoryLabel(category) + ' ', el('span', 'ld-chip-count', String(totals[category[0]])));
            chip.onclick = function() {
                prefs.codeCategory = category[0];
                savePrefs();
                renderBody();
            };
            chips.appendChild(chip);
        });
        view.appendChild(chips);

        var list = el('div', 'ld-all-list');
        var category = CODE_CATEGORIES.filter(function(c) { return c[0] === prefs.codeCategory; })[0];
        list.appendChild(el('p', 'ld-code-help', category[2].replace('reference', referenceName()) + '.'));
        if (prefs.codeCategory === 'unused' && analysis.unknown.length) {
            list.appendChild(el('p', 'ld-code-help is-warning', analysis.unknown.length + ' place' +
                (analysis.unknown.length === 1 ? '' : 's') + ' in the code build' + (analysis.unknown.length === 1 ? 's' : '') +
                ' keys the scan cannot work out (see “Not worked out”), so some of these may still be used.'));
        }
        var entries = analysis[prefs.codeCategory];
        if (!entries.length) list.appendChild(el('p', 'ld-empty-message', 'Nothing in this category.'));
        entries.forEach(function(entry) {
            list.appendChild(codeUsageItem(entry));
        });
        view.appendChild(list);
    }

    function codeUsageItem(entry) {
        var item = el('div', 'ld-all-item ld-code-item');
        var keyRow = el('div', 'ld-code-key');
        keyRow.appendChild(el('code', 'ld-key', entry.pattern === '*' ? '(unknown key)' : entry.pattern));
        if (entry.uses.length) {
            keyRow.appendChild(el('span', 'ld-code-count', entry.uses.length + ' use' + (entry.uses.length === 1 ? '' : 's')));
        }
        item.appendChild(keyRow);
        if (entry.inLocales) {
            item.appendChild(el('div', 'ld-all-text', entry.inLocales.length ?
                'Only in: ' + entry.inLocales.map(nameOf).join(', ') :
                'In no language'));
        }
        if (entry.matchNames) {
            item.appendChild(el('div', 'ld-all-text' + (entry.matchNames.length ? '' : ' is-locale'),
                entry.matchNames.length ? 'Matches ' + entry.matchNames.length + ': ' +
                    entry.matchNames.slice(0, 30).join(', ') + (entry.matchNames.length > 30 ? ', …' : '') :
                    'Matches no message of ' + referenceName()));
        }
        if (!entry.uses.length) {
            var openButton = el('button', 'ld-action', 'Open');
            openButton.type = 'button';
            openButton.title = 'Open this key in ' + referenceName() + '/messages.json';
            openButton.onclick = function() { openLocaleFile(state.referenceKey, entry.pattern); };
            item.appendChild(openButton);
            return item;
        }
        var uses = el('ul', 'ld-code-uses');
        entry.uses.slice(0, 50).forEach(function(use) {
            var li = el('li');
            var link = el('button', 'ld-code-location', use.file + ':' + use.line);
            link.type = 'button';
            link.title = 'Open ' + use.file + ' at line ' + use.line + ' (' + use.how + ')';
            link.onclick = function() { openFileAtLine(use.file, use.line); };
            li.append(link, el('code', 'ld-code-snippet', use.text));
            uses.appendChild(li);
        });
        if (entry.uses.length > 50) uses.appendChild(el('li', 'ld-code-more', '… and ' + (entry.uses.length - 50) + ' more'));
        item.appendChild(uses);
        return item;
    }

    // Asks for the message of each key used in the code but missing from the
    // reference, then writes the chosen ones.
    function addKeysFromCode(entries) {
        var locales = state.result.locales;
        var body = el('div', 'ld-fix-list');
        var items = entries.map(function(entry) {
            var card = el('div', 'ld-fix-item');
            var label = el('label', 'ld-fix-check');
            var check = el('input');
            check.type = 'checkbox';
            label.append(check, ' ', el('code', 'ld-key', entry.pattern));
            card.appendChild(label);
            var first = entry.uses[0];
            if (first) card.appendChild(el('div', 'ld-fix-line', first.file + ':' + first.line + ': ' + first.text));
            entry.inLocales.forEach(function(localeKey) {
                card.appendChild(el('div', 'ld-fix-line is-current', nameOf(localeKey) + ': ' +
                    messageText(locales[localeKey].messages[entry.pattern.toLowerCase()])));
            });
            var input = el('textarea', 'ld-fix-input');
            input.rows = 2;
            input.placeholder = 'Message in ' + referenceName();
            input.setAttribute('aria-label', 'Message of ' + entry.pattern + ' in ' + referenceName());
            input.oninput = function() { check.checked = !!input.value.trim(); };
            card.appendChild(input);
            body.appendChild(card);
            return {key: entry.pattern, check: check, input: input};
        });
        modal('Add keys used in the code',
            entries.length + ' key' + (entries.length === 1 ? ' is' : 's are') + ' used in the code but missing from ' +
            referenceName() + '/messages.json. Enter the message of each key to add; keys left empty are not added.',
            body,
            [{text: 'Add selected', value: 'apply', primary: true}, {text: 'Cancel', value: 'cancel'}],
            function(value) {
                if (value !== 'apply') return;
                var chosen = items.filter(function(item) { return item.check.checked && item.input.value.trim(); });
                if (!chosen.length) return;
                writeChanges(chosen.map(function(item) {
                    return {localeKey: state.referenceKey, key: item.key, message: item.input.value};
                })).catch(function(error) {
                    alert('Could not change ' + referenceName() + '/messages.json: ' + (error && error.message || error));
                });
            });
    }

    // Opens the Messages view of |localeKey| with |filter| and |search|.
    function openLocaleCategory(localeKey, filter, search) {
        prefs.mode = 'messages';
        prefs.filter = filter;
        savePrefs();
        if (state) state.search = search || '';
        open(state.referenceKey, localeKey);
    }

    // Writes messages into the messages.json of one or more locales
    // ({localeKey, key, message, description}; the locale shown if no
    // localeKey), then scans again. Every file is prepared before any is
    // changed, so a failure changes nothing.
    function writeChanges(changes) {
        var byLocale = new Map();
        changes.forEach(function(change) {
            var localeKey = change.localeKey || state.localeKey;
            if (!byLocale.has(localeKey)) byLocale.set(localeKey, []);
            byLocale.get(localeKey).push(change);
        });
        var rowsElem = document.querySelector('#source-code .ld-rows, #source-code .ld-all-view');
        pendingRestore = {scrollTop: rowsElem ? rowsElem.scrollTop : 0};
        return Promise.all(Array.from(byLocale.keys()).map(function(localeKey) {
            var locale = state.result.locales[localeKey];
            var item = locale && getFileListItem(locale.filename);
            if (!item || !item.zipEntry) {
                return Promise.reject(new Error((locale ? locale.filename : localeKey) + ' is not in the add-on.'));
            }
            return Promise.all([readEntryText(item.zipEntry), readCurrentText(item.zipEntry)]).then(function(texts) {
                var text = texts[1];
                byLocale.get(localeKey).forEach(function(change) {
                    text = setMessageInJson(text, change.key, change.message, change.description);
                });
                return {entry: item.zipEntry, original: texts[0], text: text};
            });
        })).then(function(results) {
            results.forEach(function(result) { setPatchedText(result.entry, result.original, result.text); });
            scanLocaleCoverage();
        }, function(error) {
            pendingRestore = null;
            throw error;
        });
    }

    // Writes messages into the messages.json of the locale shown.
    function writeMessages(changes) {
        return writeChanges(changes);
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
