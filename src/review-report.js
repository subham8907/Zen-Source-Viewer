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
 * Added by Subham Mahesh, 2026: a review report for an add-on, shown in the
 * main panel of the viewer ("Review"):
 *
 *  - Permissions: each permission with what it allows, host access, content
 *    scripts, content security policy.
 *  - Code to check: eval, new Function, HTML from variables, remote scripts,
 *    code injection, minified or obfuscated files.
 *  - Network endpoints: every web address in the code, grouped by host.
 *  - Translations in code: message keys used by the code (__MSG_x__,
 *    i18n.getMessage("x")) that no messages.json defines, and keys defined
 *    but not mentioned anywhere in the code.
 *
 * ZenReview.analyzeManifest and ZenReview.diffManifests are also used by the
 * Compare page, to show permission changes between two versions.
 * Everything runs on this device.
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals ZenMainView, ZenFiles, parseManifest */
'use strict';

var ZenReview = (function() {
    // ---- Permissions

    // What each permission allows, and how much it matters for a review.
    var PERMISSIONS = {
        '<all_urls>': ['high', 'Read and change all websites, and their network requests'],
        activeTab: ['low', 'Access the current tab when the user invokes the add-on'],
        alarms: ['low', 'Schedule code to run later'],
        bookmarks: ['medium', 'Read and change bookmarks'],
        browserSettings: ['medium', 'Change browser settings'],
        browsingData: ['high', 'Clear browsing data (history, cookies, cache…)'],
        captivePortal: ['low', 'Detect captive portals'],
        clipboardRead: ['high', 'Read the clipboard'],
        clipboardWrite: ['low', 'Write to the clipboard'],
        contentSettings: ['medium', 'Change per-site settings'],
        contextMenus: ['low', 'Add context menu items'],
        contextualIdentities: ['low', 'Use containers'],
        cookies: ['high', 'Read and change cookies of the sites it has access to'],
        debugger: ['high', 'Use the debugger protocol on tabs'],
        declarativeNetRequest: ['medium', 'Block or change network requests with rules'],
        declarativeNetRequestFeedback: ['medium', 'See which network request rules matched'],
        declarativeNetRequestWithHostAccess: ['medium', 'Network request rules that need host access'],
        devtools: ['low', 'Extend the developer tools'],
        dns: ['low', 'Resolve domain names'],
        downloads: ['medium', 'Download files and read the download history'],
        'downloads.open': ['medium', 'Open downloaded files'],
        find: ['medium', 'Search text in pages'],
        geolocation: ['high', 'Use the location of the user'],
        history: ['high', 'Read and change the browsing history'],
        identity: ['medium', 'Sign in to services (OAuth)'],
        idle: ['low', 'Detect when the computer is idle'],
        management: ['high', 'Manage other add-ons'],
        menus: ['low', 'Add context menu items'],
        'menus.overrideContext': ['low', 'Replace the context menu on its pages'],
        nativeMessaging: ['high', 'Talk to programs installed on the computer'],
        notifications: ['low', 'Show notifications'],
        pageCapture: ['medium', 'Save pages as MHTML'],
        pkcs11: ['high', 'Manage security modules'],
        privacy: ['high', 'Change privacy settings'],
        proxy: ['high', 'Proxy all network traffic'],
        scripting: ['medium', 'Inject scripts and styles into pages'],
        search: ['low', 'Use search engines'],
        sessions: ['medium', 'Read and restore recently closed tabs'],
        storage: ['low', 'Store data'],
        tabHide: ['low', 'Hide tabs'],
        tabs: ['medium', 'See the address and title of all tabs'],
        theme: ['low', 'Change the browser theme'],
        topSites: ['medium', 'Read the most visited sites'],
        unlimitedStorage: ['low', 'Store any amount of data'],
        webNavigation: ['medium', 'See navigation events of all tabs'],
        webRequest: ['high', 'See network requests'],
        webRequestBlocking: ['high', 'Block or change network requests'],
        webRequestFilterResponse: ['high', 'Read and change the content of network responses'],
        'webRequestFilterResponse.serviceWorkerScript': ['high', 'Change service worker scripts'],
        userScripts: ['high', 'Run user scripts in pages'],
    };

    function isHostPattern(value) {
        return value === '<all_urls>' || /^(\*|https?|wss?|ftp|file|data):\/\//.test(value) || /^\*:\/\//.test(value);
    }

    // How broad a host pattern is: 'all' for every site, else 'some'.
    function hostBreadth(pattern) {
        if (pattern === '<all_urls>' || /^[^:]+:\/\/\*\//.test(pattern) || /^[^:]+:\/\/\*$/.test(pattern)) {
            return 'all';
        }
        return 'some';
    }

    function asArray(value) {
        if (Array.isArray(value)) return value.filter(function(v) { return typeof v === 'string'; });
        return [];
    }

    // Summarizes manifest.json (an object) for a review.
    function analyzeManifest(manifest) {
        manifest = manifest || {};
        var apiPermissions = [];
        var hosts = [];
        function addAll(list, optional) {
            asArray(list).forEach(function(value) {
                if (isHostPattern(value) && value !== '<all_urls>') {
                    hosts.push({pattern: value, optional: optional, breadth: hostBreadth(value)});
                } else {
                    if (value === '<all_urls>') hosts.push({pattern: value, optional: optional, breadth: 'all'});
                    var info = PERMISSIONS[value] || ['medium', 'See the WebExtension documentation'];
                    apiPermissions.push({name: value, optional: optional, level: info[0], description: info[1]});
                }
            });
        }
        addAll(manifest.permissions, false);
        addAll(manifest.host_permissions, false);
        addAll(manifest.optional_permissions, true);
        addAll(manifest.optional_host_permissions, true);
        // In manifest.json, <all_urls> is listed as a host; avoid listing it twice.
        apiPermissions = apiPermissions.filter(function(p) { return p.name !== '<all_urls>'; });

        var contentScripts = [];
        (Array.isArray(manifest.content_scripts) ? manifest.content_scripts : []).forEach(function(script) {
            contentScripts.push({
                matches: asArray(script && script.matches),
                js: asArray(script && script.js),
                css: asArray(script && script.css),
                allFrames: !!(script && script.all_frames),
                runAt: script && script.run_at || 'document_idle',
            });
        });
        contentScripts.forEach(function(script) {
            script.matches.forEach(function(pattern) {
                if (!hosts.some(function(h) { return h.pattern === pattern; })) {
                    hosts.push({pattern: pattern, optional: false, breadth: hostBreadth(pattern), contentScript: true});
                }
            });
        });

        var csp = manifest.content_security_policy;
        var cspText = typeof csp === 'string' ? csp :
            csp && typeof csp === 'object' ? Object.keys(csp).map(function(k) { return k + ': ' + csp[k]; }).join('\n') : '';
        var cspIssues = [];
        if (/unsafe-eval/.test(cspText)) cspIssues.push("'unsafe-eval' allows eval() and new Function()");
        if (/unsafe-inline/.test(cspText)) cspIssues.push("'unsafe-inline' allows inline scripts");
        if (/script-src[^;]*https?:/.test(cspText)) cspIssues.push('Scripts may be loaded from remote servers');

        var war = manifest.web_accessible_resources;
        var webAccessible = [];
        (Array.isArray(war) ? war : []).forEach(function(item) {
            if (typeof item === 'string') webAccessible.push(item);
            else if (item && Array.isArray(item.resources)) webAccessible.push.apply(webAccessible, asArray(item.resources));
        });

        var gecko = manifest.browser_specific_settings && manifest.browser_specific_settings.gecko ||
            manifest.applications && manifest.applications.gecko || {};
        return {
            name: typeof manifest.name === 'string' ? manifest.name : '',
            version: typeof manifest.version === 'string' ? manifest.version : '',
            manifestVersion: manifest.manifest_version || null,
            id: typeof gecko.id === 'string' ? gecko.id : '',
            permissions: apiPermissions,
            hosts: hosts,
            contentScripts: contentScripts,
            csp: cspText,
            cspIssues: cspIssues,
            webAccessible: webAccessible,
            externallyConnectable: manifest.externally_connectable ? JSON.stringify(manifest.externally_connectable) : '',
            background: manifest.background ? Object.keys(manifest.background).join(', ') : '',
        };
    }

    // What changed between two manifests, for the Compare page.
    function diffManifests(oldInfo, newInfo) {
        function names(list, key) {
            return list.map(function(item) { return item[key] + (item.optional ? ' (optional)' : ''); });
        }
        function diff(a, b) {
            return {
                added: b.filter(function(x) { return a.indexOf(x) === -1; }),
                removed: a.filter(function(x) { return b.indexOf(x) === -1; }),
            };
        }
        var oldMatches = [].concat.apply([], oldInfo.contentScripts.map(function(s) { return s.matches; }));
        var newMatches = [].concat.apply([], newInfo.contentScripts.map(function(s) { return s.matches; }));
        return {
            permissions: diff(names(oldInfo.permissions, 'name'), names(newInfo.permissions, 'name')),
            hosts: diff(names(oldInfo.hosts.filter(function(h) { return !h.contentScript; }), 'pattern'),
                names(newInfo.hosts.filter(function(h) { return !h.contentScript; }), 'pattern')),
            contentScripts: diff(oldMatches.filter(unique), newMatches.filter(unique)),
            cspChanged: oldInfo.csp !== newInfo.csp,
            oldCsp: oldInfo.csp,
            newCsp: newInfo.csp,
            webAccessible: diff(oldInfo.webAccessible, newInfo.webAccessible),
        };
    }
    function unique(value, index, list) {
        return list.indexOf(value) === index;
    }

    function permissionInfo(name) {
        var info = PERMISSIONS[name.replace(/ \(optional\)$/, '')];
        return info ? {level: info[0], description: info[1]} : null;
    }

    // ---- Code to check

    var RULES = [
        {id: 'eval', level: 'high', title: 'eval()', why: 'Runs a string as code',
            files: /\.(m?js|cjs|jsm|html?)$/i, re: /(^|[^.\w$])eval\s*\(/g},
        {id: 'function', level: 'high', title: 'new Function()', why: 'Creates code from a string',
            files: /\.(m?js|cjs|jsm|html?)$/i, re: /\bnew\s+Function\s*\(/g},
        {id: 'string-timer', level: 'medium', title: 'setTimeout/setInterval with a string',
            why: 'Runs a string as code', files: /\.(m?js|cjs|jsm|html?)$/i,
            re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/g},
        {id: 'remote-script', level: 'high', title: 'Remote script', why: 'Loads code from a server',
            files: /\.(html?|xhtml)$/i, re: /<script\b[^>]*\bsrc\s*=\s*["']?(?:https?:)?\/\//gi},
        {id: 'remote-import', level: 'high', title: 'Remote import()', why: 'Loads code from a server',
            files: /\.(m?js|cjs|jsm)$/i, re: /\b(?:import\s*\(|importScripts\s*\()\s*['"`]https?:/g},
        {id: 'inject', level: 'medium', title: 'Code injection into pages',
            why: 'Runs code in web pages', files: /\.(m?js|cjs|jsm)$/i,
            re: /\b(?:tabs\.executeScript|scripting\.executeScript|contentScripts\.register|userScripts\.register)\s*\(/g},
        {id: 'html-sink', level: 'medium', title: 'HTML from a variable',
            why: 'innerHTML, outerHTML, insertAdjacentHTML or document.write with a value that is not a fixed string',
            files: /\.(m?js|cjs|jsm|html?)$/i,
            re: /(?:\.(?:inner|outer)HTML\s*\+?=\s*(?!\s*['"`][^'"`$]*['"`]\s*[;,)\n])|\.insertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\()/g},
        {id: 'wasm', level: 'low', title: 'WebAssembly', why: 'Compiled code that is hard to read',
            files: /\.(m?js|cjs|jsm)$/i, re: /\bWebAssembly\.(?:instantiate|compile|Module)\b/g},
    ];
    var MAX_PER_FILE = 25;

    function scanCode(filename, text) {
        var findings = [];
        var index = null;
        RULES.forEach(function(rule) {
            if (!rule.files.test(filename)) return;
            rule.re.lastIndex = 0;
            var count = 0;
            var match;
            while ((match = rule.re.exec(text)) && count < MAX_PER_FILE) {
                if (match[0] === '') rule.re.lastIndex++;
                if (!index) index = ZenFiles.lineIndex(text);
                var line = index.lineAt(match.index);
                var lineText = index.lineText(line);
                // Skip comments (lines starting with //, /* or *, and text after // on the line).
                var trimmed = lineText.trim();
                if (/^(\/\/|\/\*|\*)/.test(trimmed)) continue;
                var before = text.slice(text.lastIndexOf('\n', match.index - 1) + 1, match.index);
                if (/(^|[^:'"`\\])\/\/[^'"`]*$/.test(before)) continue;
                findings.push({rule: rule.id, file: filename, line: line, snippet: trimmed.slice(0, 180)});
                count++;
            }
        });
        // Minified or obfuscated files are hard to review.
        if (/\.(m?js|cjs|jsm)$/i.test(filename) && text.length > 4000) {
            var lines = text.split('\n');
            var longest = 0;
            lines.forEach(function(l) { if (l.length > longest) longest = l.length; });
            var average = text.length / lines.length;
            var hexNames = (text.match(/\b_0x[0-9a-f]{4,}\b/g) || []).length;
            if (hexNames > 20) {
                findings.push({rule: 'obfuscated', file: filename, line: 1,
                    snippet: hexNames + ' names like _0x1a2b (typical of obfuscators)'});
            } else if (longest > 3000 || average > 400) {
                findings.push({rule: 'minified', file: filename, line: 1,
                    snippet: 'Lines up to ' + longest.toLocaleString() + ' characters'});
            }
        }
        return findings;
    }
    var EXTRA_RULES = {
        obfuscated: {level: 'high', title: 'Obfuscated code', why: 'Mozilla does not allow obfuscated code'},
        minified: {level: 'low', title: 'Minified file',
            why: 'Hard to read; Mozilla may ask for the source code (use Beautify to read it)'},
    };
    function ruleInfo(id) {
        for (var i = 0; i < RULES.length; i++) {
            if (RULES[i].id === id) return RULES[i];
        }
        return EXTRA_RULES[id];
    }

    // ---- Network endpoints

    var URL_RE = /\b(?:https?|wss?):\/\/[^\s'"`<>()\\{}\[\]|^]+/g;
    var IGNORED_HOSTS = /^(www\.w3\.org|www\.mozilla\.org\/(keymaster|xbl)|ns\.adobe\.com|purl\.org|schemas\.|json-schema\.org)/;

    function scanEndpoints(filename, text, byHost) {
        var index = null;
        URL_RE.lastIndex = 0;
        var match;
        var perFile = 0;
        while ((match = URL_RE.exec(text)) && perFile < 400) {
            var url = match[0].replace(/[.,;:]+$/, '');
            var host = url.replace(/^[a-z]+:\/\//i, '').split(/[/?#]/)[0].toLowerCase();
            if (!host || /[*$]/.test(host) || IGNORED_HOSTS.test(url.replace(/^[a-z]+:\/\//i, ''))) continue;
            if (!index) index = ZenFiles.lineIndex(text);
            var entry = byHost.get(host);
            if (!entry) byHost.set(host, entry = {host: host, urls: new Map(), count: 0});
            entry.count++;
            if (!entry.urls.has(url)) entry.urls.set(url, []);
            var places = entry.urls.get(url);
            if (places.length < 20) places.push({file: filename, line: index.lineAt(match.index)});
            perFile++;
        }
    }

    // ---- Translations in code

    var USE_PATTERNS = [
        /__MSG_([A-Za-z0-9_@]+)__/g,
        /\bgetMessage\s*\(\s*['"`]([A-Za-z0-9_@]+)['"`]/g,
    ];

    // keys: lowercase message names defined by any messages.json.
    function scanI18n(files, definedKeys) {
        var used = new Map(); // lowercase key -> {key, places}
        var dynamicCalls = 0;
        var words = new Set();
        files.forEach(function(file) {
            if (/(^|\/)_locales\//.test(file.filename)) return;
            var index = null;
            USE_PATTERNS.forEach(function(re) {
                re.lastIndex = 0;
                var match;
                while ((match = re.exec(file.text))) {
                    if (match[1].indexOf('@@') === 0) continue;
                    if (!index) index = ZenFiles.lineIndex(file.text);
                    var lower = match[1].toLowerCase();
                    var entry = used.get(lower);
                    if (!entry) used.set(lower, entry = {key: match[1], places: []});
                    if (entry.places.length < 20) entry.places.push({file: file.filename, line: index.lineAt(match.index)});
                }
            });
            dynamicCalls += (file.text.match(/\bgetMessage\s*\(\s*[^'"`\s)]/g) || []).length;
            // Any word in the code may be a message name (e.g. data-i18n="key", i18n$('key')).
            var wordMatch;
            var wordRe = /[A-Za-z0-9_@]{2,}/g;
            while ((wordMatch = wordRe.exec(file.text))) words.add(wordMatch[0].toLowerCase());
        });
        var undefinedKeys = [];
        used.forEach(function(entry, lower) {
            if (!definedKeys.has(lower)) undefinedKeys.push(entry);
        });
        var unusedKeys = [];
        definedKeys.forEach(function(name, lower) {
            if (!words.has(lower)) unusedKeys.push(name);
        });
        undefinedKeys.sort(function(a, b) { return a.key.localeCompare(b.key); });
        unusedKeys.sort(function(a, b) { return a.localeCompare(b); });
        return {used: used.size, undefinedKeys: undefinedKeys, unusedKeys: unusedKeys, dynamicCalls: dynamicCalls};
    }

    // ---- Running the review

    var cache = null; // {generation, result}
    var generation = 0;
    var running = null;

    function invalidate() {
        generation++;
        cache = null;
        if (ZenMainView.currentId() === 'review') {
            var stale = document.querySelector('#source-code .rv-stale');
            if (stale) stale.hidden = false;
        }
    }

    function run(onProgress) {
        if (cache && cache.generation === generation) return Promise.resolve(cache.result);
        if (running && running.generation === generation) return running.promise;
        var myGeneration = generation;
        var files = ZenFiles.list();
        var codeFiles = files.filter(function(f) { return ZenFiles.isCode(f.filename) && f.size < 30e6; });
        var promise = ZenFiles.readAll(codeFiles, onProgress).then(function(texts) {
            var result = {
                fileCount: files.length,
                scannedCount: texts.length,
                manifest: null,
                manifestFile: null,
                manifestError: null,
                findings: [],
                endpoints: [],
                i18n: null,
            };
            var manifestFile = texts.filter(function(t) { return /(^|\/)manifest\.json$/i.test(t.filename); })
                .sort(function(a, b) { return a.filename.split('/').length - b.filename.split('/').length; })[0];
            if (manifestFile) {
                result.manifestFile = manifestFile.filename;
                try {
                    result.manifest = analyzeManifest(parseManifest(manifestFile.text));
                } catch (e) {
                    result.manifestError = e.message;
                }
            }
            var byHost = new Map();
            var definedKeys = new Map();
            texts.forEach(function(file) {
                if (/(^|\/)_locales\/[^/]+\/messages\.json$/i.test(file.filename)) {
                    try {
                        Object.keys(JSON.parse(file.text)).forEach(function(key) {
                            if (key.indexOf('@@') !== 0) definedKeys.set(key.toLowerCase(), key);
                        });
                    } catch (e) {
                        // Shown by the Locales panel.
                    }
                    return;
                }
                result.findings.push.apply(result.findings, scanCode(file.filename, file.text));
                scanEndpoints(file.filename, file.text, byHost);
            });
            result.endpoints = Array.from(byHost.values()).sort(function(a, b) {
                return b.count - a.count || a.host.localeCompare(b.host);
            });
            result.i18n = definedKeys.size || /__MSG_/.test(manifestFile ? manifestFile.text : '') ?
                scanI18n(texts, definedKeys) : null;
            if (myGeneration === generation) cache = {generation: myGeneration, result: result};
            return result;
        });
        running = {generation: myGeneration, promise: promise};
        return promise;
    }

    // ---- The Review view

    function el(tag, className, text) {
        var element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== undefined) element.textContent = text;
        return element;
    }
    function placeLink(place) {
        var a = el('a', 'rv-place', place.file + ':' + place.line);
        a.href = '#';
        a.title = 'Open ' + place.file + ' at line ' + place.line;
        a.onclick = function(e) {
            e.preventDefault();
            ZenFiles.openAt(place.file, place.line);
        };
        return a;
    }
    function section(body, id, title, count, level) {
        var box = el('section', 'rv-section');
        box.id = 'rv-' + id;
        var heading = el('h3', 'rv-section-title');
        heading.appendChild(document.createTextNode(title));
        if (count !== undefined) heading.appendChild(el('span', 'rv-count' + (level ? ' is-' + level : ''), String(count)));
        box.appendChild(heading);
        body.appendChild(box);
        return box;
    }
    function levelBadge(level) {
        return el('span', 'rv-level is-' + level, {high: 'High', medium: 'Medium', low: 'Low'}[level] || level);
    }

    function open() {
        ZenMainView.show('review', function(toolbar, body) {
            renderToolbar(toolbar);
            body.classList.add('rv-body');
            var status = el('p', 'rv-status', 'Reading the files…');
            body.appendChild(status);
            run(function(done, total) {
                status.textContent = 'Reading the files… ' + done + ' of ' + total;
            }).then(function(result) {
                if (ZenMainView.currentId() !== 'review') return;
                body.textContent = '';
                renderReport(body, result);
            });
        });
    }

    function renderToolbar(toolbar) {
        var bar = el('div', 'rv-toolbar');
        bar.appendChild(el('span', 'rv-title', 'Review'));
        [['summary', 'Summary'], ['permissions', 'Permissions'], ['code', 'Code to check'],
            ['endpoints', 'Network'], ['i18n', 'Translations in code']].forEach(function(item) {
            var link = el('button', 'rv-jump', item[1]);
            link.type = 'button';
            link.onclick = function() {
                var target = document.getElementById('rv-' + item[0]);
                if (target) target.scrollIntoView({block: 'start'});
            };
            bar.appendChild(link);
        });
        var spacer = el('span', 'rv-spacer');
        bar.appendChild(spacer);
        var exportButton = el('button', '', 'Export report');
        exportButton.type = 'button';
        exportButton.title = 'Download this report as Markdown';
        exportButton.onclick = function() {
            run().then(function(result) {
                ZenFiles.downloadText(toMarkdown(result), ZenFiles.archiveName() + '-review.md', 'text/markdown;charset=utf-8');
            });
        };
        var rescan = el('button', '', 'Rescan');
        rescan.type = 'button';
        rescan.onclick = function() {
            invalidate();
            open();
        };
        bar.append(exportButton, rescan);
        toolbar.appendChild(bar);
    }

    function counts(result) {
        var c = {high: 0, medium: 0, low: 0};
        result.findings.forEach(function(f) { c[ruleInfo(f.rule).level]++; });
        return c;
    }

    function renderReport(body, result) {
        var stale = el('div', 'rv-stale');
        stale.hidden = true;
        stale.append('A file was edited, so this report may be out of date. ');
        var rescan = el('button', '', 'Rescan');
        rescan.type = 'button';
        rescan.onclick = function() { open(); };
        stale.appendChild(rescan);
        body.appendChild(stale);

        var m = result.manifest;
        var c = counts(result);
        var allHosts = m && m.hosts.some(function(h) { return h.breadth === 'all' && !h.optional; });

        // Summary cards.
        var summary = section(body, 'summary', m && m.name ? m.name + (m.version ? ' ' + m.version : '') : 'Summary');
        if (m) {
            summary.appendChild(el('p', 'rv-meta', [
                m.id ? 'ID ' + m.id : 'No add-on ID in the manifest',
                'Manifest version ' + (m.manifestVersion || '?'),
                result.scannedCount + ' of ' + result.fileCount + ' files scanned (code, HTML, CSS, JSON)',
            ].join(' · ')));
        }
        var cards = el('div', 'rv-cards');
        function card(value, label, level, target) {
            var box = el('button', 'rv-card' + (level ? ' is-' + level : ''));
            box.type = 'button';
            box.append(el('span', 'rv-card-value', String(value)), el('span', 'rv-card-label', label));
            box.onclick = function() {
                document.getElementById('rv-' + target).scrollIntoView({block: 'start'});
            };
            cards.appendChild(box);
        }
        if (m) {
            card(m.permissions.filter(function(p) { return !p.optional; }).length, 'permissions',
                m.permissions.some(function(p) { return p.level === 'high' && !p.optional; }) ? 'high' : '', 'permissions');
            card(allHosts ? 'All sites' : m.hosts.filter(function(h) { return !h.optional; }).length + ' sites',
                'host access', allHosts ? 'high' : '', 'permissions');
        }
        card(c.high, 'high-risk patterns', c.high ? 'high' : 'ok', 'code');
        card(c.medium + c.low, 'other patterns to check', c.medium ? 'medium' : '', 'code');
        card(result.endpoints.length, 'web hosts in the code', '', 'endpoints');
        if (result.i18n) {
            card(result.i18n.undefinedKeys.length, 'message keys used but not defined',
                result.i18n.undefinedKeys.length ? 'high' : 'ok', 'i18n');
        }
        summary.appendChild(cards);

        renderPermissions(body, result);
        renderFindings(body, result);
        renderEndpoints(body, result);
        renderI18n(body, result);
    }

    function renderPermissions(body, result) {
        var m = result.manifest;
        var box = section(body, 'permissions', 'Permissions', m ? m.permissions.length + m.hosts.length : 0);
        if (!m) {
            box.appendChild(el('p', 'rv-empty', result.manifestError ?
                'manifest.json could not be read: ' + result.manifestError : 'No manifest.json found.'));
            return;
        }
        var table = el('table', 'rv-table');
        function row(cells, level) {
            var tr = el('tr');
            cells.forEach(function(cell, i) {
                var td = el('td');
                if (cell instanceof Node) td.appendChild(cell);
                else td.textContent = cell;
                tr.appendChild(td);
            });
            if (level) tr.className = 'is-' + level;
            table.appendChild(tr);
        }
        m.permissions.slice().sort(function(a, b) {
            var order = {high: 0, medium: 1, low: 2};
            return order[a.level] - order[b.level] || a.name.localeCompare(b.name);
        }).forEach(function(p) {
            var name = el('code', '', p.name);
            row([levelBadge(p.level), name, p.description + (p.optional ? ' (optional: asked when needed)' : '')], p.level);
        });
        m.hosts.forEach(function(h) {
            var level = h.breadth === 'all' ? 'high' : 'medium';
            row([levelBadge(level), el('code', '', h.pattern),
                (h.contentScript ? 'Content script runs on ' : 'Access to ') +
                (h.breadth === 'all' ? 'all websites' : 'these sites') + (h.optional ? ' (optional)' : '')], level);
        });
        if (!table.childNodes.length) {
            box.appendChild(el('p', 'rv-empty', 'No permissions.'));
        } else {
            box.appendChild(table);
        }
        if (m.contentScripts.length) {
            var scripts = el('details', 'rv-details');
            scripts.appendChild(el('summary', '', m.contentScripts.length + ' content script' +
                (m.contentScripts.length === 1 ? '' : 's')));
            m.contentScripts.forEach(function(s) {
                scripts.appendChild(el('p', 'rv-code-line', s.matches.join(', ') + ' → ' +
                    s.js.concat(s.css).join(', ') + ' (' + s.runAt + (s.allFrames ? ', all frames' : '') + ')'));
            });
            box.appendChild(scripts);
        }
        var csp = el('div', 'rv-csp');
        csp.appendChild(el('strong', '', 'Content security policy: '));
        csp.appendChild(el('code', '', m.csp || 'default (no custom policy)'));
        box.appendChild(csp);
        m.cspIssues.forEach(function(issue) {
            box.appendChild(el('p', 'rv-warning', '⚠ ' + issue));
        });
        if (m.webAccessible.length) {
            box.appendChild(el('p', 'rv-note', 'Web-accessible resources (pages can load these): ' +
                m.webAccessible.join(', ')));
        }
        if (m.externallyConnectable) {
            box.appendChild(el('p', 'rv-note', 'externally_connectable: ' + m.externallyConnectable));
        }
    }

    function renderFindings(body, result) {
        var c = counts(result);
        var box = section(body, 'code', 'Code to check', result.findings.length, c.high ? 'high' : c.medium ? 'medium' : '');
        if (!result.findings.length) {
            box.appendChild(el('p', 'rv-empty', 'No risky patterns found.'));
            return;
        }
        var groups = new Map();
        result.findings.forEach(function(f) {
            if (!groups.has(f.rule)) groups.set(f.rule, []);
            groups.get(f.rule).push(f);
        });
        var order = {high: 0, medium: 1, low: 2};
        Array.from(groups.keys()).sort(function(a, b) {
            return order[ruleInfo(a).level] - order[ruleInfo(b).level];
        }).forEach(function(id) {
            var info = ruleInfo(id);
            var list = groups.get(id);
            var group = el('details', 'rv-details rv-rule is-' + info.level);
            group.open = info.level === 'high';
            var summary = el('summary');
            summary.append(levelBadge(info.level), ' ', el('strong', '', info.title), ' ',
                el('span', 'rv-muted', list.length + ' · ' + info.why));
            group.appendChild(summary);
            var ul = el('ul', 'rv-places');
            list.slice(0, 200).forEach(function(f) {
                var li = el('li');
                li.append(placeLink(f), el('code', 'rv-snippet', f.snippet));
                ul.appendChild(li);
            });
            if (list.length > 200) ul.appendChild(el('li', 'rv-muted', '… and ' + (list.length - 200) + ' more'));
            group.appendChild(ul);
            box.appendChild(group);
        });
    }

    function renderEndpoints(body, result) {
        var box = section(body, 'endpoints', 'Network', result.endpoints.length);
        box.appendChild(el('p', 'rv-note', 'Web addresses that appear in the code. The add-on may contact them; ' +
            'some are only links or documentation.'));
        if (!result.endpoints.length) {
            box.appendChild(el('p', 'rv-empty', 'No web addresses found.'));
            return;
        }
        result.endpoints.forEach(function(endpoint) {
            var group = el('details', 'rv-details');
            var summary = el('summary');
            summary.append(el('code', '', endpoint.host), ' ', el('span', 'rv-muted', endpoint.count + ' · ' +
                endpoint.urls.size + ' address' + (endpoint.urls.size === 1 ? '' : 'es')));
            group.appendChild(summary);
            var ul = el('ul', 'rv-places');
            Array.from(endpoint.urls.keys()).slice(0, 100).forEach(function(url) {
                var li = el('li');
                li.appendChild(el('code', 'rv-url', url));
                endpoint.urls.get(url).slice(0, 5).forEach(function(place) {
                    li.append(' ', placeLink(place));
                });
                ul.appendChild(li);
            });
            group.appendChild(ul);
            box.appendChild(group);
        });
    }

    function renderI18n(body, result) {
        var i18n = result.i18n;
        var box = section(body, 'i18n', 'Translations in code', i18n ? i18n.undefinedKeys.length : 0,
            i18n && i18n.undefinedKeys.length ? 'high' : '');
        if (!i18n) {
            box.appendChild(el('p', 'rv-empty', 'This add-on has no messages.json files.'));
            return;
        }
        box.appendChild(el('p', 'rv-note', i18n.used + ' message keys are used by name in the code ' +
            '(__MSG_name__ or getMessage("name")).' + (i18n.dynamicCalls ?
                ' ' + i18n.dynamicCalls + ' getMessage() calls use a variable, so they are not checked.' : '')));

        var missing = el('div', 'rv-subsection');
        missing.appendChild(el('h4', '', '✕ Used in the code but not defined (' + i18n.undefinedKeys.length + ')'));
        missing.appendChild(el('p', 'rv-muted', 'No messages.json has these keys: users see an empty text.'));
        if (i18n.undefinedKeys.length) {
            var ul = el('ul', 'rv-places');
            i18n.undefinedKeys.forEach(function(entry) {
                var li = el('li');
                li.appendChild(el('code', 'rv-key is-missing', entry.key));
                entry.places.slice(0, 5).forEach(function(place) { li.append(' ', placeLink(place)); });
                ul.appendChild(li);
            });
            missing.appendChild(ul);
        } else {
            missing.appendChild(el('p', 'rv-ok', 'Every key used by name is defined.'));
        }
        box.appendChild(missing);

        var unused = el('details', 'rv-details rv-subsection');
        unused.appendChild(el('summary', '', '= Defined but not mentioned in the code (' + i18n.unusedKeys.length + ')'));
        unused.appendChild(el('p', 'rv-muted', 'No code file contains these key names. They may be unused, ' +
            'or built from parts at run time.'));
        if (i18n.unusedKeys.length) {
            var keys = el('p', 'rv-keys');
            i18n.unusedKeys.forEach(function(key) { keys.appendChild(el('code', 'rv-key', key)); });
            unused.appendChild(keys);
        }
        box.appendChild(unused);
    }

    function toMarkdown(result) {
        var m = result.manifest;
        var lines = ['# Review: ' + (m && m.name || ZenFiles.archiveName()) + (m && m.version ? ' ' + m.version : ''), ''];
        if (m) {
            lines.push('- Add-on ID: ' + (m.id || '(none)'), '- Manifest version: ' + (m.manifestVersion || '?'), '');
            lines.push('## Permissions', '');
            m.permissions.forEach(function(p) {
                lines.push('- **' + p.level + '** `' + p.name + '`: ' + p.description + (p.optional ? ' (optional)' : ''));
            });
            m.hosts.forEach(function(h) {
                lines.push('- **' + (h.breadth === 'all' ? 'high' : 'medium') + '** `' + h.pattern + '`' +
                    (h.contentScript ? ' (content script)' : '') + (h.optional ? ' (optional)' : ''));
            });
            lines.push('', 'Content security policy: `' + (m.csp || 'default') + '`');
            m.cspIssues.forEach(function(issue) { lines.push('- ⚠ ' + issue); });
            lines.push('');
        }
        lines.push('## Code to check', '');
        if (!result.findings.length) lines.push('No risky patterns found.');
        result.findings.forEach(function(f) {
            var info = ruleInfo(f.rule);
            lines.push('- **' + info.level + '** ' + info.title + ': `' + f.file + ':' + f.line + '` `' +
                f.snippet.replace(/`/g, "'") + '`');
        });
        lines.push('', '## Network', '');
        result.endpoints.forEach(function(e) {
            lines.push('- `' + e.host + '` (' + e.count + ')');
        });
        if (result.i18n) {
            lines.push('', '## Translations in code', '');
            lines.push('Used but not defined: ' + (result.i18n.undefinedKeys.map(function(k) {
                return '`' + k.key + '`';
            }).join(', ') || 'none'));
            lines.push('', 'Defined but not mentioned in the code: ' + result.i18n.unusedKeys.length);
        }
        lines.push('', '_Created with Zen Source Viewer on ' + new Date().toISOString().slice(0, 10) + '._', '');
        return lines.join('\n');
    }

    if (typeof document !== 'undefined') {
        var bind = function() {
            var button = document.getElementById('review-toggle');
            if (button) button.onclick = open;
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
        else bind();
    }

    return {
        analyzeManifest: analyzeManifest,
        diffManifests: diffManifests,
        permissionInfo: permissionInfo,
        open: open,
        invalidate: invalidate,
        run: run,
    };
})();
