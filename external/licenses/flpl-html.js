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
 * Generates docs/FLPL.html, a web page of the File-Level Permissive License,
 * from the plain-text LICENSE.txt. The page contains exactly the text of
 * LICENSE.txt, word for word, with nothing added: only formatting. The page is
 * self-contained (no external fonts or images); its only script, theme.js,
 * exists only in the add-on, where it applies the add-on's light or dark
 * appearance setting. Elsewhere the page follows the system setting. The
 * add-on ships this page unchanged, byte for byte, as flpl.html (see make.js).
 *
 * Usage: node external/licenses/flpl-html.js [output-file]
 */
/* jshint node:true, esversion:8 */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT_DIR = path.join(__dirname, '..', '..');
var SOURCE = path.join(ROOT_DIR, 'LICENSE.txt');
var DEFAULT_OUTPUT = path.join(ROOT_DIR, 'docs', 'FLPL.html');

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function indentOf(line) {
    return line.length - line.replace(/^ +/, '').length;
}

function joinLines(lines) {
    return lines.map(function(line) { return line.trim(); }).join(' ');
}

// Text of a paragraph, escaped.
function prose(text) {
    return escapeHtml(text);
}

// Bold a leading run-in heading such as "Interpretation." or a defined term
// such as "\"Work\"".
function proseWithLead(text, idPrefix) {
    var def = /^"([^"]+)"(.*)$/.exec(text);
    if (def) {
        var id = idPrefix + def[1].toLowerCase().replace(/[^a-z0-9]+/g, '-');
        return '<dfn id="' + id + '">&quot;' + escapeHtml(def[1]) + '&quot;</dfn>' + prose(def[2]);
    }
    var lead = /^((?:[A-Z][A-Za-z]*)(?: (?:[A-Z][A-Za-z]*|of|and|or|the|to|on|in|Is|Not|Where))*\.)\s+(.*)$/.exec(text);
    if (lead && lead[1].split(' ').length <= 7) {
        return '<strong class="lead">' + escapeHtml(lead[1]) + '</strong> ' + prose(lead[2]);
    }
    return prose(text);
}

function parse(source) {
    var lines = source.replace(/\r\n/g, '\n').split('\n');
    // Paragraphs separated by blank lines, keeping the indent of the first line.
    var paragraphs = [];
    var current = [];
    lines.forEach(function(line) {
        if (!line.trim()) {
            if (current.length) paragraphs.push(current);
            current = [];
        } else {
            current.push(line);
        }
    });
    if (current.length) paragraphs.push(current);
    return paragraphs;
}

function render(source) {
    var paragraphs = parse(source);
    var title = paragraphs[0][0].trim();
    var version = paragraphs[0][1] ? paragraphs[0][1].trim() : '';
    var body = [];
    var inAppendix = '';
    var openSection = false;
    var openSub = false;
    var openList = false;
    var openNested = false;
    var notice = [];

    // A nested list of (A), (B), ... items sits inside the last (i) item.
    function closeNested() {
        if (openNested) { body.push('</ol></li>'); openNested = false; }
    }
    function closeList() {
        closeNested();
        if (openList) { body.push('</ol>'); openList = false; }
    }
    function flushNotice() {
        if (notice.length) {
            body.push('<pre class="notice">' + escapeHtml(notice.join('\n\n')) + '</pre>');
            notice = [];
        }
    }
    function closeSub() {
        flushNotice();
        closeList();
        if (openSub) { body.push('</section>'); openSub = false; }
    }
    function closeSection() {
        closeSub();
        if (openSection) { body.push('</section>'); openSection = false; }
    }

    paragraphs.slice(1).forEach(function(lines) {
        var indent = indentOf(lines[0]);
        var text = joinLines(lines);
        var match;

        // The appendix headings are centered and span two source lines.
        // Keep both lines as heading text instead of treating them as a notice.
        if ((match = /^APPENDIX ([AB])$/.exec(lines[0].trim()))) {
            closeSection();
            inAppendix = match[1].toLowerCase();
            body.push('<section class="clause appendix" id="appendix-' + inAppendix + '">');
            body.push('<h2>' + escapeHtml(lines[0].trim()) + '<br>' +
                escapeHtml(lines.slice(1).map(function(line) { return line.trim(); }).join(' ')) + '</h2>');
            openSection = true;
            return;
        }

        // (A), (B), ... under an (i) item: a nested list, not a notice.
        if (openList && indent >= 14 && (match = /^\(([A-Z])\)\s+(.*)$/.exec(text))) {
            if (!openNested) {
                // Reopen the last item so that the nested list sits inside it.
                body[body.length - 1] = body[body.length - 1].replace(/<\/li>$/, '');
                body.push('<ol class="items sub-items">');
                openNested = true;
            }
            body.push('<li><span class="item-num">(' + match[1] + ')</span> ' + prose(match[2]) + '</li>');
            return;
        }
        closeNested();

        // Unboxed sample notices: indented 14+, other than list items such as
        // the (i), (ii), ... under a definition. Boxed notices are handled below.
        if (indent >= 14 && !/^\((?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\)\s/.test(text)) {
            closeList();
            var minIndent = Math.min.apply(null, lines.map(indentOf));
            notice.push(lines.map(function(line) { return line.slice(minIndent); }).join('\n'));
            return;
        }
        flushNotice();

        // Boxed sample notices use ASCII borders and a smaller indent than
        // the older unboxed examples. Preserve their line breaks and spacing.
        if (/^\+[=-]+\+$/.test(lines[0].trim()) &&
                /^\+[=-]+\+$/.test(lines[lines.length - 1].trim())) {
            closeList();
            var noticeIndent = Math.min.apply(null, lines.map(indentOf));
            body.push('<pre class="notice">' + escapeHtml(lines.map(function(line) {
                return line.slice(noticeIndent);
            }).join('\n')) + '</pre>');
            return;
        }

        if (indent === 3) {
            if ((match = /^(\d+)\.\s+(.+?\.)(?:\s+(.*))?$/.exec(text))) {
                closeSection();
                var n = match[1];
                var heading = match[2];
                body.push('<section class="clause" id="s' + n + '">');
                openSection = true;
                if (match[3]) {
                    // The heading runs into the text, as in LICENSE.txt.
                    body.push('<p class="run-in"><strong class="clause-head">' + n + '. ' +
                        escapeHtml(heading) + '</strong> ' + prose(match[3]) + '</p>');
                } else {
                    body.push('<h2><span class="num">' + n + '.</span> ' + escapeHtml(heading) + '</h2>');
                }
                return;
            }
            if ((match = /^APPENDIX ([AB]):\s+(.+?)\.?$/.exec(text))) {
                closeSection();
                inAppendix = match[1].toLowerCase();
                body.push('<section class="clause appendix" id="appendix-' + inAppendix + '">');
                body.push('<h2>' + escapeHtml(text) + '</h2>');
                openSection = true;
                return;
            }
            closeSection();
            // An all-capitals line is a divider (such as TERMS AND CONDITIONS);
            // anything else at this indent is a preamble paragraph.
            body.push(text === text.toUpperCase() ?
                '<p class="divider">' + escapeHtml(text) + '</p>' :
                '<p class="preamble">' + escapeHtml(text) + '</p>');
            return;
        }

        if (indent === 6 && (match = /^\(([a-z])\)\s+(.*)$/.exec(text))) {
            closeSub();
            var letter = match[1];
            var parent = inAppendix ? 'appendix-' + inAppendix : (body.length ? currentSectionId() : '');
            var id = parent + '-' + letter;
            var rest = match[2];
            var subTitle = /^([^.]{1,70}?\.)\s+(.*)$/.exec(rest);
            body.push('<section class="sub" id="' + id + '">');
            openSub = true;
            if (subTitle && /^[A-Z]/.test(subTitle[1])) {
                body.push('<p><span class="sub-ref">(' + letter + ')</span> <strong>' +
                    escapeHtml(subTitle[1]) + '</strong> ' + prose(subTitle[2]) + '</p>');
            } else if (/^[A-Z][^.]{0,69}\.$/.test(rest)) {
                // A title alone, with the text in the items below it.
                body.push('<p><span class="sub-ref">(' + letter + ')</span> <strong>' +
                    escapeHtml(rest) + '</strong></p>');
            } else {
                body.push('<p><span class="sub-ref">(' + letter + ')</span> ' + prose(rest) + '</p>');
            }
            return;
        }

        if ((match = /^\(((?:i|ii|iii|iv|v|vi|vii|viii|ix|x))\)\s+(.*)$/.exec(text)) && indent >= 10) {
            if (!openList) { body.push('<ol class="items">'); openList = true; }
            var item = match[2];
            var itemTitle = /^([A-Z][A-Za-z ]+\.)\s+(.*)$/.exec(item);
            var itemHtml = itemTitle && itemTitle[1].split(' ').length <= 7 ?
                '<strong>' + escapeHtml(itemTitle[1]) + '</strong> ' + prose(itemTitle[2]) : prose(item);
            body.push('<li><span class="item-num">(' + match[1] + ')</span> ' + itemHtml + '</li>');
            return;
        }

        closeList();
        body.push('<p>' + (indent === 6 && !openSub || /^Explanation\.\s/.test(text) ?
            proseWithLead(text, 'def-') : prose(text)) + '</p>');
    });
    closeSection();

    function currentSectionId() {
        for (var i = body.length - 1; i >= 0; i--) {
            var m = /^<section class="clause[^"]*" id="([^"]+)">$/.exec(body[i]);
            if (m) return m[1];
        }
        return '';
    }

    return page(title, version, body.join('\n'));
}

function page(title, version, body) {
    return '<!DOCTYPE html>\n' +
'<!-- Generated from LICENSE.txt by external/licenses/flpl-html.js. Do not edit by hand. -->\n' +
'<html lang="en">\n' +
'<head>\n' +
'<meta charset="utf-8">\n' +
'<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
// In the add-on (flpl.html), applies its light or dark appearance setting.
// Elsewhere there is no theme.js, and the page follows the system setting.
'<script src="theme.js"></script>\n' +
'<title>' + escapeHtml(title) + '</title>\n' +
'<style>\n' + CSS + '</style>\n' +
'</head>\n' +
'<body>\n' +
'<main>\n' +
'<header class="doc-header">\n' +
'<h1>' + escapeHtml(title) + '</h1>\n' +
(version ? '<p class="version">' + escapeHtml(version) + '</p>\n' : '') +
'</header>\n' +
'<article class="license">\n' + body + '\n</article>\n' +
'</main>\n' +
'</body>\n' +
'</html>\n';
}

var CSS = [
':root {',
'    color-scheme: light dark;',
'    --bg: #ffffff; --surface: #f7f7f5; --text: #1b1b1b; --muted: #5c5c5c;',
'    --border: #d9d9d4; --accent: #1f4e79; --code-bg: #f3f3f0; --mark: #fff6d6;',
'}',
// Dark when the system is dark, unless the add-on's appearance setting (applied
// by theme.js as data-theme on <html>) is Light; always dark when it is Dark.
'@media (prefers-color-scheme: dark) {',
'    :root:not([data-theme="light"]) {--bg: #141414; --surface: #1b1b1b; --text: #e8e8e6; --muted: #a6a6a2;',
'        --border: #343432; --accent: #9cc1e6; --code-bg: #1f1f1e; --mark: #3a3420;}',
'}',
':root[data-theme="dark"] {color-scheme: dark; --bg: #141414; --surface: #1b1b1b; --text: #e8e8e6; --muted: #a6a6a2;',
'    --border: #343432; --accent: #9cc1e6; --code-bg: #1f1f1e; --mark: #3a3420;}',
':root[data-theme="light"] {color-scheme: light;}',
'* {box-sizing: border-box;}',
'body {margin: 0; background: var(--bg); color: var(--text);',
'    font: 17px/1.65 "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif;',
'    -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;',
'    text-align: left; hyphens: none; -webkit-hyphens: none; word-break: normal; overflow-wrap: normal;}',
'main {max-width: 780px; margin: 0 auto; padding: 56px 24px 96px;}',
'a {color: var(--accent); text-decoration-thickness: 1px; text-underline-offset: 2px;}',
'.doc-header {margin-bottom: 36px; padding-bottom: 24px; border-bottom: 2px solid var(--text); text-align: center;}',
'h1 {margin: 0 0 6px; font-size: 32px; font-weight: 700; line-height: 1.25; letter-spacing: 0;}',
'.version {margin: 0; font-size: 16px; color: var(--muted);}',
'.clause {margin: 0 0 34px; scroll-margin-top: 16px;}',
'.clause h2 {margin: 0 0 14px; font-size: 20px; font-weight: 700; line-height: 1.35;}',
'.clause-head {font-weight: 700;}',
'.clause.appendix {margin-top: 48px; padding-top: 24px; border-top: 1px solid var(--border);}',
'.sub {margin: 0 0 12px; padding-left: 2.2em; text-indent: -2.2em; scroll-margin-top: 16px;}',
'.sub > *:not(p:first-child) {text-indent: 0;}',
'.sub:target, .clause:target > h2 {background: var(--mark);}',
'.sub-ref {display: inline-block; min-width: 2.2em; text-indent: 0; color: inherit; text-decoration: none;}',
'p {margin: 0 0 12px;}',
'dfn {font-style: normal; font-weight: 700;}',
'.lead {font-weight: 700;}',
'.items {margin: 4px 0 12px; padding: 0; list-style: none; text-indent: 0;}',
'.items li {position: relative; margin: 0 0 8px; padding-left: 3em;}',
'.item-num {position: absolute; left: 0;}',
'.sub-items {margin: 8px 0 0;} .sub-items li {padding-left: 2.2em;}',
'.divider {margin: 44px 0 32px; text-align: center; font-weight: 700; letter-spacing: 0.06em;}',
'.preamble {margin: 0 0 28px;}',
'pre.notice {margin: 4px 0 14px; padding: 14px 18px; overflow-x: auto; text-indent: 0;',
'    font: 13.5px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; white-space: pre;',
'    background: var(--code-bg); border: 1px solid var(--border);}',
'code {font: 0.88em ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;}',
'@media (max-width: 600px) {main {padding: 32px 16px 64px;} body {font-size: 16px;} h1 {font-size: 26px;}',
'    .sub {padding-left: 1.8em; text-indent: -1.8em;} .sub-ref {min-width: 1.8em;}',
// Narrow screens: notices wrap at spaces instead of scrolling sideways; no word is split.
'    pre.notice {white-space: pre-wrap; padding: 12px 14px; font-size: 12.5px;}}',
'@media print {',
'    :root {--bg: #fff; --text: #000; --muted: #444; --accent: #000; --surface: #fff; --code-bg: #fff; --border: #999;}',
'    body {font-size: 11pt;} main {max-width: none; padding: 0;}',
'    a {text-decoration: none;} .clause h2 {break-after: avoid;} .sub, .items li {break-inside: avoid;}',
'}',
''].join('\n');

function generate(outputFile) {
    var html = render(fs.readFileSync(SOURCE, 'utf8'));
    fs.mkdirSync(path.dirname(outputFile), {recursive: true});
    fs.writeFileSync(outputFile, html);
    return outputFile;
}

// The page as generated now from LICENSE.txt, without writing it.
function html() {
    return render(fs.readFileSync(SOURCE, 'utf8'));
}

exports.generate = generate;
exports.html = html;

if (require.main === module) {
    console.log('Wrote ' + generate(process.argv[2] || DEFAULT_OUTPUT));
}
