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
 * Added by Subham Mahesh, 2026: finds the i18n message keys that the code of
 * an add-on uses, for the "In code" view of the locale diff (locale-diff.js):
 *
 *  - getMessage('key') of browser.i18n / chrome.i18n / messenger.i18n, and
 *    functions that pass their argument on to getMessage (e.g.
 *    function t(key) { return browser.i18n.getMessage(key); }, or
 *    const _ = chrome.i18n.getMessage.bind(chrome.i18n));
 *  - __MSG_key__ in any file (manifest.json, HTML, CSS, JS);
 *  - data-i18n, data-i18n-title, data-l10n-id, i18n-content and similar
 *    attributes in HTML and in HTML written by JS.
 *
 * Keys built at run time become patterns with * for the unknown part:
 * 'section_' + id + '_line1' and `${base}_line1` become section_*_line1 and
 * *_line1; a variable set to a string in the same file is followed, and both
 * sides of a ? : are kept. A key that cannot be worked out at all (e.g.
 * getMessage(key) with key from elsewhere) is reported as unknown.
 *
 * Keys often reach getMessage through data: {labelKey: 'tools_bigger_cursor'}
 * in a table that is translated later, or 'logger_action_' + type built in
 * one place and translated in another. So any string literal in JS or HTML
 * that is exactly a message name, and any key built by joining strings
 * anywhere, also counts as a use ("mention"). Mentions only mark messages as
 * used; they are never reported as missing or invalid.
 */

/* jshint browser:true, esversion:6 */
/* exported ZenI18nUsage */
'use strict';

var ZenI18nUsage = (function() {
    // Files that may use message keys.
    var CODE_FILE = /\.(?:m?js|cjs|jsx|tsx?|html?|xhtml|css|svelte|vue|json)$/i;
    var MAX_FILE_SIZE = 4 * 1024 * 1024;
    // The characters a message name may have.
    var VALID_KEY = /^[A-Za-z0-9_@]+$/;
    // Characters accepted in a key found in code, so that invalid names are
    // reported instead of ignored.
    var KEY_TOKEN = /^[A-Za-z0-9_@.\-]+$/;
    var IDENT = /^[A-Za-z_$][\w$]*$/;
    var RESERVED = ['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'typeof', 'new', 'with'];
    // Attributes that name a message, in HTML or in HTML strings in JS.
    var ATTRIBUTE = /\b(?:data-i18n(?:-[\w-]+)?|data-l10n-id|data-msg(?:-[\w-]+)?|data-message(?:-[\w-]+)?|data-locale-key|i18n-content|i18n-values|i18n|data-intl)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    var MSG = /__MSG_([A-Za-z0-9_@]+)__/g;

    function isCodeFile(filename) {
        return CODE_FILE.test(filename) && !/(?:^|\/)_locales\//i.test(filename) &&
            !/(?:^|\/)_metadata\//i.test(filename);
    }

    function lineAt(lineStarts, index) {
        var lo = 0;
        var hi = lineStarts.length - 1;
        while (lo < hi) {
            var mid = (lo + hi + 1) >> 1;
            if (lineStarts[mid] <= index) lo = mid; else hi = mid - 1;
        }
        return lo + 1;
    }

    // Reads the string literal at text[i] ('..', ".." or `..`). Returns
    // {end, parts}: parts are strings and null for each ${...}.
    function readString(text, i) {
        var quote = text[i];
        var parts = [''];
        var expressions = [];
        var j = i + 1;
        while (j < text.length) {
            var c = text[j];
            if (c === '\\') {
                var next = text[j + 1];
                var hex = next === 'u' ? /^u([0-9A-Fa-f]{4})/.exec(text.slice(j + 1, j + 6)) :
                    next === 'x' ? /^x([0-9A-Fa-f]{2})/.exec(text.slice(j + 1, j + 4)) : null;
                if (hex) {
                    parts[parts.length - 1] += String.fromCharCode(parseInt(hex[1], 16));
                    j += 1 + hex[0].length;
                    continue;
                }
                parts[parts.length - 1] += next === 'n' ? '\n' : next === 't' ? '\t' : next;
                j += 2;
                continue;
            }
            if (c === quote) return {end: j + 1, parts: parts, expressions: expressions};
            if (quote !== '`' && c === '\n') return null;
            if (quote === '`' && c === '$' && text[j + 1] === '{') {
                var start = j + 2;
                j = skipBalanced(text, j + 1);
                if (j === -1) return null;
                // The code inside ${...}, as [start, end) in |text|.
                expressions.push([start, j - 1]);
                parts.push(null, '');
                continue;
            }
            parts[parts.length - 1] += c;
            j++;
        }
        return null;
    }

    // From an opening bracket at text[i], returns the index after its match.
    function skipBalanced(text, i) {
        var close = {'(': ')', '[': ']', '{': '}'};
        var stack = [close[text[i]]];
        var j = i + 1;
        while (j < text.length && stack.length) {
            var c = text[j];
            if (c === '"' || c === "'" || c === '`') {
                var s = readString(text, j);
                if (!s) return -1;
                j = s.end;
                continue;
            }
            if (c === '/' && text[j + 1] === '/') {
                j = text.indexOf('\n', j);
                if (j === -1) return -1;
                continue;
            }
            if (c === '/' && text[j + 1] === '*') {
                j = text.indexOf('*/', j + 2);
                if (j === -1) return -1;
                j += 2;
                continue;
            }
            if (close[c]) {
                stack.push(close[c]);
            } else if (c === stack[stack.length - 1]) {
                stack.pop();
            } else if (c === ')' || c === ']' || c === '}') {
                return -1;
            }
            j++;
        }
        return stack.length ? -1 : j;
    }

    // The first argument of a call whose "(" is at text[open]: the source
    // text up to the first top-level comma or the closing parenthesis.
    function firstArgument(text, open) {
        var j = open + 1;
        var start = j;
        while (j < text.length) {
            var c = text[j];
            if (c === '"' || c === "'" || c === '`') {
                var s = readString(text, j);
                if (!s) return null;
                j = s.end;
                continue;
            }
            if (c === '(' || c === '[' || c === '{') {
                j = skipBalanced(text, j);
                if (j === -1) return null;
                continue;
            }
            if (c === ',' || c === ')') return text.slice(start, j);
            j++;
        }
        return null;
    }

    // Splits |expr| at the top-level occurrences of the single character |sep|.
    function splitTop(expr, sep) {
        var parts = [];
        var start = 0;
        var j = 0;
        while (j < expr.length) {
            var c = expr[j];
            if (c === '"' || c === "'" || c === '`') {
                var s = readString(expr, j);
                if (!s) return [expr];
                j = s.end;
                continue;
            }
            if (c === '(' || c === '[' || c === '{') {
                j = skipBalanced(expr, j);
                if (j === -1) return [expr];
                continue;
            }
            if (c === sep) {
                parts.push(expr.slice(start, j));
                start = j + 1;
            }
            j++;
        }
        parts.push(expr.slice(start));
        return parts;
    }

    function stripParens(expr) {
        expr = expr.trim();
        while (expr[0] === '(' && skipBalanced(expr, 0) === expr.length) {
            expr = expr.slice(1, -1).trim();
        }
        return expr;
    }

    // Turns an expression into the keys it may produce: an array of patterns
    // (strings with * for unknown parts). |resolve(name, depth)| returns the
    // patterns of a variable, or null.
    function patternsOf(expr, resolve, depth) {
        expr = stripParens(expr);
        if (!expr || depth > 4) return ['*'];
        // a ? b : c
        var question = splitTop(expr, '?');
        if (question.length === 2) {
            var branches = splitTop(question[1], ':');
            if (branches.length === 2) {
                return patternsOf(branches[0], resolve, depth + 1).concat(patternsOf(branches[1], resolve, depth + 1));
            }
        }
        // a || 'default'
        var or = expr.split('||');
        if (or.length > 1 && splitTop(expr, '|').length === or.length * 2 - 1) {
            var options = [];
            or.forEach(function(part) { options = options.concat(patternsOf(part, resolve, depth + 1)); });
            return options;
        }
        var terms = splitTop(expr, '+');
        var results = [''];
        terms.forEach(function(term) {
            term = stripParens(term);
            var values;
            if (/^['"`]/.test(term)) {
                var s = readString(term, 0);
                if (s && s.end === term.length) {
                    values = [s.parts.map(function(part) { return part === null ? '*' : part; }).join('')];
                }
            } else if (IDENT.test(term) && resolve) {
                // A variable set to a number is usually a counter.
                values = (resolve(term, depth + 1) || []).filter(function(value) { return !/^\d+$/.test(value); });
            } else if (/^\d+$/.test(term)) {
                values = [term];
            }
            if (!values || !values.length) values = ['*'];
            var next = [];
            results.forEach(function(prefix) {
                values.forEach(function(value) { next.push(prefix + value); });
            });
            results = next.slice(0, 32);
        });
        return results.map(function(pattern) { return pattern.replace(/\*+/g, '*'); });
    }

    // The string values assigned to each variable of a JS text, for following
    // getMessage(name) back to name = 'prefix_' + n.
    function assignments(text) {
        var map = Object.create(null);
        var re = /(?:\b(?:const|let|var)\s+|[,;{(]\s*|^\s*)([A-Za-z_$][\w$]*)\s*=(?![=>])\s*/gm;
        var m;
        while ((m = re.exec(text))) {
            var start = re.lastIndex;
            var j = start;
            // The expression ends at a top-level ; , ) or end of line.
            while (j < text.length) {
                var c = text[j];
                if (c === '"' || c === "'" || c === '`') {
                    var s = readString(text, j);
                    if (!s) break;
                    j = s.end;
                    continue;
                }
                if (c === '(' || c === '[' || c === '{') {
                    var after = skipBalanced(text, j);
                    if (after === -1) break;
                    j = after;
                    continue;
                }
                if (c === ';' || c === ',' || c === ')' || c === ']' || c === '}' || c === '\n') break;
                j++;
            }
            var expr = text.slice(start, j).trim();
            if (!expr || expr.length > 400 || /^(?:function\b|class\b|async\b|\(.*\)\s*=>)/.test(expr)) continue;
            if (!/['"`]/.test(expr) && !/^[\w$.\s+?:|]+$/.test(expr)) continue;
            (map[m[1]] = map[m[1]] || []).push(expr);
        }
        return map;
    }

    // Names of functions that pass their first parameter on to getMessage.
    function wrapperNames(text, params) {
        var names = Object.create(null);
        var definitions = [
            // function t(key, ...) {
            /\bfunction\s+([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)/g,
            // t = function (key) {   t: async function(key) {
            /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?function\b[^(]*\(\s*([A-Za-z_$][\w$]*)/g,
            // t = (key) =>   t: key =>
            /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s+)?\(?\s*([A-Za-z_$][\w$]*)[^()=]*\)?\s*=>/g,
            // class or object method: t(key) {
            /(?:^|[;{},])\s*(?:static\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(\s*([A-Za-z_$][\w$]*)[^()]*\)\s*\{/gm,
        ];
        definitions.forEach(function(re) {
            var m;
            while ((m = re.exec(text))) {
                if (RESERVED.indexOf(m[1]) !== -1 || m[1] === 'getMessage') continue;
                var after = re.lastIndex;
                var body = text.slice(after, after + 400);
                var call = new RegExp('getMessage\\s*\\(\\s*' + m[2].replace(/\$/g, '\\$') + '\\b');
                var callAt = body.search(call);
                if (callAt === -1) continue;
                // The call must be inside the function when it has a body.
                var brace = text.indexOf('{', after);
                var arrow = text.slice(after, after + 4).trim();
                if (brace !== -1 && brace < after + callAt && !(re === definitions[2] && arrow[0] !== '{')) {
                    var end = skipBalanced(text, brace);
                    if (end !== -1 && end < after + callAt) continue;
                }
                names[m[1]] = true;
                if (params) params[m[2]] = true;
            }
        });
        var m;
        // const _ = browser.i18n.getMessage; or .bind(...)
        var alias = /([A-Za-z_$][\w$]*)\s*[:=]\s*(?:[\w$]+\.)*i18n\.getMessage\b(?!\s*\()/g;
        while ((m = alias.exec(text))) names[m[1]] = true;
        // const {getMessage: t} = browser.i18n;
        var destructure = /\{[^{}]*\bgetMessage\s*:\s*([A-Za-z_$][\w$]*)[^{}]*\}\s*=\s*(?:[\w$]+\.)*i18n\b/g;
        while ((m = destructure.exec(text))) names[m[1]] = true;
        delete names.getMessage;
        return Object.keys(names);
    }

    function inComment(text, index) {
        var lineStart = text.lastIndexOf('\n', index - 1) + 1;
        var before = text.slice(lineStart, index);
        if (/^\s*(?:\/\/|\*|<!--)/.test(before) || /\/\/[^'"`]*$/.test(before)) return true;
        var open = text.lastIndexOf('/*', index);
        return open !== -1 && text.lastIndexOf('*/', index) < open;
    }

    var KEYISH = /^[A-Za-z][A-Za-z0-9_@]*$/;
    var KEY_PART = /^[A-Za-z0-9_@]*$/;

    // String literals that may be message names, and keys built by joining
    // strings ('prefix_' + x, x + '_suffix', `a_${x}_b`), as patterns. Calls
    // add(pattern, index) for each; comments are skipped.
    function collectMentions(text, isHtml, add) {
        function scanExpression(start, end) {
            collectMentions(text.slice(start, end), false, function(pattern, index) {
                add(pattern, start + index);
            });
        }
        var i = 0;
        var n = text.length;
        while (i < n) {
            var c = text[i];
            if (c === '/' && text[i + 1] === '/' && !isHtml) {
                var eol = text.indexOf('\n', i);
                i = eol === -1 ? n : eol + 1;
                continue;
            }
            if (c === '/' && text[i + 1] === '*' && !isHtml) {
                var close = text.indexOf('*/', i + 2);
                i = close === -1 ? n : close + 2;
                continue;
            }
            if (c === '<' && text.startsWith('<!--', i)) {
                var end = text.indexOf('-->', i + 4);
                i = end === -1 ? n : end + 3;
                continue;
            }
            if (c !== '"' && c !== "'" && c !== '`') {
                i++;
                continue;
            }
            var s = readString(text, i);
            if (!s) {
                i++;
                continue;
            }
            // Code inside ${...} of a template literal, e.g. HTML built with
            // ${label('key')}, is scanned too.
            for (var e = 0; e < s.expressions.length; e++) {
                scanExpression(s.expressions[e][0], s.expressions[e][1]);
            }
            var parts = s.parts;
            if (parts.length === 1) {
                var literal = parts[0];
                if (KEYISH.test(literal) && literal.length > 1) add(literal, i);
                // Joined with +: a built key such as 'logger_action_' + type.
                var joinedBefore = /\+\s*$/.test(text.slice(Math.max(0, i - 8), i)) &&
                    !/\+\+\s*$/.test(text.slice(Math.max(0, i - 8), i));
                var joinedAfter = /^\s*\+(?!\+)/.test(text.slice(s.end, s.end + 8));
                if ((joinedBefore || joinedAfter) && literal.length >= 3 && literal.indexOf('_') !== -1 &&
                        KEY_PART.test(literal)) {
                    add((joinedBefore ? '*' : '') + literal + (joinedAfter ? '*' : ''), i);
                }
            } else {
                // A template literal such as `audit_${name}_title`.
                var pattern = '';
                var fixed = '';
                var keyLike = true;
                for (var k = 0; k < parts.length; k++) {
                    if (parts[k] === null) {
                        pattern += '*';
                    } else if (KEY_PART.test(parts[k])) {
                        pattern += parts[k];
                        fixed += parts[k];
                    } else {
                        keyLike = false;
                    }
                }
                if (keyLike && fixed.length >= 3 && fixed.indexOf('_') !== -1) add(pattern.replace(/\*+/g, '*'), i);
            }
            i = s.end;
        }
    }

    // Finds the keys used in one file. Returns a list of
    // {pattern, how, file, line, text}: pattern is a key, a pattern with *,
    // or '*' when nothing is known; how is 'getMessage', a wrapper name,
    // '__MSG__' or the attribute name.
    function scanText(filename, text, globalWrappers) {
        var found = [];
        if (!text || text.length > MAX_FILE_SIZE) return found;
        var lineStarts = [0];
        for (var i = 0; i < text.length; i++) {
            if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
        }
        function add(pattern, how, index) {
            var line = lineAt(lineStarts, index);
            var lineText = text.slice(lineStarts[line - 1], line < lineStarts.length ? lineStarts[line] - 1 : text.length);
            found.push({pattern: pattern, how: how, file: filename, line: line,
                text: lineText.trim().slice(0, 200)});
        }
        var m;
        MSG.lastIndex = 0;
        while ((m = MSG.exec(text))) {
            if (m[1].indexOf('@@') !== 0) add(m[1], '__MSG__', m.index);
        }
        ATTRIBUTE.lastIndex = 0;
        while ((m = ATTRIBUTE.exec(text))) {
            var value = m[1] !== undefined ? m[1] : m[2];
            var how = m[0].slice(0, m[0].indexOf('=')).trim();
            // Values such as "[title]key;other" or "title:key" (i18next styles).
            var parts = value.split(/[;,\s]+/);
            for (var p = 0; p < parts.length; p++) {
                var part = parts[p].replace(/^\[[^\]]*\]/, '');
                if (part.indexOf(':') !== -1 && how === 'i18n-values') part = part.slice(part.indexOf(':') + 1);
                part = part.replace(/^__MSG_|__$/g, '');
                if (/\$\{|\{\{/.test(part)) {
                    add(part.replace(/\$\{[^}]*\}|\{\{[^}]*\}\}/g, '*').replace(/\*+/g, '*'), how, m.index);
                } else if (part && KEY_TOKEN.test(part)) {
                    add(part, how, m.index);
                }
            }
        }
        if (!/\.(?:m?js|cjs|jsx|tsx?|html?|xhtml|svelte|vue)$/i.test(filename)) return found;

        collectMentions(text, /\.(?:html?|xhtml)$/i.test(filename), function(pattern, index) {
            add(pattern, 'mention', index);
        });

        var vars = null;
        function resolve(name, depth) {
            if (!vars) vars = assignments(text);
            var exprs = vars[name];
            if (!exprs) return null;
            var out = [];
            exprs.slice(0, 8).forEach(function(expr) {
                out = out.concat(patternsOf(expr, function(n, d) { return n === name ? null : resolve(n, d); }, depth));
            });
            return out;
        }
        var params = Object.create(null);
        var names = ['getMessage'].concat(wrapperNames(text, params), globalWrappers || []);
        var unique = names.filter(function(name, index) { return names.indexOf(name) === index; });
        var call = new RegExp('(^|[^\\w$])(' + unique.map(function(name) {
            return name.replace(/\$/g, '\\$');
        }).join('|') + ')\\s*\\(', 'g');
        while ((m = call.exec(text))) {
            var name = m[2];
            var at = m.index + m[1].length;
            var open = call.lastIndex - 1;
            // Skip the definitions: function t(key) {...} and method shorthand.
            var before = text.slice(Math.max(0, at - 12), at);
            if (/\bfunction\s*$/.test(before)) continue;
            if (inComment(text, at)) continue;
            var arg = firstArgument(text, open);
            if (arg === null) continue;
            if (!arg.trim()) continue;
            // getMessage(key) inside a wrapper: the keys are found at its calls.
            if (name === 'getMessage' && params[arg.trim()]) continue;
            var close = skipBalanced(text, open);
            if (close !== -1 && /^\s*\{/.test(text.slice(close, close + 20)) && name !== 'getMessage') continue;
            var patterns = patternsOf(arg, resolve, 0);
            for (var k = 0; k < patterns.length; k++) {
                // Patterns keep only the characters message names can have.
                if (patterns[k] === '*' || (patterns[k].indexOf('*') !== -1 ?
                        /^[A-Za-z0-9_@.*\-]*[A-Za-z0-9_@][A-Za-z0-9_@.*\-]*$/.test(patterns[k]) :
                        KEY_TOKEN.test(patterns[k]))) {
                    add(patterns[k], name, at);
                }
            }
        }
        return found;
    }

    // A RegExp for a pattern with *, matching message names (any case).
    function patternRegExp(pattern) {
        return new RegExp('^' + pattern.split('*').map(function(part) {
            return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        }).join('[A-Za-z0-9_@]*') + '$', 'i');
    }

    // Groups the uses by key or pattern and compares them with the message
    // names of |messages| (normalized key -> {key}) and of every locale.
    // Returns {used, missing, invalid, patterns, unknown, unused}.
    function analyze(uses, reference, locales) {
        var byPattern = new Map();
        var referenceKeys = Object.keys(reference.messages);
        var covered = new Set();
        // Mentions only mark messages as used.
        var mentioned = new Set();
        uses.forEach(function(use) {
            if (use.how !== 'mention') return;
            var id = use.pattern.toLowerCase();
            if (mentioned.has(id)) return;
            mentioned.add(id);
            if (id.indexOf('*') === -1) {
                if (reference.messages[id]) covered.add(id);
                return;
            }
            var re = patternRegExp(use.pattern);
            referenceKeys.forEach(function(k) { if (re.test(k)) covered.add(k); });
        });
        uses = uses.filter(function(use) { return use.how !== 'mention'; });
        uses.forEach(function(use) {
            var id = use.pattern.toLowerCase();
            if (!byPattern.has(id)) byPattern.set(id, {pattern: use.pattern, uses: []});
            byPattern.get(id).uses.push(use);
        });
        var result = {missing: [], invalid: [], patterns: [], unknown: [], unused: []};
        byPattern.forEach(function(entry, id) {
            if (id === '*' || /^\*$/.test(id)) {
                result.unknown.push(entry);
                return;
            }
            if (id.indexOf('*') === -1) {
                if (!VALID_KEY.test(entry.pattern)) {
                    result.invalid.push(entry);
                    return;
                }
                if (reference.messages[id]) {
                    covered.add(id);
                    return;
                }
                entry.inLocales = Object.keys(locales).filter(function(k) { return locales[k].messages[id]; });
                result.missing.push(entry);
                return;
            }
            var re = patternRegExp(entry.pattern);
            entry.matches = referenceKeys.filter(function(k) { return re.test(k); });
            entry.matches.forEach(function(k) { covered.add(k); });
            entry.matchNames = entry.matches.map(function(k) { return reference.messages[k].key; });
            result.patterns.push(entry);
        });
        result.unused = referenceKeys.filter(function(k) { return !covered.has(k); })
            .map(function(k) { return {pattern: reference.messages[k].key, uses: []}; });
        function byName(a, b) { return a.pattern.localeCompare(b.pattern); }
        Object.keys(result).forEach(function(name) { result[name].sort(byName); });
        result.unmatched = result.patterns.filter(function(entry) { return !entry.matches.length; });
        return result;
    }

    // Wrapper names defined in one file and used in another, e.g. a t()
    // in i18n.js used by popup.js.
    function collectWrappers(texts) {
        var names = [];
        texts.forEach(function(text) {
            if (text && text.length <= MAX_FILE_SIZE) {
                wrapperNames(text).forEach(function(name) {
                    // Very short names are only trusted when defined in the
                    // add-on as wrappers; they are common otherwise.
                    if (names.indexOf(name) === -1) names.push(name);
                });
            }
        });
        return names;
    }

    return {
        isCodeFile: isCodeFile,
        scanText: scanText,
        collectWrappers: collectWrappers,
        analyze: analyze,
        patternRegExp: patternRegExp,
        // For tests.
        patternsOf: patternsOf,
    };
})();
