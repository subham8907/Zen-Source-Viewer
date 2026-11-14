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
 * Entry point for the bundled CodeMirror 6 editor used by the viewer.
 * Bundled by `node make.js codemirror` into src/lib/codemirror/zen-editor.js,
 * which exposes the global `ZenEditor`.
 */

import {
    EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars,
    drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine,
    Decoration, ViewPlugin, gutter, GutterMarker,
} from '@codemirror/view';
import {EditorState, Compartment, EditorSelection, Text, RangeSetBuilder} from '@codemirror/state';
import {
    indentOnInput, syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, foldKeymap,
    indentUnit,
} from '@codemirror/language';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {
    searchKeymap, highlightSelectionMatches, search, gotoLine, SearchQuery, getSearchQuery, openSearchPanel,
} from '@codemirror/search';
import {autocompletion, completionKeymap, closeBrackets, closeBracketsKeymap} from '@codemirror/autocomplete';
import {linter, lintGutter, lintKeymap} from '@codemirror/lint';
import {tags as t} from '@lezer/highlight';
import {javascript} from '@codemirror/lang-javascript';
import {json, jsonParseLinter} from '@codemirror/lang-json';
import {html} from '@codemirror/lang-html';
import {css} from '@codemirror/lang-css';
import {xml} from '@codemirror/lang-xml';
import {markdown} from '@codemirror/lang-markdown';
import {yaml} from '@codemirror/lang-yaml';
import {wast} from '@codemirror/lang-wast';
import {unifiedMergeView, MergeView, Chunk, goToNextChunk, goToPreviousChunk} from '@codemirror/merge';

// Larger files skip the most expensive helpers to stay responsive.
const LARGE_FILE_LENGTH = 1e6;
// Counting stops here; the UI shows "N+" instead of an exact total.
const MAX_COUNTED_MATCHES = 10000;

function languageForFilename(filename) {
    const name = filename.toLowerCase();
    const ext = name.slice(name.lastIndexOf('.') + 1);
    switch (ext) {
    case 'js': case 'mjs': case 'cjs': case 'jsm': case 'es': case 'es6':
        return {name: 'JavaScript', support: javascript()};
    case 'jsx':
        return {name: 'JSX', support: javascript({jsx: true})};
    case 'ts': case 'mts': case 'cts':
        return {name: 'TypeScript', support: javascript({typescript: true})};
    case 'tsx':
        return {name: 'TSX', support: javascript({jsx: true, typescript: true})};
    case 'json': case 'webmanifest': case 'map':
        return {name: 'JSON', support: json(), isJson: true};
    case 'html': case 'htm': case 'xhtml': case 'shtml':
        return {name: 'HTML', support: html()};
    case 'css': case 'less': case 'scss':
        return {name: 'CSS', support: css()};
    case 'xml': case 'rdf': case 'xul': case 'svg': case 'xsl': case 'xslt': case 'dtd': case 'plist':
        return {name: 'XML', support: xml()};
    case 'md': case 'markdown':
        return {name: 'Markdown', support: markdown()};
    case 'yaml': case 'yml':
        return {name: 'YAML', support: yaml()};
    case 'wat': case 'wast':
        return {name: 'WebAssembly', support: wast()};
    }
    return {name: 'Plain text', support: []};
}

// Colors come from CSS custom properties so that light and dark mode follow the page theme.
const zenHighlightStyle = HighlightStyle.define([
    {tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-comment)', fontStyle: 'italic'},
    {tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--syn-keyword)'},
    {tag: [t.string, t.special(t.string), t.regexp, t.character], color: 'var(--syn-string)'},
    {tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)'},
    {tag: [t.function(t.variableName), t.function(t.propertyName)], color: 'var(--syn-function)'},
    {tag: [t.definition(t.variableName), t.definition(t.propertyName)], color: 'var(--syn-definition)'},
    {tag: [t.propertyName, t.attributeName], color: 'var(--syn-property)'},
    {tag: [t.typeName, t.className, t.namespace, t.tagName, t.standard(t.tagName)], color: 'var(--syn-type)'},
    {tag: [t.operator, t.punctuation, t.separator, t.bracket, t.angleBracket], color: 'var(--syn-punctuation)'},
    {tag: [t.meta, t.processingInstruction, t.documentMeta], color: 'var(--syn-meta)'},
    {tag: t.invalid, color: 'var(--danger)'},
    {tag: t.heading, color: 'var(--syn-keyword)', fontWeight: '600'},
    {tag: t.emphasis, fontStyle: 'italic'},
    {tag: t.strong, fontWeight: '600'},
    {tag: t.link, color: 'var(--syn-string)', textDecoration: 'underline'},
]);

const zenTheme = EditorView.theme({
    '&': {
        color: 'var(--text)',
        backgroundColor: 'var(--code-bg)',
        fontSize: '12.5px',
    },
    '.cm-content': {
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        caretColor: 'var(--accent)',
        padding: '8px 0 40vh',
    },
    '.cm-scroller': {
        fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        lineHeight: '1.7',
    },
    '.cm-cursor, .cm-dropCursor': {borderLeftColor: 'var(--accent)', borderLeftWidth: '2px'},
    '&.cm-focused': {outline: 'none'},
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection':
        {backgroundColor: 'var(--cm-selection)'},
    '.cm-activeLine': {backgroundColor: 'var(--cm-active-line)'},
    '.cm-gutters': {
        backgroundColor: 'var(--code-bg)',
        color: 'var(--text-subtle)',
        borderRight: '1px solid var(--border)',
    },
    '.cm-activeLineGutter': {backgroundColor: 'var(--cm-active-line)', color: 'var(--text-muted)'},
    '.cm-lineNumbers .cm-gutterElement': {padding: '0 10px 0 14px'},
    '.cm-foldGutter .cm-gutterElement': {padding: '0 4px', cursor: 'pointer'},
    '.cm-foldPlaceholder': {
        backgroundColor: 'var(--accent-soft)',
        color: 'var(--accent-soft-text)',
        border: 'none',
        borderRadius: '4px',
        padding: '0 6px',
    },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
        backgroundColor: 'var(--accent-soft)',
        outline: '1px solid var(--accent)',
        color: 'inherit',
    },
    '.cm-nonmatchingBracket': {outline: '1px solid var(--danger)'},
    '.cm-selectionMatch': {backgroundColor: 'var(--cm-selection-match)'},
    '.cm-searchMatch': {backgroundColor: 'var(--highlight-fill)', outline: '1px solid var(--highlight-stroke)'},
    '.cm-searchMatch.cm-searchMatch-selected': {backgroundColor: 'var(--highlight-stroke)', color: '#1d1d1b'},
    '.cm-zen-match': {backgroundColor: 'var(--highlight-fill)', outline: '1px solid var(--highlight-stroke)', borderRadius: '2px'},
    '.cm-panels': {
        backgroundColor: 'var(--surface)',
        color: 'var(--text)',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    },
    '.cm-panels.cm-panels-top': {borderBottom: '1px solid var(--border)'},
    '.cm-panels.cm-panels-bottom': {borderTop: '1px solid var(--border)'},
    '.cm-panel.cm-search, .cm-panel.cm-goto-line': {padding: '8px 12px', fontSize: '12.5px'},
    '.cm-panel.cm-goto-line': {display: 'flex', alignItems: 'center', gap: '6px'},
    '.cm-panel input, .cm-panel button, .cm-textfield, .cm-button': {
        font: 'inherit',
        fontSize: '12.5px',
        color: 'var(--text)',
        backgroundColor: 'var(--surface)',
        backgroundImage: 'none',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        padding: '3px 8px',
        margin: '2px 4px 2px 0',
    },
    '.cm-panel label': {fontSize: '12.5px', color: 'var(--text-muted)', marginRight: '8px'},
    '.cm-panel.cm-search [name=close]': {
        border: 'none', background: 'none', fontSize: '18px', color: 'var(--text-subtle)', padding: '0 6px',
    },
    '.cm-tooltip': {
        backgroundColor: 'var(--surface)',
        color: 'var(--text)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: 'var(--shadow-md)',
        overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
        backgroundColor: 'var(--accent-soft)',
        color: 'var(--accent-soft-text)',
    },
    '.cm-diagnostic-error': {borderLeftColor: 'var(--danger)'},
    '.cm-lintRange-error': {backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)'},
    '.cm-specialChar': {color: 'var(--danger)'},

    // Diff views (@codemirror/merge), GitHub-like: green additions, red deletions.
    // `!important` overrides the package's own light/dark colors, which follow
    // the editor's (light) base theme rather than our page theme.
    '.cm-changedLine, &.cm-merge-b .cm-changedLine, .cm-inlineChangedLine': {backgroundColor: 'var(--diff-add-bg) !important'},
    '&.cm-merge-a .cm-changedLine, .cm-deletedChunk': {backgroundColor: 'var(--diff-del-bg) !important'},
    '.cm-changedText, &.cm-merge-b .cm-changedText': {background: 'var(--diff-add-text) !important'},
    '&.cm-merge-a .cm-changedText, .cm-deletedChunk .cm-deletedText': {background: 'var(--diff-del-text) !important'},
    '.cm-changeGutter': {width: '3px', paddingLeft: '0', marginLeft: '2px'},
    '.cm-changedLineGutter, &.cm-merge-b .cm-changedLineGutter': {background: 'var(--diff-add) !important'},
    '&.cm-merge-a .cm-changedLineGutter, .cm-deletedLineGutter': {background: 'var(--diff-del) !important'},
    '.cm-collapsedLines': {
        color: 'var(--text-muted) !important',
        background: 'var(--surface-2) !important',
        fontSize: '12px',
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
    },
    '.cm-deletedChunk button.cm-zen-revert-chunk, .cm-merge-revert button': {
        font: '500 11.5px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        color: 'var(--text-muted)',
        background: 'var(--surface)',
        border: '1px solid var(--border-strong)',
        borderRadius: '6px',
        padding: '1px 8px',
        cursor: 'pointer',
    },
    '.cm-deletedChunk button.cm-zen-revert-chunk:hover, .cm-merge-revert button:hover': {
        color: 'var(--text)',
        borderColor: 'var(--diff-del)',
    },
});

// Line-level counts, like GitHub's "+12 −3".
function diffStats(a, b) {
    let added = 0;
    let removed = 0;
    for (const chunk of Chunk.build(a, b, {scanLimit: 500, timeout: 200})) {
        if (chunk.toA > chunk.fromA) {
            removed += a.lineAt(Math.min(chunk.endA, a.length)).number - a.lineAt(chunk.fromA).number + 1;
        }
        if (chunk.toB > chunk.fromB) {
            added += b.lineAt(Math.min(chunk.endB, b.length)).number - b.lineAt(chunk.fromB).number + 1;
        }
    }
    return {added, removed};
}

function regExpToSearchQuery(regexp) {
    if (!regexp) return null;
    return new SearchQuery({
        search: regexp.source,
        regexp: true,
        caseSensitive: !regexp.ignoreCase,
    });
}

/**
 * Creates an editor.
 *
 * @param {object} options
 * @param {HTMLElement} options.parent
 * @param {string} options.doc The original text (the baseline for diffs and revert).
 * @param {string} [options.initialDoc] Text to show instead of doc, e.g. after
 *     applying a patch; the editor then starts as modified.
 * @param {string} options.filename
 * @param {boolean} options.readOnly
 * @param {boolean} options.wrap
 * @param {function(boolean)} options.onModifiedChange Called with whether the
 *     document differs from the original text.
 */
function create(options) {
    const originalText = options.doc;
    const language = languageForFilename(options.filename);
    const isLarge = originalText.length > LARGE_FILE_LENGTH;

    const originalDoc = Text.of(originalText.split(/\r\n|\r|\n/));
    const readOnlyCompartment = new Compartment();
    const diffCompartment = new Compartment();
    const wrapCompartment = new Compartment();
    const highlightCompartment = new Compartment();
    // Review notes (review-notes.js): a marker in the gutter of each line with a note.
    const notesCompartment = new Compartment();
    const splitHighlightCompartment = new Compartment();

    // Two places can provide the search term: the filter box of the viewer
    // ("!term", via setSearch) and CodeMirror's own search panel (Ctrl/Cmd+F).
    // The toolbar buttons (find next/previous, highlight all) use whichever
    // of the two was changed last.
    let filterQuery = null; // SearchQuery or null.
    let panelQuery = null; // SearchQuery or null.
    let activeSource = 'filter';
    let isHighlighting = false;
    let lastModified = false;
    let currentReadOnly = !!options.readOnly;
    let currentWrap = !!options.wrap;
    // 'off' (plain editor), 'unified' (changes inline) or 'split' (side by side).
    let diffMode = 'off';
    let mergeView = null;
    let splitDom = null;

    function readOnlyExtension(readOnly) {
        return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
    }
    // Hides the "accept" control: the original text is the fixed baseline.
    function renderMergeControl(type, action) {
        if (type === 'accept') {
            const placeholder = document.createElement('span');
            placeholder.hidden = true;
            return placeholder;
        }
        const button = document.createElement('button');
        button.className = 'cm-zen-revert-chunk';
        button.textContent = 'Revert';
        button.title = 'Revert this change to the original code';
        button.onmousedown = action;
        return button;
    }
    function unifiedDiffExtension() {
        return unifiedMergeView({
            original: originalDoc,
            gutter: true,
            highlightChanges: true,
            syntaxHighlightDeletions: true,
            mergeControls: renderMergeControl,
            collapseUnchanged: {margin: 3, minSize: 6},
            diffConfig: {scanLimit: 500, timeout: 200},
        });
    }
    function effectiveQuery() {
        if (activeSource === 'panel' && panelQuery) return panelQuery;
        return filterQuery || panelQuery;
    }
    // Marks every match of the current query in the visible part of the editor.
    function highlightExtension() {
        const query = effectiveQuery();
        if (!isHighlighting || !query) return [];
        const mark = Decoration.mark({class: 'cm-zen-match'});
        function build(v) {
            const builder = new RangeSetBuilder();
            for (const {from, to} of v.visibleRanges) {
                const cursor = query.getCursor(v.state, from, to);
                for (let next = cursor.next(); !next.done; next = cursor.next()) {
                    if (next.value.from < next.value.to) builder.add(next.value.from, next.value.to, mark);
                }
            }
            return builder.finish();
        }
        return ViewPlugin.fromClass(class {
            constructor(v) { this.decorations = build(v); }
            update(update) {
                if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
            }
        }, {decorations: (v) => v.decorations});
    }
    function refreshHighlight() {
        view.dispatch({effects: highlightCompartment.reconfigure(highlightExtension())});
        if (mergeView) {
            mergeView.b.dispatch({effects: splitHighlightCompartment.reconfigure(highlightExtension())});
        }
    }
    // Follows the query typed in CodeMirror's search panel.
    const panelQueryListener = EditorView.updateListener.of((update) => {
        const query = getSearchQuery(update.state);
        const previous = getSearchQuery(update.startState);
        if (query.eq(previous)) return;
        panelQuery = query.search && query.valid ? query : null;
        activeSource = 'panel';
        currentMatchIndex = -1;
        // Updates cannot dispatch new transactions synchronously.
        setTimeout(() => {
            if (isHighlighting) refreshHighlight();
            if (options.onSearchChange) options.onSearchChange();
        }, 0);
    });
    function activeView() {
        return mergeView ? mergeView.b : view;
    }

    const extensions = [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        EditorState.tabSize.of(4),
        indentUnit.of('    '),
        indentOnInput(),
        syntaxHighlighting(zenHighlightStyle, {fallback: true}),
        bracketMatching(),
        closeBrackets(),
        autocompletion(),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        highlightSelectionMatches(),
        search({top: true}),
        keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
        ]),
        language.support,
        zenTheme,
        readOnlyCompartment.of(readOnlyExtension(options.readOnly)),
        wrapCompartment.of(options.wrap ? EditorView.lineWrapping : []),
        highlightCompartment.of([]),
        notesCompartment.of([]),
        diffCompartment.of([]),
        panelQueryListener,
        EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const modified = update.state.doc.length !== originalText.length ||
                update.state.doc.toString() !== originalText;
            if (modified !== lastModified) {
                lastModified = modified;
                if (options.onModifiedChange) options.onModifiedChange(modified);
            } else if (modified && options.onModifiedChange) {
                options.onModifiedChange(true);
            }
        }),
    ];
    if (language.isJson && !isLarge) {
        extensions.push(linter(jsonParseLinter()), lintGutter());
    }

    const startText = typeof options.initialDoc === 'string' ? options.initialDoc : originalText;
    const view = new EditorView({
        state: EditorState.create({doc: startText, extensions}),
        parent: options.parent,
    });
    if (startText !== originalText) {
        lastModified = true;
    }

    function allMatches(limit) {
        const query = effectiveQuery();
        const result = [];
        if (!query || !query.valid) return result;
        const cursor = query.getCursor(activeView().state);
        for (let next = cursor.next(); !next.done; next = cursor.next()) {
            if (next.value.from === next.value.to) continue; // Skip empty matches.
            result.push(next.value);
            if (result.length >= limit) break;
        }
        return result;
    }
    function selectMatch(match) {
        activeView().dispatch({
            selection: EditorSelection.single(match.from, match.to),
            effects: EditorView.scrollIntoView(match.from, {y: 'center'}),
        });
    }
    let currentMatchIndex = -1;

    function openSplit() {
        splitDom = document.createElement('div');
        splitDom.className = 'cm-zen-split';
        options.parent.appendChild(splitDom);
        // CodeMirror styles .cm-editor with `display: flex !important`.
        view.dom.style.setProperty('display', 'none', 'important');
        const shared = [
            lineNumbers(),
            highlightSpecialChars(),
            drawSelection(),
            EditorState.tabSize.of(4),
            syntaxHighlighting(zenHighlightStyle, {fallback: true}),
            language.support,
            zenTheme,
            currentWrap ? EditorView.lineWrapping : [],
        ];
        mergeView = new MergeView({
            a: {
                doc: originalDoc,
                extensions: [...shared, EditorState.readOnly.of(true), EditorView.editable.of(false)],
            },
            b: {
                doc: view.state.doc,
                extensions: [
                    ...shared,
                    history(),
                    search({top: true}),
                    highlightSelectionMatches(),
                    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
                    readOnlyExtension(currentReadOnly),
                    splitHighlightCompartment.of(highlightExtension()),
                    panelQueryListener,
                    // Keep the main editor in sync with the right-hand side.
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged) view.dispatch({changes: update.changes});
                    }),
                ],
            },
            parent: splitDom,
            revertControls: 'a-to-b',
            gutter: true,
            highlightChanges: true,
            collapseUnchanged: {margin: 3, minSize: 6},
            diffConfig: {scanLimit: 500, timeout: 200},
        });
    }
    function closeSplit() {
        if (!mergeView) return;
        mergeView.destroy();
        mergeView = null;
        splitDom.remove();
        splitDom = null;
        view.dom.style.removeProperty('display');
        view.requestMeasure();
    }

    return {
        view,
        languageName: language.name,
        // Shows a marker next to lines with notes: [{line, title}] (1-based
        // lines). onClick(line) is called when a marker is clicked.
        setNotes(notes, onClick) {
            view.dispatch({effects: notesCompartment.reconfigure(notesGutter(notes || [], onClick))});
        },
        // The 1-based line of the cursor, and its text.
        getCursorLine() {
            const line = view.state.doc.lineAt(view.state.selection.main.head);
            return {line: line.number, text: line.text};
        },
        getLineText(number) {
            if (number < 1 || number > view.state.doc.lines) return '';
            return view.state.doc.line(number).text;
        },
        getText() {
            return view.state.doc.toString();
        },
        getOriginalText() {
            return originalText;
        },
        // Replaces the whole text (e.g. with the result of applying a patch).
        setText(text) {
            const target = mergeView ? mergeView.b : view;
            target.dispatch({changes: {from: 0, to: target.state.doc.length, insert: text}});
        },
        isModified() {
            return lastModified;
        },
        revert() {
            // In the split view, edit the right-hand side so that both sides stay in sync.
            const target = mergeView ? mergeView.b : view;
            target.dispatch({changes: {from: 0, to: target.state.doc.length, insert: originalDoc}});
        },
        // Line counts of the changes compared to the original: {added, removed}.
        diffStats() {
            if (!lastModified) return {added: 0, removed: 0};
            return diffStats(originalDoc, view.state.doc);
        },
        getDiffMode() {
            return diffMode;
        },
        setDiffMode(mode) {
            if (mode === diffMode) return;
            closeSplit();
            diffMode = mode;
            view.dispatch({effects: diffCompartment.reconfigure(mode === 'unified' ? unifiedDiffExtension() : [])});
            if (mode === 'split') openSplit();
        },
        // Moves to the next (dir=1) or previous (dir=-1) changed block in the diff.
        goToChange(dir) {
            const target = mergeView ? mergeView.b : view;
            const command = dir < 0 ? goToPreviousChunk : goToNextChunk;
            command({state: target.state, dispatch: (tr) => target.dispatch(tr)});
            target.dispatch({effects: EditorView.scrollIntoView(target.state.selection.main.head, {y: 'center'})});
        },
        setReadOnly(readOnly) {
            if (readOnly === currentReadOnly) return;
            currentReadOnly = readOnly;
            view.dispatch({effects: readOnlyCompartment.reconfigure(readOnlyExtension(readOnly))});
            if (mergeView) { closeSplit(); openSplit(); }
        },
        setWrap(wrap) {
            if (wrap === currentWrap) return;
            currentWrap = wrap;
            view.dispatch({effects: wrapCompartment.reconfigure(wrap ? EditorView.lineWrapping : [])});
            if (mergeView) { closeSplit(); openSplit(); }
        },
        // Opens CodeMirror's "go to line" panel.
        gotoLine() {
            const target = activeView();
            target.focus();
            gotoLine(target);
        },
        // Opens CodeMirror's search panel (also bound to Ctrl/Cmd+F inside the editor).
        openSearch() {
            const target = activeView();
            target.focus();
            openSearchPanel(target);
        },
        // Jumps to a 1-based line number.
        scrollToLine(line) {
            const lineInfo = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)));
            view.dispatch({
                selection: EditorSelection.cursor(lineInfo.from),
                effects: EditorView.scrollIntoView(lineInfo.from, {y: 'center'}),
            });
        },
        // Sets the search term of the viewer's filter box (a RegExp or null).
        setSearch(regexp) {
            const query = regExpToSearchQuery(regexp);
            const changed = query ? !filterQuery || !query.eq(filterQuery) : !!filterQuery;
            if (!changed) return;
            filterQuery = query;
            if (query) activeSource = 'filter';
            currentMatchIndex = -1;
            if (isHighlighting) refreshHighlight();
        },
        get isHighlighting() {
            return isHighlighting;
        },
        setHighlightAll(enabled) {
            isHighlighting = enabled;
            refreshHighlight();
        },
        findNext() {
            const matches = allMatches(MAX_COUNTED_MATCHES);
            if (!matches.length) return;
            const selection = activeView().state.selection.main;
            const from = selection.to;
            let index = matches.findIndex((m) => m.from >= from && !(m.from === selection.from && m.to === from));
            if (index === -1) index = 0; // Wrap around.
            currentMatchIndex = index;
            selectMatch(matches[index]);
        },
        findPrev() {
            const matches = allMatches(MAX_COUNTED_MATCHES);
            if (!matches.length) return;
            const from = activeView().state.selection.main.from;
            let index = -1;
            for (let i = matches.length - 1; i >= 0; --i) {
                if (matches[i].from < from) { index = i; break; }
            }
            if (index === -1) index = matches.length - 1; // Wrap around.
            currentMatchIndex = index;
            selectMatch(matches[index]);
        },
        // Same shape as the status of the previous search engine.
        getQueryStatus() {
            const query = effectiveQuery();
            if (!query) return {hasQuery: false};
            const matches = allMatches(MAX_COUNTED_MATCHES);
            return {
                hasQuery: true,
                // Where the term comes from: 'panel' (Ctrl/Cmd+F) or 'filter' (!term).
                source: query === panelQuery ? 'panel' : 'filter',
                term: query.search,
                resultTotal: matches.length,
                isTotalDefinite: matches.length < MAX_COUNTED_MATCHES,
                resultIndex: currentMatchIndex < matches.length ? currentMatchIndex : -1,
            };
        },
        // Call after the editor's DOM was re-attached to the document.
        refresh() {
            view.requestMeasure();
            if (mergeView) {
                mergeView.a.requestMeasure();
                mergeView.b.requestMeasure();
            }
        },
        destroy() {
            closeSplit();
            view.destroy();
        },
    };
}

class NoteMarker extends GutterMarker {
    constructor(title) {
        super();
        this.title = title;
    }
    eq(other) {
        return other.title === this.title;
    }
    toDOM() {
        const marker = document.createElement('span');
        marker.className = 'cm-zen-note-marker';
        marker.textContent = '\u25cf';
        marker.title = this.title;
        return marker;
    }
}

function notesGutter(notes, onClick) {
    if (!notes.length) return [];
    const byLine = new Map();
    notes.forEach((note) => {
        const titles = byLine.get(note.line) || [];
        titles.push(note.title);
        byLine.set(note.line, titles);
    });
    const lines = Array.from(byLine.keys()).sort((a, b) => a - b);
    return gutter({
        class: 'cm-zen-notes-gutter',
        markers(view) {
            const builder = new RangeSetBuilder();
            lines.forEach((number) => {
                if (number < 1 || number > view.state.doc.lines) return;
                const line = view.state.doc.line(number);
                builder.add(line.from, line.from, new NoteMarker(byLine.get(number).join('\n\n')));
            });
            return builder.finish();
        },
        initialSpacer: () => new NoteMarker(''),
        domEventHandlers: {
            mousedown(view, block) {
                const number = view.state.doc.lineAt(block.from).number;
                if (!byLine.has(number) || !onClick) return false;
                onClick(number);
                return true;
            },
        },
    });
}

function textToDoc(text) {
    return Text.of(text.split(/\r\n|\r|\n/));
}

/**
 * Creates a read-only view of the differences between two texts, used to
 * compare two versions of an add-on.
 *
 * @param {object} options
 * @param {HTMLElement} options.parent
 * @param {string} options.original Text of the old version ('' if the file was added).
 * @param {string} options.modified Text of the new version ('' if the file was removed).
 * @param {string} options.filename Used to pick the syntax highlighting.
 * @param {string} options.mode 'split' (side by side) or 'unified' (inline).
 * @param {boolean} options.wrap Whether long lines wrap.
 */
function createDiffView(options) {
    const language = languageForFilename(options.filename);
    const originalDoc = textToDoc(options.original);
    const modifiedDoc = textToDoc(options.modified);
    let mode = options.mode === 'unified' ? 'unified' : 'split';
    let wrap = !!options.wrap;
    let mergeView = null;
    let unifiedView = null;
    const host = document.createElement('div');
    host.className = 'cm-zen-diff';
    options.parent.appendChild(host);

    function shared() {
        return [
            lineNumbers(),
            highlightSpecialChars(),
            drawSelection(),
            EditorState.readOnly.of(true),
            EditorView.editable.of(false),
            EditorState.tabSize.of(4),
            syntaxHighlighting(zenHighlightStyle, {fallback: true}),
            highlightSelectionMatches(),
            search({top: true}),
            keymap.of([...defaultKeymap, ...searchKeymap]),
            language.support,
            zenTheme,
            wrap ? EditorView.lineWrapping : [],
        ];
    }
    function render() {
        if (mergeView) mergeView.destroy();
        if (unifiedView) unifiedView.destroy();
        mergeView = unifiedView = null;
        host.textContent = '';
        const diffConfig = {scanLimit: 500, timeout: 500};
        const collapseUnchanged = {margin: 3, minSize: 6};
        if (mode === 'split') {
            mergeView = new MergeView({
                a: {doc: originalDoc, extensions: shared()},
                b: {doc: modifiedDoc, extensions: shared()},
                parent: host,
                gutter: true,
                highlightChanges: true,
                collapseUnchanged,
                diffConfig,
            });
        } else {
            unifiedView = new EditorView({
                state: EditorState.create({
                    doc: modifiedDoc,
                    extensions: [
                        shared(),
                        unifiedMergeView({
                            original: originalDoc,
                            gutter: true,
                            highlightChanges: true,
                            syntaxHighlightDeletions: true,
                            mergeControls: false,
                            collapseUnchanged,
                            diffConfig,
                        }),
                    ],
                }),
                parent: host,
            });
        }
    }
    render();

    return {
        get mode() {
            return mode;
        },
        setMode(newMode) {
            if (newMode === mode) return;
            mode = newMode;
            render();
        },
        setWrap(newWrap) {
            if (newWrap === wrap) return;
            wrap = newWrap;
            render();
        },
        // Moves to the next (dir=1) or previous (dir=-1) changed block.
        goToChange(dir) {
            const target = mergeView ? mergeView.b : unifiedView;
            const command = dir < 0 ? goToPreviousChunk : goToNextChunk;
            command({state: target.state, dispatch: (tr) => target.dispatch(tr)});
            target.dispatch({effects: EditorView.scrollIntoView(target.state.selection.main.head, {y: 'center'})});
        },
        destroy() {
            if (mergeView) mergeView.destroy();
            if (unifiedView) unifiedView.destroy();
            host.remove();
        },
    };
}

window.ZenEditor = {
    create,
    createDiffView,
    // Line counts of the differences between two texts: {added, removed}.
    diffStats: (original, modified) => diffStats(textToDoc(original), textToDoc(modified)),
    languageForFilename: (f) => languageForFilename(f).name,
};
