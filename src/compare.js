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
 */

/* jshint browser:true, devel:true, esversion:6 */
/* globals zip, Uint8ArrayWriter, openAddonAsZip, get_addon_download_url, is_addon_download_url,
           get_zip_name, get_amo_domain, get_amo_slug, getXpis, getParam, encodeQueryString,
           beautify, ZenEditor, ZenPatch, ZenReview, stripJsonComments */
'use strict';

// Compares two versions of an add-on (or any two zip files). Each version can
// be fetched from a URL (an add-on page, XPI or zip) or uploaded from the
// computer. Files are compared by their CRC-32 checksum and size; text files
// are shown as a diff (CodeMirror merge view).
// Two reports compare the versions as a whole: permission changes (with
// review-report.js) and translations that were not updated.

var MAX_STATS_SIZE = 2e6; // Larger files are not counted in the line totals.
var IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/i;

var sources = {old: null, new: null};
var comparison = null; // {files: [...], byPath: Map}
var currentPath = null;
var diffView = null;
var prefs = {mode: 'split', wrap: false, beautify: true};
var objectUrls = [];

function $(selector, root) {
    return (root || document).querySelector(selector);
}
function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}
function formatSize(bytes) {
    if (bytes < 1e4) return bytes + ' B';
    if (bytes < 1e6) return Math.round(bytes / 1e3) + ' KB';
    return (bytes / 1e6).toFixed(1) + ' MB';
}
function card(side) {
    return $('.source-card[data-side="' + side + '"]');
}
function setStatus(side, text, kind) {
    var status = $('.source-status', card(side));
    status.textContent = text;
    status.dataset.kind = kind || '';
}

// ---- Loading a version

function loadSource(side, source) {
    var label = source.file ? source.file.name : source.label || source.url;
    setStatus(side, 'Loading ' + label + '…', 'busy');
    card(side).classList.remove('is-loaded');
    sources[side] = null;
    updateCompareButton();

    var target = source.file;
    if (!target) {
        target = is_addon_download_url(source.url) ? source.url : get_addon_download_url(source.url);
    }
    openAddonAsZip(target, function(blob) {
        zip.createReader(new zip.BlobReader(blob), function(reader) {
            reader.getEntries(function(entries) {
                var files = new Map();
                var totalSize = 0;
                entries.forEach(function(entry) {
                    if (entry.directory) return;
                    files.set(entry.filename, entry);
                    totalSize += entry.uncompressedSize;
                });
                sources[side] = {
                    name: source.file ? source.file.name : get_zip_name(target).replace(/\.zip$/, ''),
                    label: source.label || '',
                    url: source.file ? '' : source.url,
                    files: files,
                };
                setStatus(side, '✓ ' + sources[side].name +
                    (source.label ? ' (' + source.label + ')' : '') +
                    ' — ' + files.size + ' files, ' + formatSize(totalSize), 'ok');
                card(side).classList.add('is-loaded');
                if (!source.file) $('input[name=url]', card(side)).value = source.url;
                updateCompareButton();
                updateUrl();
                if (sources.old && sources.new && source.autoCompare) {
                    runComparison();
                }
            });
        }, function(error) {
            setStatus(side, 'Could not read ' + label + ' as a zip file: ' + error, 'error');
        });
    }, function(error) {
        setStatus(side, error, 'error');
    }, function(event) {
        if (event.lengthComputable) {
            setStatus(side, 'Loading ' + label + '… ' +
                Math.round(event.loaded / event.total * 100) + '%', 'busy');
        }
    });
}

function updateCompareButton() {
    $('#compare-button').disabled = !(sources.old && sources.new);
}

// Keeps fetched URLs in the address, so that the comparison can be reopened or shared.
function updateUrl() {
    var params = {};
    if (sources.old && sources.old.url) params.old = sources.old.url;
    if (sources.new && sources.new.url) params.new = sources.new.url;
    var query = encodeQueryString(params);
    history.replaceState(null, '', location.pathname + (query ? '?' + query : ''));
}

function setUpSourceCard(side) {
    var root = card(side);
    $('.source-url-form', root).addEventListener('submit', function(event) {
        event.preventDefault();
        var url = $('input[name=url]', root).value.trim();
        if (url) loadSource(side, {url: url});
    });
    var drop = $('.source-drop', root);
    var fileInput = $('input[type=file]', root);
    fileInput.addEventListener('change', function() {
        if (fileInput.files[0]) loadSource(side, {file: fileInput.files[0]});
        fileInput.value = '';
    });
    drop.addEventListener('keydown', function(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            fileInput.click();
        }
    });
    drop.addEventListener('dragover', function(event) {
        event.preventDefault();
        drop.classList.add('is-dragging');
    });
    drop.addEventListener('dragleave', function() {
        drop.classList.remove('is-dragging');
    });
    drop.addEventListener('drop', function(event) {
        event.preventDefault();
        drop.classList.remove('is-dragging');
        var file = event.dataTransfer.files[0];
        if (file) loadSource(side, {file: file});
    });
}

// ---- Versions from addons.mozilla.org

function setUpAmoVersions() {
    var form = $('#amo-versions-form');
    var list = $('#amo-versions-list');
    var status = $('#amo-versions-status');
    var moreButton = $('#amo-versions-more');
    var domain, slug;

    function showResults(results) {
        results.forEach(function(result) {
            var row = el('li', 'amo-version');
            var text = el('span', 'amo-version-text');
            text.appendChild(el('strong', '', result.version));
            text.appendChild(el('span', 'amo-version-date', ' ' + result.createdDate.toLocaleDateString() +
                (result.platform && result.platform !== 'all' ? ' · ' + result.platform : '')));
            row.appendChild(text);
            ['old', 'new'].forEach(function(side) {
                var button = el('button', 'amo-version-use', side === 'old' ? 'Old' : 'New');
                button.type = 'button';
                button.title = 'Use version ' + result.version + ' as the ' + side + ' version';
                button.addEventListener('click', function() {
                    loadSource(side, {url: result.url, label: 'version ' + result.version, autoCompare: true});
                });
                row.appendChild(button);
            });
            list.appendChild(row);
        });
    }
    function load(page) {
        getXpis(domain, slug, page, function(description, results, nextPage) {
            status.textContent = description;
            showResults(results);
            moreButton.hidden = !nextPage;
            moreButton.dataset.page = nextPage || '';
        });
    }
    form.addEventListener('submit', function(event) {
        event.preventDefault();
        var input = form.elements.slug.value.trim();
        domain = get_amo_domain(input);
        slug = get_amo_slug(input) || input.replace(/^.*\/addon\//, '').replace(/[\/?#].*$/, '');
        list.textContent = '';
        moreButton.hidden = true;
        status.textContent = 'Searching for versions of ' + slug + '…';
        load(0);
    });
    moreButton.addEventListener('click', function() {
        load(+moreButton.dataset.page);
    });
}

// ---- Comparing

function runComparison() {
    var oldFiles = sources.old.files;
    var newFiles = sources.new.files;
    var paths = new Set(Array.from(oldFiles.keys()).concat(Array.from(newFiles.keys())));
    var files = Array.from(paths).map(function(path) {
        var a = oldFiles.get(path);
        var b = newFiles.get(path);
        var status;
        if (!a) {
            status = 'added';
        } else if (!b) {
            status = 'removed';
        } else if (a.uncompressedSize !== b.uncompressedSize ||
                   a.crc32 === undefined || b.crc32 === undefined || a.crc32 !== b.crc32) {
            status = 'modified';
        } else {
            status = 'unchanged';
        }
        return {path: path, old: a, new: b, status: status, stats: null};
    });
    files.sort(function(x, y) {
        var xm = x.path === 'manifest.json', ym = y.path === 'manifest.json';
        if (xm !== ym) return xm ? -1 : 1;
        return x.path.localeCompare(y.path);
    });
    comparison = {files: files, byPath: new Map(files.map(function(f) { return [f.path, f]; }))};
    currentPath = null;

    $('#compare-setup').hidden = true;
    $('#compare-results').hidden = false;
    $('#edit-sources').hidden = false;
    $('#download-patch').hidden = false;
    $('#compare-subtitle').textContent = describeSource(sources.old) + '  →  ' + describeSource(sources.new);
    renderFileList();
    renderSummary();
    countChangedLines();
    computeReports(comparison);

    var first = files.find(function(f) { return f.status !== 'unchanged'; });
    if (first) {
        showFile(first.path);
    } else {
        clearDiff('The two versions contain identical files.');
    }
}

function describeSource(source) {
    return source.name + (source.label ? ' (' + source.label + ')' : '');
}

function renderSummary() {
    var counts = {modified: 0, added: 0, removed: 0, unchanged: 0};
    var added = 0, removed = 0, counted = true;
    comparison.files.forEach(function(f) {
        counts[f.status]++;
        if (f.status === 'unchanged') return;
        if (f.stats) {
            added += f.stats.added;
            removed += f.stats.removed;
        } else if (!f.binary && !f.tooLarge) {
            counted = false;
        }
    });
    var summary = $('#compare-summary');
    summary.textContent = '';
    var line = el('div', 'compare-counts');
    [['modified', 'M'], ['added', 'A'], ['removed', 'D']].forEach(function(pair) {
        var item = el('span', 'count-' + pair[0]);
        item.appendChild(el('span', 'status-badge status-' + pair[0], pair[1]));
        item.appendChild(document.createTextNode(' ' + counts[pair[0]] + ' ' + pair[0]));
        line.appendChild(item);
    });
    summary.appendChild(line);
    var totals = el('div', 'compare-totals');
    var plus = el('span', 'stat-add', '+' + added);
    var minus = el('span', 'stat-del', '−' + removed);
    totals.append(plus, ' ', minus, ' lines' + (counted ? '' : ' (counting…)'),
        ' · ' + counts.unchanged + ' unchanged');
    summary.appendChild(totals);
    summary.appendChild(reportButtons());
}

function renderFileList() {
    var list = $('#compare-file-list');
    var filter = $('#compare-filter').value.trim().toLowerCase();
    var showUnchanged = $('#show-unchanged').checked;
    list.textContent = '';
    var shown = 0;
    comparison.files.forEach(function(f) {
        if (f.status === 'unchanged' && !showUnchanged) return;
        if (filter && f.path.toLowerCase().indexOf(filter) === -1) return;
        shown++;
        var row = el('li', 'compare-file status-row-' + f.status);
        row.dataset.path = f.path;
        row.tabIndex = 0;
        row.title = f.path + ' (' + f.status + ')';
        row.classList.toggle('is-selected', f.path === currentPath);
        var badge = {modified: 'M', added: 'A', removed: 'D', unchanged: '·'}[f.status];
        row.appendChild(el('span', 'status-badge status-' + f.status, badge));
        var slash = f.path.lastIndexOf('/');
        var name = el('span', 'compare-file-name');
        name.appendChild(el('span', 'compare-file-base', f.path.slice(slash + 1)));
        if (slash !== -1) name.appendChild(el('span', 'compare-file-dir', f.path.slice(0, slash)));
        row.appendChild(name);
        var stats = el('span', 'compare-file-stats');
        if (f.stats) {
            stats.append(el('span', 'stat-add', '+' + f.stats.added), ' ', el('span', 'stat-del', '−' + f.stats.removed));
        } else if (f.binary && f.status !== 'unchanged') {
            stats.textContent = 'binary';
        }
        row.appendChild(stats);
        row.addEventListener('click', function() {
            showFile(f.path);
        });
        row.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') showFile(f.path);
            if (event.key === 'ArrowDown' && row.nextElementSibling) row.nextElementSibling.focus();
            if (event.key === 'ArrowUp' && row.previousElementSibling) row.previousElementSibling.focus();
        });
        list.appendChild(row);
    });
    if (!shown) {
        list.appendChild(el('li', 'compare-file-empty', filter ? 'No files match the filter.' : 'No changed files.'));
    }
}

// ---- Reading files

function readBytes(entry) {
    if (!entry) return Promise.resolve(new Uint8Array(0));
    if (entry._bytes) return entry._bytes;
    entry._bytes = new Promise(function(resolve) {
        entry.getData(new Uint8ArrayWriter(), resolve);
    });
    return entry._bytes;
}
function isBinary(bytes) {
    var length = Math.min(bytes.length, 8000);
    for (var i = 0; i < length; ++i) {
        if (bytes[i] === 0) return true;
    }
    return false;
}
function decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
}

// Counts added/removed lines of changed text files, one file at a time.
function countChangedLines() {
    var token = comparison;
    var queue = comparison.files.filter(function(f) { return f.status !== 'unchanged'; });
    (function next() {
        if (comparison !== token) return; // A new comparison was started.
        var f = queue.shift();
        if (!f) {
            renderSummary();
            return;
        }
        var size = Math.max(f.old ? f.old.uncompressedSize : 0, f.new ? f.new.uncompressedSize : 0);
        if (size > MAX_STATS_SIZE) {
            f.tooLarge = true;
            setTimeout(next, 0);
            return;
        }
        Promise.all([readBytes(f.old), readBytes(f.new)]).then(function(data) {
            if (isBinary(data[0]) || isBinary(data[1])) {
                f.binary = true;
            } else {
                f.stats = ZenEditor.diffStats(f.old ? decode(data[0]) : '', f.new ? decode(data[1]) : '');
                if (!f.old) f.stats.removed = 0;
                if (!f.new) f.stats.added = 0;
            }
            updateRow(f);
            renderSummary();
            setTimeout(next, 0);
        });
    })();
}

function updateRow(f) {
    var row = $('#compare-file-list li[data-path="' + CSS.escape(f.path) + '"]');
    if (!row) return;
    var stats = $('.compare-file-stats', row);
    stats.textContent = '';
    if (f.stats) {
        stats.append(el('span', 'stat-add', '+' + f.stats.added), ' ', el('span', 'stat-del', '−' + f.stats.removed));
    } else if (f.binary) {
        stats.textContent = 'binary';
    }
}

// ---- Showing the differences of one file

function clearDiff(message) {
    if (diffView) diffView.destroy();
    diffView = null;
    objectUrls.forEach(URL.revokeObjectURL);
    objectUrls = [];
    var body = $('#diff-body');
    body.textContent = '';
    if (message) body.appendChild(el('p', 'compare-empty', message));
}

function beautifyText(text, path) {
    var type = beautify.getType(path);
    if (!prefs.beautify || !type || !text) return Promise.resolve(text);
    return new Promise(function(resolve) {
        beautify({text: text, type: type, wrap: 0}, resolve);
    });
}

function showFile(path) {
    var f = comparison.byPath.get(path);
    if (!f) return;
    currentPath = path;
    $('.compare-diff').classList.remove('is-report');
    markReportButtons(null);
    Array.prototype.forEach.call(document.querySelectorAll('#compare-file-list .compare-file'), function(row) {
        row.classList.toggle('is-selected', row.dataset.path === path);
    });
    var pathElem = $('#diff-path');
    pathElem.textContent = '';
    pathElem.appendChild(el('span', 'status-badge status-' + f.status,
        {modified: 'M', added: 'A', removed: 'D', unchanged: '·'}[f.status]));
    pathElem.appendChild(document.createTextNode(' ' + path));
    $('#toggle-beautify').disabled = !beautify.getType(path);
    clearDiff('Loading…');

    Promise.all([readBytes(f.old), readBytes(f.new)]).then(function(data) {
        if (currentPath !== path) return;
        if (IMAGE_EXTENSIONS.test(path)) {
            showImages(f, data);
            return;
        }
        if (isBinary(data[0]) || isBinary(data[1])) {
            clearDiff();
            var body = $('#diff-body');
            body.appendChild(el('p', 'compare-empty', 'Binary file' +
                (f.status === 'unchanged' ? ' (unchanged)' : '') + '. Size: ' +
                (f.old ? formatSize(f.old.uncompressedSize) : '—') + ' → ' +
                (f.new ? formatSize(f.new.uncompressedSize) : '—') + '.'));
            return;
        }
        Promise.all([
            beautifyText(f.old ? decode(data[0]) : '', path),
            beautifyText(f.new ? decode(data[1]) : '', path),
        ]).then(function(texts) {
            if (currentPath !== path) return;
            clearDiff();
            diffView = ZenEditor.createDiffView({
                parent: $('#diff-body'),
                original: texts[0],
                modified: texts[1],
                filename: path,
                mode: prefs.mode,
                wrap: prefs.wrap,
            });
        });
    });
}

function showImages(f, data) {
    clearDiff();
    var body = $('#diff-body');
    var row = el('div', 'compare-images');
    [['Old', f.old, data[0]], ['New', f.new, data[1]]].forEach(function(item) {
        var figure = el('figure', 'compare-image');
        if (item[1]) {
            var type = /\.svg$/i.test(f.path) ? 'image/svg+xml' : '';
            var url = URL.createObjectURL(new Blob([item[2]], {type: type}));
            objectUrls.push(url);
            var img = el('img');
            img.src = url;
            img.alt = item[0] + ' version of ' + f.path;
            figure.appendChild(img);
        } else {
            figure.appendChild(el('div', 'compare-image-missing', 'Not in this version'));
        }
        figure.appendChild(el('figcaption', '', item[0] + (item[1] ? ' · ' + formatSize(item[1].uncompressedSize) : '')));
        row.appendChild(figure);
    });
    body.appendChild(row);
}

// ---- Reports: permission changes and translations that were not updated

function readText(entry) {
    return entry ? readBytes(entry).then(decode) : Promise.resolve(null);
}

function parseJsonLoose(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        return JSON.parse(stripJsonComments(text, {trailingCommas: true}));
    }
}

// The path of the add-on's manifest.json in a version (the least nested one).
function manifestPath(files) {
    return Array.from(files.keys()).filter(function(path) {
        return /(^|\/)manifest\.json$/i.test(path);
    }).sort(function(a, b) { return a.split('/').length - b.split('/').length; })[0] || null;
}

// {lowercase key: {key, message}} of a messages.json text, or null.
function messagesOf(text) {
    if (text === null) return null;
    var map = Object.create(null);
    var json = parseJsonLoose(text);
    Object.keys(json || {}).forEach(function(key) {
        var value = json[key];
        if (key.indexOf('@@') === 0 || !value || typeof value.message !== 'string') return;
        map[key.toLowerCase()] = {key: key, message: value.message};
    });
    return map;
}

function computeReports(forComparison) {
    forComparison.reports = null;
    var oldFiles = sources.old.files;
    var newFiles = sources.new.files;
    var oldManifestPath = manifestPath(oldFiles);
    var newManifestPath = manifestPath(newFiles);
    var reports = {permissions: null, translations: null};
    var permissionsPromise = Promise.all([
        readText(oldManifestPath && oldFiles.get(oldManifestPath)),
        readText(newManifestPath && newFiles.get(newManifestPath)),
    ]).then(function(texts) {
        var oldInfo = ZenReview.analyzeManifest(texts[0] ? parseJsonLoose(texts[0]) : {});
        var newInfo = ZenReview.analyzeManifest(texts[1] ? parseJsonLoose(texts[1]) : {});
        reports.permissions = {
            old: oldInfo,
            new: newInfo,
            diff: ZenReview.diffManifests(oldInfo, newInfo),
            defaultLocale: (texts[1] && parseJsonLoose(texts[1]).default_locale) ||
                (texts[0] && parseJsonLoose(texts[0]).default_locale) || '',
        };
    }).catch(function(error) {
        reports.permissions = {error: 'manifest.json could not be read: ' + (error && error.message || error)};
    });
    permissionsPromise.then(function() {
        return computeTranslations(oldFiles, newFiles, newManifestPath || oldManifestPath,
            reports.permissions && reports.permissions.defaultLocale);
    }).then(function(translations) {
        reports.translations = translations;
    }, function(error) {
        reports.translations = {error: 'The messages.json files could not be read: ' + (error && error.message || error)};
    }).then(function() {
        if (comparison !== forComparison) return;
        forComparison.reports = reports;
        updateReportButtons();
    });
}

function computeTranslations(oldFiles, newFiles, manifestFile, defaultLocale) {
    var prefix = manifestFile ? manifestFile.slice(0, manifestFile.lastIndexOf('/') + 1) : '';
    var re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_locales/([^/]+)/messages\\.json$', 'i');
    function locales(files) {
        var map = new Map();
        files.forEach(function(entry, path) {
            var match = re.exec(path);
            if (match) map.set(match[1].replace(/-/g, '_').toLowerCase(), {name: match[1], path: path, entry: entry});
        });
        return map;
    }
    var oldLocales = locales(oldFiles);
    var newLocales = locales(newFiles);
    if (!newLocales.size && !oldLocales.size) return Promise.resolve({none: true});
    var referenceKey = (defaultLocale || '').replace(/-/g, '_').toLowerCase();
    if (!newLocales.has(referenceKey)) referenceKey = newLocales.has('en') ? 'en' : Array.from(newLocales.keys())[0];
    var keys = Array.from(new Set(Array.from(oldLocales.keys()).concat(Array.from(newLocales.keys()))));
    var texts = {};
    return keys.reduce(function(promise, key) {
        return promise.then(function() {
            return Promise.all([
                readText(oldLocales.has(key) ? oldLocales.get(key).entry : null),
                readText(newLocales.has(key) ? newLocales.get(key).entry : null),
            ]).then(function(pair) {
                texts[key] = {old: messagesOf(pair[0]), new: messagesOf(pair[1])};
            });
        });
    }, Promise.resolve()).then(function() {
        var reference = texts[referenceKey] || {old: null, new: null};
        var refOld = reference.old || Object.create(null);
        var refNew = reference.new || Object.create(null);
        var changedKeys = Object.keys(refNew).filter(function(k) {
            return refOld[k] && refOld[k].message !== refNew[k].message;
        });
        var addedKeys = Object.keys(refNew).filter(function(k) { return !refOld[k]; });
        var removedKeys = Object.keys(refOld).filter(function(k) { return !refNew[k]; });
        var result = {
            referenceName: newLocales.has(referenceKey) ? newLocales.get(referenceKey).name : referenceKey,
            changedCount: changedKeys.length,
            addedCount: addedKeys.length,
            removedCount: removedKeys.length,
            locales: [],
            addedLocales: [],
            removedLocales: [],
        };
        keys.forEach(function(key) {
            if (key === referenceKey) return;
            var pair = texts[key];
            if (!pair.new) {
                result.removedLocales.push(oldLocales.get(key).name);
                return;
            }
            if (!pair.old) result.addedLocales.push(newLocales.get(key).name);
            var oldLocale = pair.old || Object.create(null);
            var newLocale = pair.new;
            // Outdated: the reference text changed, the translation did not.
            var outdated = changedKeys.filter(function(k) {
                return newLocale[k] && oldLocale[k] && oldLocale[k].message === newLocale[k].message;
            }).map(function(k) {
                return {key: refNew[k].key, oldReference: refOld[k].message, newReference: refNew[k].message,
                    translation: newLocale[k].message};
            });
            var updated = changedKeys.filter(function(k) {
                return newLocale[k] && (!oldLocale[k] || oldLocale[k].message !== newLocale[k].message);
            }).length;
            var missingNew = addedKeys.filter(function(k) { return !newLocale[k]; }).map(function(k) {
                return {key: refNew[k].key, newReference: refNew[k].message};
            });
            result.locales.push({
                name: newLocales.get(key).name,
                outdated: outdated,
                missingNew: missingNew,
                updated: updated,
                isNew: !pair.old,
            });
        });
        result.locales.sort(function(a, b) {
            return (b.outdated.length + b.missingNew.length) - (a.outdated.length + a.missingNew.length) ||
                a.name.localeCompare(b.name);
        });
        result.outdatedTotal = result.locales.reduce(function(n, l) { return n + l.outdated.length; }, 0);
        result.missingTotal = result.locales.reduce(function(n, l) { return n + l.missingNew.length; }, 0);
        return result;
    });
}

function reportButtons() {
    var box = el('div', 'compare-reports');
    [['permissions', 'Permissions', 'What the new version may do differently'],
        ['translations', 'Translations', 'Translations that were not updated for changed or new messages']].forEach(function(item) {
        var button = el('button', 'compare-report-button');
        button.type = 'button';
        button.dataset.report = item[0];
        button.title = item[2];
        button.append(item[1] + ' ', el('span', 'compare-report-badge', '…'));
        button.onclick = function() { showReport(item[0]); };
        box.appendChild(button);
    });
    setTimeout(updateReportButtons, 0);
    return box;
}

function updateReportButtons() {
    var reports = comparison && comparison.reports;
    Array.prototype.forEach.call(document.querySelectorAll('.compare-report-button'), function(button) {
        var badge = $('.compare-report-badge', button);
        badge.className = 'compare-report-badge';
        if (!reports) {
            badge.textContent = '…';
            return;
        }
        var report = reports[button.dataset.report];
        if (!report || report.error) {
            badge.textContent = '!';
            return;
        }
        if (button.dataset.report === 'permissions') {
            var d = report.diff;
            var added = d.permissions.added.length + d.hosts.added.length + d.contentScripts.added.length;
            var removed = d.permissions.removed.length + d.hosts.removed.length + d.contentScripts.removed.length;
            badge.textContent = added || removed || d.cspChanged ? '+' + added + ' −' + removed : 'no change';
            if (added || d.cspChanged) badge.classList.add('is-warning');
        } else if (report.none) {
            badge.textContent = 'none';
        } else {
            badge.textContent = report.outdatedTotal + ' outdated';
            if (report.outdatedTotal || report.missingTotal) badge.classList.add('is-warning');
        }
    });
    if (currentReport) showReport(currentReport);
}

var currentReport = null;
function markReportButtons(kind) {
    currentReport = kind;
    Array.prototype.forEach.call(document.querySelectorAll('.compare-report-button'), function(button) {
        button.classList.toggle('is-selected', button.dataset.report === kind);
    });
}

function showReport(kind) {
    currentPath = null;
    Array.prototype.forEach.call(document.querySelectorAll('#compare-file-list .compare-file'), function(row) {
        row.classList.remove('is-selected');
    });
    markReportButtons(kind);
    $('.compare-diff').classList.add('is-report');
    $('#diff-path').textContent = kind === 'permissions' ? 'Permission changes' : 'Translations';
    clearDiff();
    var body = $('#diff-body');
    var reports = comparison.reports;
    if (!reports) {
        body.appendChild(el('p', 'compare-empty', 'Reading the two versions…'));
        return;
    }
    var box = el('div', 'rv-report compare-report');
    body.appendChild(box);
    if (kind === 'permissions') renderPermissionReport(box, reports.permissions);
    else renderTranslationReport(box, reports.translations);
}

function levelBadge(level) {
    return el('span', 'rv-level is-' + level, {high: 'High', medium: 'Medium', low: 'Low'}[level] || level);
}

function renderPermissionReport(box, report) {
    if (report.error) {
        box.appendChild(el('p', 'rv-empty', report.error));
        return;
    }
    var d = report.diff;
    var oldName = describeSource(sources.old);
    var newName = describeSource(sources.new);
    box.appendChild(el('h3', 'rv-section-title', 'Permissions: ' + oldName + ' → ' + newName));
    var changed = false;
    function list(title, items, kind, explain) {
        if (!items.length) return;
        changed = true;
        var section = el('div', 'rv-subsection');
        section.appendChild(el('h4', 'rv-change is-' + kind, (kind === 'added' ? '+ ' : '− ') + title +
            ' (' + items.length + ')'));
        var table = el('table', 'rv-table');
        items.forEach(function(item) {
            var tr = el('tr', 'is-' + kind);
            var info = explain ? explain(item) : null;
            var levelCell = el('td');
            if (info) levelCell.appendChild(levelBadge(info.level));
            var nameCell = el('td');
            nameCell.appendChild(el('code', '', item));
            tr.append(levelCell, nameCell, el('td', '', info ? info.description : ''));
            table.appendChild(tr);
        });
        section.appendChild(table);
        box.appendChild(section);
    }
    function hostInfo(pattern) {
        var all = /<all_urls>|^[^:]+:\/\/\*\//.test(pattern);
        return {level: all ? 'high' : 'medium', description: all ? 'All websites' : 'These sites'};
    }
    list('Permissions added', d.permissions.added, 'added', ZenReview.permissionInfo);
    list('Site access added', d.hosts.added, 'added', hostInfo);
    list('Content scripts now run on', d.contentScripts.added, 'added', hostInfo);
    list('Permissions removed', d.permissions.removed, 'removed', ZenReview.permissionInfo);
    list('Site access removed', d.hosts.removed, 'removed', hostInfo);
    list('Content scripts no longer run on', d.contentScripts.removed, 'removed', hostInfo);
    list('Web-accessible resources added', d.webAccessible.added, 'added');
    list('Web-accessible resources removed', d.webAccessible.removed, 'removed');
    if (d.cspChanged) {
        changed = true;
        var csp = el('div', 'rv-subsection');
        csp.appendChild(el('h4', 'rv-change is-added', 'Content security policy changed'));
        csp.appendChild(el('p', 'rv-code-line is-removed', '− ' + (d.oldCsp || 'default')));
        csp.appendChild(el('p', 'rv-code-line is-added', '+ ' + (d.newCsp || 'default')));
        report.new.cspIssues.forEach(function(issue) { csp.appendChild(el('p', 'rv-warning', '⚠ ' + issue)); });
        box.appendChild(csp);
    }
    if (!changed) {
        box.appendChild(el('p', 'rv-ok', 'No permission changes: both versions ask for the same permissions and sites.'));
    }
    var all = el('details', 'rv-details');
    all.appendChild(el('summary', '', 'All permissions of ' + newName + ' (' +
        (report.new.permissions.length + report.new.hosts.length) + ')'));
    var table = el('table', 'rv-table');
    report.new.permissions.forEach(function(p) {
        var tr = el('tr');
        var level = el('td');
        level.appendChild(levelBadge(p.level));
        var name = el('td');
        name.appendChild(el('code', '', p.name));
        tr.append(level, name, el('td', '', p.description + (p.optional ? ' (optional)' : '')));
        table.appendChild(tr);
    });
    report.new.hosts.forEach(function(h) {
        var tr = el('tr');
        var level = el('td');
        level.appendChild(levelBadge(h.breadth === 'all' ? 'high' : 'medium'));
        var name = el('td');
        name.appendChild(el('code', '', h.pattern));
        tr.append(level, name, el('td', '', (h.contentScript ? 'Content script' : 'Site access') +
            (h.optional ? ' (optional)' : '')));
        table.appendChild(tr);
    });
    all.appendChild(table);
    box.appendChild(all);
}

function renderTranslationReport(box, report) {
    if (report.error) {
        box.appendChild(el('p', 'rv-empty', report.error));
        return;
    }
    if (report.none) {
        box.appendChild(el('p', 'rv-empty', 'Neither version has _locales/*/messages.json files.'));
        return;
    }
    var ref = report.referenceName;
    box.appendChild(el('h3', 'rv-section-title', 'Translations: ' + describeSource(sources.old) + ' → ' +
        describeSource(sources.new)));
    box.appendChild(el('p', 'rv-note', 'Between the versions, ' + ref + ' changed ' + report.changedCount +
        ' message' + (report.changedCount === 1 ? '' : 's') + ', added ' + report.addedCount + ' and removed ' +
        report.removedCount + '. A translation is outdated when the ' + ref +
        ' text changed but the translation stayed the same.'));
    if (report.addedLocales.length) box.appendChild(el('p', 'rv-note', 'New locales: ' + report.addedLocales.join(', ')));
    if (report.removedLocales.length) box.appendChild(el('p', 'rv-note', 'Removed locales: ' + report.removedLocales.join(', ')));
    if (!report.outdatedTotal && !report.missingTotal) {
        box.appendChild(el('p', 'rv-ok', 'Every locale was updated for the changed and new ' + ref + ' messages.'));
    }
    report.locales.forEach(function(locale) {
        var problems = locale.outdated.length + locale.missingNew.length;
        var details = el('details', 'rv-details');
        details.open = problems > 0 && report.locales.indexOf(locale) < 3;
        var summary = el('summary');
        summary.append(el('strong', '', locale.name), ' ');
        if (locale.outdated.length) summary.append(el('span', 'rv-tag is-outdated', '⚠ ' + locale.outdated.length + ' outdated'), ' ');
        if (locale.missingNew.length) summary.append(el('span', 'rv-tag is-missing', '✕ ' + locale.missingNew.length + ' new keys missing'), ' ');
        summary.append(el('span', 'rv-muted', locale.updated + ' updated' + (locale.isNew ? ' · new locale' : '')));
        details.appendChild(summary);
        if (locale.outdated.length) {
            var table = el('table', 'rv-table rv-translations');
            var head = el('tr');
            ['Key', ref + ' before', ref + ' now', locale.name + ' (unchanged)'].forEach(function(title) {
                head.appendChild(el('th', '', title));
            });
            table.appendChild(head);
            locale.outdated.forEach(function(item) {
                var tr = el('tr');
                var key = el('td');
                key.appendChild(el('code', '', item.key));
                tr.append(key, el('td', 'is-removed', item.oldReference), el('td', 'is-added', item.newReference),
                    el('td', 'is-outdated', item.translation));
                table.appendChild(tr);
            });
            details.appendChild(table);
        }
        if (locale.missingNew.length) {
            var missing = el('table', 'rv-table rv-translations');
            locale.missingNew.forEach(function(item) {
                var tr = el('tr');
                var key = el('td');
                key.appendChild(el('code', '', item.key));
                tr.append(key, el('td', 'is-added', item.newReference), el('td', 'is-missing', '✕ missing in ' + locale.name));
                missing.appendChild(tr);
            });
            details.appendChild(missing);
        }
        box.appendChild(details);
    });
}

// ---- Patch

// Downloads all differences as a Git-style patch (old -> new), like
// `git diff --binary`: binary files are included with their data.
// The patch always uses the original files (not the beautified view), so that
// it can be applied to the old version.
function downloadComparisonPatch() {
    var button = $('#download-patch');
    var changed = comparison.files.filter(function(f) { return f.status !== 'unchanged'; });
    button.disabled = true;
    button.textContent = 'Creating patch\u2026';
    Promise.all(changed.map(function(f) {
        return Promise.all([readBytes(f.old), readBytes(f.new)]).then(function(data) {
            if (isBinary(data[0]) || isBinary(data[1])) {
                // Included as a Git binary patch (like `git diff --binary`).
                return {
                    path: f.path,
                    binary: true,
                    oldBytes: f.old ? data[0] : null,
                    newBytes: f.new ? data[1] : null,
                };
            }
            return {
                path: f.path,
                oldText: f.old ? decode(data[0]) : null,
                newText: f.new ? decode(data[1]) : null,
            };
        });
    })).then(function(files) {
        return ZenPatch.createGitPatchAsync(files, function(done, total) {
            button.textContent = 'Creating patch\u2026 ' + done + '/' + total;
        });
    }).then(function(patch) {
        var name = (sources.old.name + '-to-' + sources.new.name).replace(/[^\w.@-]+/g, '_') + '.patch';
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([patch], {type: 'text/x-diff'}));
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
    }).catch(function(error) {
        alert('Could not create the patch: ' + (error && error.message || error));
    }).then(function() {
        button.disabled = false;
        button.textContent = 'Download patch';
    });
}

// ---- Toolbar and page set-up

function applyToolbarState() {
    Array.prototype.forEach.call(document.querySelectorAll('.compare-diff .diff-switch button'), function(button) {
        button.classList.toggle('is-active', button.dataset.mode === prefs.mode);
    });
    $('#toggle-wrap').classList.toggle('is-active', prefs.wrap);
    $('#toggle-beautify').classList.toggle('is-active', prefs.beautify);
}

function setUpToolbar() {
    Array.prototype.forEach.call(document.querySelectorAll('.compare-diff .diff-switch button'), function(button) {
        button.addEventListener('click', function() {
            prefs.mode = button.dataset.mode;
            applyToolbarState();
            if (diffView) diffView.setMode(prefs.mode);
        });
    });
    $('#toggle-wrap').addEventListener('click', function() {
        prefs.wrap = !prefs.wrap;
        applyToolbarState();
        if (diffView) diffView.setWrap(prefs.wrap);
    });
    $('#toggle-beautify').addEventListener('click', function() {
        prefs.beautify = !prefs.beautify;
        applyToolbarState();
        if (currentPath) showFile(currentPath);
    });
    $('.compare-diff .change-prev').addEventListener('click', function() {
        if (diffView) diffView.goToChange(-1);
    });
    $('.compare-diff .change-next').addEventListener('click', function() {
        if (diffView) diffView.goToChange(1);
    });
    $('#compare-filter').addEventListener('input', renderFileList);
    $('#show-unchanged').addEventListener('change', renderFileList);
    applyToolbarState();
}

function setUpHeader() {
    $('#compare-button').addEventListener('click', runComparison);
    $('#download-patch').addEventListener('click', downloadComparisonPatch);
    $('#edit-sources').addEventListener('click', function() {
        $('#compare-results').hidden = true;
        $('#compare-setup').hidden = false;
        $('#edit-sources').hidden = true;
        $('#download-patch').hidden = true;
    });
    $('#swap-sources').addEventListener('click', function() {
        var oldSource = sources.old;
        sources.old = sources.new;
        sources.new = oldSource;
        ['old', 'new'].forEach(function(side) {
            var source = sources[side];
            card(side).classList.toggle('is-loaded', !!source);
            $('input[name=url]', card(side)).value = source && source.url || '';
            setStatus(side, source ? '✓ ' + describeSource(source) + ' — ' + source.files.size + ' files' : '', source ? 'ok' : '');
        });
        updateUrl();
        if (!$('#compare-results').hidden && sources.old && sources.new) runComparison();
    });
}

function init() {
    setUpSourceCard('old');
    setUpSourceCard('new');
    setUpAmoVersions();
    setUpToolbar();
    setUpHeader();
    // compare.html?old=URL&new=URL opens (and compares) those versions.
    var oldUrl = getParam('old');
    var newUrl = getParam('new');
    if (oldUrl) loadSource('old', {url: oldUrl, autoCompare: !!newUrl});
    if (newUrl) loadSource('new', {url: newUrl, autoCompare: !!oldUrl});
    if (oldUrl && !newUrl) $('input[name=url]', card('new')).focus();
}

init();
