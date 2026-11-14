/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and support for Chrome/Edge/Opera CRX extensions; renamed from crxviewer.js);
 * the file list is shown as a collapsible folder tree; code is shown in a
 * CodeMirror 6 editor with editing, and edited files can be downloaded as a zip;
 * a Changes panel lists edited files with diffs (unified or split) and revert;
 * zip.js, js-beautify and strip-json-comments are bundled from npm; a Compare button
 * opens compare.html to compare two versions; changes can be downloaded as a
 * patch and patches can be applied (lib/jsdiff.js); WebExtension APIs in source
 * can be detected and summarized from a bundled local catalog; locale message
 * files can be compared for key coverage and missing translations. */

/* jshint browser:true, devel:true */
/* globals chrome, URL,
           getParam, encodeQueryString, openAddonAsZip, get_zip_name, get_listing_url, is_listing_url,
           get_addon_download_url, is_addon_download_url,
           get_amo_domain, get_amo_slug, getXpis,
           zip,
           EfficientTextWriter,
           beautify,
           ZenEditor,
           Uint8ArrayWriter, ModernCrypto,
           parseCertificate, parseMozCOSE,
           stripJsonComments, ZenPatch, WEBEXTENSION_API_CATALOG
           */

'use strict';

// addon_url is globally set to the URL of the shown file for ease of debugging.
// If there is no URL (e.g. with  <input type=file>), then addon_url is the file name.


function formatByteSize(fileSize) {
    // Assume parameter fileSize to be a number
    fileSize = (fileSize+'').replace(/\d(?=(\d{3})+(?!\d))/g, '$&,');
    return fileSize;
}
function formatByteSizeSuffix(fileSize) {
    if (fileSize < 1e4)
        return fileSize + ' B';
    if (fileSize < 1e6)
        return Math.round(fileSize/1e3) + ' KB';
    if (fileSize < 1e9)
        return Math.round(fileSize/1e6) + ' MB';
    // Which fool stores over 1 GB of data in an extension???
    return Math.round(fileSize/1e9) + ' GB';
}
// options.keepState: rebuild the tree (e.g. after a patch added files) without
// resetting edits, collapsed folders or the shown file.
function handleZipEntries(entries, options) {
    invalidateApiReport();
    invalidateLocaleCoverage();
    document.getElementById('api-report-toggle').hidden = false;
    document.getElementById('locale-report-toggle').hidden = false;
    // Review tools (review-report.js, review-notes.js).
    document.getElementById('review-toggle').hidden = false;
    document.getElementById('notes-toggle').hidden = false;
    document.getElementById('file-tree-actions').hidden = false;
    ZenReview.invalidate();
    var keepState = !!(options && options.keepState);
    var selectedFilename = keepState && document.querySelector('#file-list li.file-selected');
    selectedFilename = selectedFilename && selectedFilename.dataset.filename;
    var output = document.createDocumentFragment();
    // Files are shown as a folder tree, like a file explorer.
    var treeRoot = {folders: {}, files: []};
    var fileCount = 0;

    var listItemBase = document.createElement('li');
    var genericTypeCounts = {};
    listItemBase.innerHTML =
'<span class="file-path">' +
    '<span class="file-dir"></span>' +
    '<span class="file-name"></span>' +
'</span>' +
'<span class="file-size"></span>';
    entries.forEach(function(entry) {
        if (entry.directory) {
            // Folders created in the viewer (file-ops.js) are shown even when empty.
            if (entry._isUserFolder) {
                var folderNode = treeRoot;
                entry.filename.replace(/\/$/, '').split('/').forEach(function(folderName) {
                    folderNode = folderNode.folders[folderName] ||
                        (folderNode.folders[folderName] = {folders: {}, files: []});
                });
            }
            return;
        }

        var filename = entry.filename;
        var listItem = listItemBase.cloneNode(true);
        listItem.zipEntry = entry;

        // "path/to/file" -> ["path/to/", "file"]
        var filenameIndex = filename.lastIndexOf('/');
        filenameIndex = filenameIndex === -1 ? 0 : filenameIndex + 1;
        listItem.querySelector('.file-path').title = filename;
        listItem.querySelector('.file-name').textContent = filename.slice(filenameIndex);
        listItem.querySelector('.file-dir').textContent = filename.slice(0, filenameIndex);
        var fileSize = entry.uncompressedSize;
        var fileSizeElem = listItem.querySelector('.file-size');
        fileSizeElem.title = formatByteSize(fileSize) + ' bytes';
        fileSizeElem.textContent = formatByteSizeSuffix(fileSize);

        listItem.addEventListener('click', function(e) {
            var tmp = document.querySelector('.file-selected');
            if (tmp) tmp.classList.remove('file-selected');
            listItem.classList.add('file-selected');
            viewFileInfo(entry);
            if (editedFiles.size) scheduleChangesPanelRender();
        });

        listItem.dataset.filename = filename;

        var genericType = getGenericType(filename);
        if (genericType) {
            listItem.classList.add('gtype-' + genericType);
            genericTypeCounts[genericType] = genericTypeCounts[genericType] + 1 || 1;
        }

        var folderNames = filename.split('/');
        folderNames.pop();
        var node = treeRoot;
        folderNames.forEach(function(folderName) {
            node = node.folders[folderName] ||
                (node.folders[folderName] = {folders: {}, files: []});
        });
        node.files.push({name: filename.slice(filenameIndex), listItem: listItem});
        ++fileCount;
    });
    if (!keepState) {
        document.getElementById('apply-patch').hidden = false;
        editedFiles.clear();
        document.getElementById('download-edited-zip').hidden = true;
        scheduleChangesPanelRender();
        // Small archives start fully expanded; larger ones start collapsed.
        fileTreeCollapsedFolders = new Set();
    }
    var collapseByDefault = !keepState && fileCount > 40;
    function appendTree(node, depth, pathPrefix) {
        // manifest.json first, then folders, then the other files.
        var files = node.files.sort(function(x, y) {
            var xIsManifest = depth === 0 && x.name.toLowerCase() === 'manifest.json';
            var yIsManifest = depth === 0 && y.name.toLowerCase() === 'manifest.json';
            if (xIsManifest !== yIsManifest) return xIsManifest ? -1 : 1;
            return x.name.localeCompare(y.name);
        });
        var manifest = depth === 0 && files.length &&
            files[0].name.toLowerCase() === 'manifest.json' ? files.shift() : null;
        if (manifest) appendFile(manifest, depth);
        var fileTotal = files.length + (manifest ? 1 : 0);
        Object.keys(node.folders).sort(function(x, y) {
            return x.localeCompare(y);
        }).forEach(function(folderName) {
            var folderPath = pathPrefix + folderName + '/';
            var folderRow = createFolderRow(folderName, folderPath, depth);
            output.appendChild(folderRow);
            if (collapseByDefault) fileTreeCollapsedFolders.add(folderPath);
            var count = appendTree(node.folders[folderName], depth + 1, folderPath);
            folderRow.querySelector('.folder-count').textContent = count;
            fileTotal += count;
        });
        files.forEach(function(file) {
            appendFile(file, depth);
        });
        return fileTotal;
    }
    function appendFile(file, depth) {
        file.listItem.style.setProperty('--depth', depth);
        output.appendChild(file.listItem);
    }
    function createFolderRow(folderName, folderPath, depth) {
        var folderRow = document.createElement('li');
        folderRow.className = 'folder-row';
        folderRow.dataset.folder = folderPath;
        folderRow.style.setProperty('--depth', depth);
        folderRow.title = folderPath;
        folderRow.innerHTML =
            '<span class="tree-chevron"></span>' +
            '<span class="folder-name"></span>' +
            '<span class="folder-count"></span>';
        folderRow.querySelector('.folder-name').textContent = folderName;
        folderRow.addEventListener('click', function() {
            if (fileTreeCollapsedFolders.has(folderPath)) {
                fileTreeCollapsedFolders.delete(folderPath);
            } else {
                fileTreeCollapsedFolders.add(folderPath);
            }
            updateFileTree();
        });
        return folderRow;
    }
    appendTree(treeRoot, 0, '');
    treeRoot = null;
    var fileList = document.getElementById('file-list');
    fileList.textContent = '';
    fileList.appendChild(output);

    checkAndApplyFilter();

    // Render number of files of the following generic types:
    Object.keys(genericTypeCounts).forEach(function(genericType) {
        var checkbox = document.querySelector('input[data-filter-type="' + genericType + '"]');
        var label = checkbox.parentNode;
        var counter = label.querySelector('.gcount');
        counter.textContent = genericTypeCounts[genericType];
    });

    if (keepState) {
        editedFiles.forEach(function(change, filename) {
            markFileListItem(filename, change);
        });
        var selectedItem = selectedFilename && getFileListItem(selectedFilename);
        if (selectedItem) selectedItem.classList.add('file-selected');
        scheduleChangesPanelRender();
        return;
    }
    renderInitialViewFromUrlParams();
}
// Folder paths (ending with "/") that the user collapsed in the file tree.
var fileTreeCollapsedFolders = new Set();

// Hides rows inside collapsed folders and folders without any visible file.
// Called whenever the file filters change (via renderTotalFileSize).
function updateFileTree() {
    var fileList = document.getElementById('file-list');
    var rows = fileList.children;
    // While a filter is typed, show every match regardless of collapsed folders.
    var isFiltering = document.getElementById('file-filter').value !== '';
    fileList.classList.toggle('tree-filtering', isFiltering);

    var foldersWithVisibleFiles = new Set();
    var i, row, path, j;
    for (i = 0; i < rows.length; ++i) {
        row = rows[i];
        path = row.dataset.filename;
        if (path === undefined) continue;
        var isVisible = !row.classList.contains('file-filtered') &&
            !row.classList.contains('grep-no-match') &&
            !row.gtypefiltered;
        if (!isVisible) continue;
        for (j = path.indexOf('/'); j !== -1; j = path.indexOf('/', j + 1)) {
            foldersWithVisibleFiles.add(path.slice(0, j + 1));
        }
    }
    // Folders created in the viewer stay visible while they are empty.
    if (!isFiltering) {
        addedEntries.forEach(function(entry) {
            if (!entry._isUserFolder) return;
            for (j = entry.filename.indexOf('/'); j !== -1; j = entry.filename.indexOf('/', j + 1)) {
                foldersWithVisibleFiles.add(entry.filename.slice(0, j + 1));
            }
        });
    }

    for (i = 0; i < rows.length; ++i) {
        row = rows[i];
        var folderPath = row.dataset.folder;
        path = folderPath === undefined ? row.dataset.filename : folderPath;
        if (path === undefined) continue;
        var isHidden = folderPath !== undefined && !foldersWithVisibleFiles.has(folderPath);
        if (!isFiltering) {
            // Check the ancestor folders (excluding the folder itself).
            var end = folderPath === undefined ? path.length : path.length - 1;
            for (j = path.indexOf('/'); !isHidden && j !== -1 && j < end; j = path.indexOf('/', j + 1)) {
                isHidden = fileTreeCollapsedFolders.has(path.slice(0, j + 1));
            }
        }
        row.classList.toggle('tree-hidden', isHidden);
        if (folderPath !== undefined) {
            row.classList.toggle('folder-collapsed', fileTreeCollapsedFolders.has(folderPath));
        }
    }
}

// Expands all folders that contain |filename|.
function revealInFileTree(filename) {
    for (var j = filename.indexOf('/'); j !== -1; j = filename.indexOf('/', j + 1)) {
        fileTreeCollapsedFolders.delete(filename.slice(0, j + 1));
    }
    updateFileTree();
}

function getGenericType(filename) {
    // Chromium / generic / WebExtensions
    if (filename === 'manifest.json') {
        // No generic type = Don't offer any checkbox to hide it.
        return '';
    }
    var extension = filename.split('.').pop().toLowerCase();
    if (/^(jsx?|tsx?|wat|coffee)$/.test(extension)) {
        return 'code';
    }
    if (/^(bmp|cur|gif|ico|jpe?g|png|psd|svg|tiff?|xcf|webp)$/.test(extension)) {
        return 'images';
    }
    if (/^(css|sass|less|html?|xhtml|xml)$/.test(extension)) {
        return 'markup';
    }
    if (filename.lastIndexOf('_locales/', 0) === 0) {
        return 'locales';
    }

    // Firefox add-on specific.
    // Note: package.json is not just used for Jetpack but also npm and such.
    if (filename === 'chrome.manifest' || filename === 'install.rdf' || filename === 'package.json') {
        return '';
    }
    if (/^jsm$/.test(extension)) {
        return 'code';
    }
    if (/^(xbl|xul)$/.test(extension)) {
        return 'markup';
    }
    if (/locale\/.*\.(dtd|properties)$/i.test(filename)) {
        return 'locales';
    }

    return 'misc';
}

function getMimeTypeForFilename(filename) {
    if (/^META-INF\/.*\.[ms]f$/.test(filename)) {
        // .sf and .mf are part of the signature in Firefox addons.
        // They are viewable as plain text.
        return 'text/plain';
    }
    if (/(^|\/)(AUTHORS|CHANGELOG|COPYING|INSTALL|LICENSE|NEWS|README|THANKS)$/i.test(filename)) {
        return 'text/plain';
    }
    var extension = filename.split('.').pop().toLowerCase();
    switch (extension) {
    case 'xpi':
        // Just map them to zip files because we treat it as a zip file, internally.
        return 'application/zip';
    case 'md':
        return 'text/plain';
    case 'cjs':
    case 'jsm':
    case 'mjs':
        return 'application/javascript';
    }
    return zip.getMimeType(filename);
}

// Preferences of the code editor, shared by all files.
var editorPrefs = {
    editable: false,
    wrap: true,
    // How edited files are shown: 'off' (code), 'unified' or 'split' (diff).
    diffMode: 'unified',
};

// Changed files: filename -> change. A change is either an editor (see
// ZenEditor.create) for files edited by hand, or a change made by applying a
// patch (see createPatchChange). All have getText() (null for a removed file),
// getOriginalText() (null for an added file), diffStats(), revert() and kind
// ('modified', 'added' or 'removed'; editors are 'modified').
var editedFiles = new Map();

// The entries of the opened archive, and files added by patches (path -> entry).
var archiveEntries = [];
var addedEntries = new Map();
var apiReportGeneration = 0;
var apiReportResults = null;
var apiReportBusy = false;
var apiReportInitialized = false;
var localeCoverageGeneration = 0;
var localeCoverageResults = null;
var localeCoverageBusy = false;
var localeCoverageInitialized = false;

function invalidateApiReport() {
    apiReportGeneration++;
    apiReportResults = null;
    apiReportBusy = false;
    var toggle = document.getElementById('api-report-toggle');
    var panel = document.getElementById('api-panel');
    if (toggle) {
        toggle.textContent = 'APIs';
        toggle.title = 'Detect WebExtension APIs and show local summaries';
    }
    if (panel && !panel.hidden) {
        document.getElementById('api-list').textContent = '';
        document.querySelector('#api-panel .api-panel-count').textContent = '';
        document.getElementById('api-panel-status').textContent =
            'Source changed. Select Rescan to refresh the detected APIs.';
    }
}

function initializeApiReportPanel() {
    if (apiReportInitialized) return;
    apiReportInitialized = true;
    var toggle = document.getElementById('api-report-toggle');
    var panel = document.getElementById('api-panel');
    var status = document.getElementById('api-panel-status');
    toggle.onclick = function() {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden && !apiReportResults && !apiReportBusy) {
            scanWebExtensionApis();
        }
    };
    document.getElementById('api-panel-close').onclick = function() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    };
    document.getElementById('api-rescan').onclick = scanWebExtensionApis;
    status.textContent = 'Open this panel to scan the current source files.';
}

function scanWebExtensionApis() {
    if (apiReportBusy) return;
    apiReportGeneration++;
    var generation = apiReportGeneration;
    apiReportBusy = true;
    apiReportResults = null;
    var list = document.getElementById('api-list');
    var status = document.getElementById('api-panel-status');
    var panelCount = document.querySelector('#api-panel .api-panel-count');
    list.textContent = '';
    panelCount.textContent = '';

    var items = [].filter.call(
        document.querySelectorAll('#file-list li[data-filename]'),
        function(item) {
            return /\.(?:[cm]?js|jsx|tsx?|html?|xhtml)$/i.test(item.dataset.filename) &&
                !item.classList.contains('file-removed');
        }
    );
    var results = Object.create(null);
    status.textContent = items.length ?
        'Scanning ' + items.length + ' source file' + (items.length === 1 ? '' : 's') + '…' :
        'No JavaScript, TypeScript, or HTML source files were found.';

    function scanNext(index) {
        if (generation !== apiReportGeneration) return;
        if (index >= items.length) {
            apiReportBusy = false;
            apiReportResults = results;
            renderWebExtensionApiReport(results);
            return;
        }
        var item = items[index];
        var filename = item.dataset.filename;
        var edited = editedFiles.get(filename);
        if (edited) {
            var editedText = edited.getText();
            if (typeof editedText === 'string') {
                collectWebExtensionApiReferences(editedText, filename, results);
            }
            if (index % 8 === 0) {
                status.textContent = 'Scanning ' + (index + 1) + ' of ' + items.length + ' source files…';
            }
            setTimeout(function() { scanNext(index + 1); }, 0);
            return;
        }
        item.zipEntry.getData(new EfficientTextWriter(), function(text) {
            if (generation !== apiReportGeneration) return;
            collectWebExtensionApiReferences(text, filename, results);
            if (index % 8 === 0) {
                status.textContent = 'Scanning ' + (index + 1) + ' of ' + items.length + ' source files…';
            }
            setTimeout(function() { scanNext(index + 1); }, 0);
        }, function() {
            if (generation === apiReportGeneration) {
                setTimeout(function() { scanNext(index + 1); }, 0);
            }
        });
    }
    scanNext(0);
}

function collectWebExtensionApiReferences(text, filename, results) {
    // Gather static browser/chrome property chains, including optional chaining
    // and quoted bracket notation. API names are indexed without root aliases.
    var accessPattern = /\b(?:browser|chrome)((?:(?:\?\.|\.)\s*[A-Za-z_$][\w$]*|\s*\[\s*["'][A-Za-z_$][\w$]*["']\s*\])+)/g;
    var propertyPattern = /(?:\?\.|\.)\s*([A-Za-z_$][\w$]*)|\[\s*["']([A-Za-z_$][\w$]*)["']\s*\]/g;
    var match;
    while ((match = accessPattern.exec(text)) !== null) {
        var properties = [];
        var propertyMatch;
        propertyPattern.lastIndex = 0;
        while ((propertyMatch = propertyPattern.exec(match[1])) !== null) {
            properties.push(propertyMatch[1] || propertyMatch[2]);
        }
        if (!properties.length) continue;
        var namespace = properties.shift();
        var record = results[namespace] || (results[namespace] = {
            files: new Set(),
            roots: new Set(),
            members: Object.create(null),
        });
        record.roots.add(match[0].indexOf('browser') === 0 ? 'browser' : 'chrome');
        record.files.add(filename);
        if (properties.length) {
            var member = properties.join('.');
            var memberRecord = record.members[member] || (record.members[member] = new Set());
            memberRecord.add(filename);
        }
    }
}

function renderWebExtensionApiReport(results) {
    var list = document.getElementById('api-list');
    var status = document.getElementById('api-panel-status');
    var panelCount = document.querySelector('#api-panel .api-panel-count');
    var toggle = document.getElementById('api-report-toggle');
    var namespaces = Object.keys(results).sort(function(a, b) { return a.localeCompare(b); });
    list.textContent = '';
    panelCount.textContent = namespaces.length ?
        namespaces.length + ' namespace' + (namespaces.length === 1 ? '' : 's') : '';
    toggle.textContent = 'APIs' + (namespaces.length ? ' ' + namespaces.length : '');
    toggle.title = namespaces.length ?
        namespaces.length + ' WebExtension API namespaces detected. Open the summary.' :
        'No WebExtension API references detected. Open the scan report.';
    status.textContent = namespaces.length ?
        'Text scan of source references; comments or strings may match, and aliased or computed access may be missed. Summaries are local; MDN links open the full reference.' :
        'No browser.* or chrome.* API references were detected in the scanned source files.';

    namespaces.forEach(function(namespace) {
        var record = results[namespace];
        var api = Object.prototype.hasOwnProperty.call(WEBEXTENSION_API_CATALOG, namespace) ?
            WEBEXTENSION_API_CATALOG[namespace] : null;
        var details = document.createElement('details');
        details.className = 'api-entry';
        var heading = document.createElement('summary');
        var title = document.createElement('span');
        title.className = 'api-entry-title';
        var rootNames = Array.from(record.roots).sort().join('/');
        title.textContent = rootNames + '.' + namespace + (api && api.title ? ' · ' + api.title : '');
        var usage = document.createElement('span');
        usage.className = 'api-entry-count';
        usage.textContent = record.files.size + ' file' + (record.files.size === 1 ? '' : 's');
        heading.append(title, usage);
        details.appendChild(heading);

        var summary = document.createElement('p');
        summary.className = 'api-entry-summary';
        summary.textContent = api ? api.summary :
            'This namespace is not in the bundled summary catalog; open the WebExtensions API index for details.';
        details.appendChild(summary);

        var memberNames = Object.keys(record.members).sort(function(a, b) { return a.localeCompare(b); });
        if (memberNames.length) {
            var memberList = document.createElement('ul');
            memberList.className = 'api-member-list';
            memberNames.forEach(function(member) {
                var row = document.createElement('li');
                row.className = 'api-member-row';
                var copy = document.createElement('div');
                copy.className = 'api-member-copy';
                var path = document.createElement('code');
                path.textContent = namespace + '.' + member;
                var description = document.createElement('p');
                var memberSummary = api && api.members &&
                    Object.prototype.hasOwnProperty.call(api.members, member) ? api.members[member] : null;
                if (!memberSummary && api && api.members) {
                    var parentMember = member;
                    while (!memberSummary && parentMember.indexOf('.') !== -1) {
                        parentMember = parentMember.slice(0, parentMember.lastIndexOf('.'));
                        if (Object.prototype.hasOwnProperty.call(api.members, parentMember)) {
                            memberSummary = api.members[parentMember];
                        }
                    }
                }
                description.textContent = memberSummary ||
                    'Referenced by the add-on; see the API reference for this member.';
                copy.append(path, description);
                var searchButton = document.createElement('button');
                searchButton.type = 'button';
                searchButton.textContent = 'Search';
                searchButton.title = 'Find references to ' + namespace + '.' + member;
                searchButton.onclick = function() {
                    var filter = document.getElementById('file-filter');
                    filter.value = '!api:' + namespace + '.' + member;
                    checkAndApplyFilter(false);
                    filter.dispatchEvent(new Event('change', {bubbles: true}));
                    filter.focus();
                };
                row.append(copy, searchButton);
                memberList.appendChild(row);
            });
            details.appendChild(memberList);
        }

        var docLink = document.createElement('a');
        docLink.className = 'api-doc-link';
        docLink.href = 'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/' +
            encodeURIComponent(namespace);
        docLink.target = '_blank';
        docLink.rel = 'noopener noreferrer';
        docLink.textContent = 'MDN API reference';
        details.appendChild(docLink);
        list.appendChild(details);
    });
}

function invalidateLocaleCoverage() {
    ZenLocaleDiff.markStale();
    localeCoverageGeneration++;
    localeCoverageResults = null;
    localeCoverageBusy = false;
    document.getElementById('locale-export-json').disabled = true;
    document.getElementById('locale-export-csv').disabled = true;
    var toggle = document.getElementById('locale-report-toggle');
    var panel = document.getElementById('locale-panel');
    if (toggle) {
        toggle.textContent = 'Locales';
        toggle.title = 'Compare localized messages and show key coverage';
    }
    if (panel && !panel.hidden) {
        document.getElementById('locale-list').textContent = '';
        document.querySelector('#locale-panel .locale-panel-count').textContent = '';
        document.getElementById('locale-reference').hidden = true;
        document.getElementById('locale-reference-label').hidden = true;
        document.getElementById('locale-panel-status').textContent =
            'Source changed. Select Rescan to refresh locale coverage.';
    }
}

function initializeLocaleCoveragePanel() {
    if (localeCoverageInitialized) return;
    localeCoverageInitialized = true;
    var toggle = document.getElementById('locale-report-toggle');
    var panel = document.getElementById('locale-panel');
    toggle.onclick = function() {
        panel.hidden = !panel.hidden;
        toggle.setAttribute('aria-expanded', String(!panel.hidden));
        if (!panel.hidden && !localeCoverageResults && !localeCoverageBusy) {
            scanLocaleCoverage();
        }
    };
    document.getElementById('locale-panel-close').onclick = function() {
        panel.hidden = true;
        toggle.setAttribute('aria-expanded', 'false');
    };
    document.getElementById('locale-rescan').onclick = scanLocaleCoverage;
    document.getElementById('locale-export-json').onclick = function() {
        exportLocaleCoverage('json');
    };
    document.getElementById('locale-export-csv').onclick = function() {
        exportLocaleCoverage('csv');
    };
    document.getElementById('locale-reference').onchange = function() {
        if (localeCoverageResults) {
            renderLocaleCoverage(localeCoverageResults, this.value);
            if (ZenLocaleDiff.isOpen()) ZenLocaleDiff.open(this.value, ZenLocaleDiff.currentLocale());
        }
    };
}

function scanLocaleCoverage() {
    if (localeCoverageBusy) return;
    localeCoverageGeneration++;
    var generation = localeCoverageGeneration;
    localeCoverageBusy = true;
    localeCoverageResults = null;
    var list = document.getElementById('locale-list');
    var status = document.getElementById('locale-panel-status');
    var referenceSelect = document.getElementById('locale-reference');
    document.getElementById('locale-export-json').disabled = true;
    document.getElementById('locale-export-csv').disabled = true;
    list.textContent = '';
    referenceSelect.hidden = true;

    var candidates = [].filter.call(
        document.querySelectorAll('#file-list li[data-filename]'),
        function(item) {
            var filename = item.dataset.filename;
            return !item.classList.contains('file-removed') &&
                (/(?:^|\/)manifest\.json$/i.test(filename) ||
                    /(?:^|\/)_locales\/[^/]+\/messages\.json$/i.test(filename));
        }
    );
    var manifests = candidates.filter(function(item) {
        return /(?:^|\/)manifest\.json$/i.test(item.dataset.filename);
    });
    manifests.sort(function(a, b) {
        var aPath = a.dataset.filename;
        var bPath = b.dataset.filename;
        if ((aPath.toLowerCase() === 'manifest.json') !== (bPath.toLowerCase() === 'manifest.json')) {
            return aPath.toLowerCase() === 'manifest.json' ? -1 : 1;
        }
        return aPath.split('/').length - bPath.split('/').length;
    });
    var selectedManifest = manifests[0] || null;
    var manifestPrefix = selectedManifest ?
        selectedManifest.dataset.filename.slice(0, selectedManifest.dataset.filename.lastIndexOf('/') + 1) : '';
    var localePrefix = manifestPrefix + '_locales/';
    var items = [];
    if (selectedManifest) items.push(selectedManifest);
    candidates.forEach(function(item) {
        if (/(?:^|\/)_locales\/[^/]+\/messages\.json$/i.test(item.dataset.filename) &&
                (!selectedManifest || item.dataset.filename.toLowerCase().indexOf(localePrefix.toLowerCase()) === 0)) {
            items.push(item);
        }
    });
    var result = {
        manifest: null,
        locales: Object.create(null),
        errors: [],
    };
    status.textContent = 'Reading the manifest and locale message files…';

    function processFile(filename, text) {
        if (/(?:^|\/)manifest\.json$/i.test(filename)) {
            try {
                var manifest = parseManifest(text);
                // Prefer the root manifest if an archive contains nested packages.
                if (!result.manifest || filename.toLowerCase() === 'manifest.json') {
                    result.manifest = manifest;
                    result.manifestFilename = filename;
                }
            } catch (e) {
                result.errors.push({file: filename, message: 'Invalid manifest JSON: ' + e.message});
            }
            return;
        }

        var localeMatch = /(?:^|\/)_locales\/([^/]+)\/messages\.json$/i.exec(filename);
        if (!localeMatch) return;
        var locale = localeMatch[1];
        try {
            var messages = JSON.parse(text);
            if (!messages || typeof messages !== 'object' || Array.isArray(messages)) {
                throw new Error('Expected a JSON object of message keys.');
            }
            var messageMap = Object.create(null);
            var invalidKeys = [];
            Object.keys(messages).forEach(function(key) {
                // @@ names are reserved browser-defined messages, not translations
                // that each locale needs to provide.
                if (key.indexOf('@@') === 0) return;
                var normalizedKey = key.toLowerCase();
                var value = messages[key];
                var isValid = value && typeof value === 'object' &&
                    !Array.isArray(value) && typeof value.message === 'string';
                if (!isValid) invalidKeys.push(key);
                if (!Object.prototype.hasOwnProperty.call(messageMap, normalizedKey)) {
                    messageMap[normalizedKey] = {
                        key: key,
                        message: isValid ? value.message : '',
                        valid: !!isValid,
                        // Copied to new keys added from the locale diff.
                        description: isValid && typeof value.description === 'string' ? value.description : undefined,
                    };
                }
            });
            var normalizedLocale = normalizeLocaleCode(locale);
            if (result.locales[normalizedLocale]) {
                result.errors.push({file: filename, message: 'Duplicate locale directory: ' + locale});
                return;
            }
            result.locales[normalizedLocale] = {
                name: locale,
                filename: filename,
                messages: messageMap,
                invalidKeys: invalidKeys,
            };
        } catch (e) {
            result.errors.push({file: filename, message: 'Invalid messages.json: ' + e.message});
        }
    }

    function readNext(index) {
        if (generation !== localeCoverageGeneration) return;
        if (index >= items.length) {
            localeCoverageBusy = false;
            localeCoverageResults = result;
            renderLocaleCoverage(result);
            // An open locale diff shows the new scan.
            ZenLocaleDiff.refresh();
            return;
        }
        var item = items[index];
        var filename = item.dataset.filename;
        var edited = editedFiles.get(filename);
        if (edited) {
            var editedText = edited.getText();
            if (typeof editedText === 'string') processFile(filename, editedText);
            if (index % 4 === 0) {
                status.textContent = 'Reading locale data ' + (index + 1) + ' of ' + items.length + '…';
            }
            setTimeout(function() { readNext(index + 1); }, 0);
            return;
        }
        item.zipEntry.getData(new EfficientTextWriter(), function(text) {
            if (generation !== localeCoverageGeneration) return;
            processFile(filename, text);
            if (index % 4 === 0) {
                status.textContent = 'Reading locale data ' + (index + 1) + ' of ' + items.length + '…';
            }
            setTimeout(function() { readNext(index + 1); }, 0);
        });
    }
    readNext(0);
}

function normalizeLocaleCode(locale) {
    return (locale || '').replace(/-/g, '_').toLowerCase();
}

function buildLocaleComparison(result, referenceKey) {
    var reference = result.locales[referenceKey];
    var referenceKeys = Object.keys(reference.messages).sort(function(a, b) {
        return reference.messages[a].key.localeCompare(reference.messages[b].key);
    });
    var locales = Object.keys(result.locales).sort(function(a, b) {
        return result.locales[a].name.localeCompare(result.locales[b].name);
    });
    var defaultLocale = result.manifest && typeof result.manifest.default_locale === 'string' ?
        result.manifest.default_locale : '';
    var report = {
        generatedAt: new Date().toISOString(),
        manifest: {
            file: result.manifestFilename || null,
            defaultLocale: defaultLocale || null,
            name: result.manifest && typeof result.manifest.name === 'string' ? result.manifest.name : null,
            version: result.manifest && typeof result.manifest.version === 'string' ? result.manifest.version : null,
        },
        referenceLocale: {
            code: referenceKey,
            name: reference.name,
            file: reference.filename,
            keyCount: referenceKeys.length,
        },
        locales: [],
        errors: result.errors.slice(),
    };

    locales.forEach(function(localeKey) {
        var locale = result.locales[localeKey];
        var missing = [];
        var extra = [];
        var changed = [];
        var identical = 0;
        referenceKeys.forEach(function(key) {
            var referenceMessage = reference.messages[key];
            var localeMessage = locale.messages[key];
            if (!localeMessage) {
                missing.push({
                    key: referenceMessage.key,
                    referenceMessage: referenceMessage.valid ? referenceMessage.message : null,
                    localeMessage: null,
                    referencePresent: true,
                    localePresent: false,
                    referenceValid: referenceMessage.valid,
                    localeValid: null,
                });
            } else if (referenceMessage.valid && localeMessage.valid) {
                if (localeMessage.message === referenceMessage.message) {
                    if (localeKey !== referenceKey) identical++;
                } else {
                    changed.push({
                        key: referenceMessage.key,
                        referenceMessage: referenceMessage.message,
                        localeMessage: localeMessage.message,
                        referencePresent: true,
                        localePresent: true,
                        referenceValid: true,
                        localeValid: true,
                    });
                }
            }
        });
        Object.keys(locale.messages).forEach(function(key) {
            if (!Object.prototype.hasOwnProperty.call(reference.messages, key)) {
                var message = locale.messages[key];
                extra.push({
                    key: message.key,
                    referenceMessage: null,
                    localeMessage: message.valid ? message.message : null,
                    referencePresent: false,
                    localePresent: true,
                    referenceValid: null,
                    localeValid: message.valid,
                });
            }
        });
        extra.sort(function(a, b) { return a.key.localeCompare(b.key); });
        changed.sort(function(a, b) { return a.key.localeCompare(b.key); });
        var present = referenceKeys.length - missing.length;
        report.locales.push({
            code: localeKey,
            name: locale.name,
            file: locale.filename,
            presentKeyCount: present,
            referenceKeyCount: referenceKeys.length,
            // Rounded down, so that 100% only means that no key is missing
            // (e.g. 327 of 328 keys is 99%, not 100%).
            coveragePercent: referenceKeys.length ? Math.floor(present / referenceKeys.length * 100) : null,
            missingKeys: missing,
            localeOnlyKeys: extra,
            changedMessages: changed,
            identicalTextCount: identical,
            invalidKeys: locale.invalidKeys.slice().sort(function(a, b) { return a.localeCompare(b); }),
        });
    });
    return report;
}

function renderLocaleCoverage(result, requestedReference) {
    var list = document.getElementById('locale-list');
    var status = document.getElementById('locale-panel-status');
    var panelCount = document.querySelector('#locale-panel .locale-panel-count');
    var toggle = document.getElementById('locale-report-toggle');
    var referenceSelect = document.getElementById('locale-reference');
    var localeKeys = Object.keys(result.locales).sort(function(a, b) {
        return result.locales[a].name.localeCompare(result.locales[b].name);
    });
    list.textContent = '';
    panelCount.textContent = localeKeys.length + ' locale' + (localeKeys.length === 1 ? '' : 's');
    toggle.textContent = 'Locales ' + localeKeys.length;
    toggle.title = localeKeys.length ?
        'Compare ' + localeKeys.length + ' locales and inspect key coverage.' :
        'No locale message files were found.';

    var defaultLocale = result.manifest && typeof result.manifest.default_locale === 'string' ?
        result.manifest.default_locale : '';
    var defaultKey = normalizeLocaleCode(defaultLocale);
    var selectedKey = requestedReference && result.locales[normalizeLocaleCode(requestedReference)] ?
        normalizeLocaleCode(requestedReference) :
        (result.locales[defaultKey] ? defaultKey : localeKeys[0]);

    referenceSelect.textContent = '';
    localeKeys.forEach(function(localeKey) {
        var option = document.createElement('option');
        option.value = localeKey;
        option.textContent = result.locales[localeKey].name +
            (localeKey === defaultKey ? ' (manifest default)' : '');
        referenceSelect.appendChild(option);
    });
    referenceSelect.value = selectedKey || '';
    referenceSelect.hidden = localeKeys.length < 2;
    document.getElementById('locale-reference-label').hidden = localeKeys.length < 2;
    document.getElementById('locale-export-json').disabled = false;
    document.getElementById('locale-export-csv').disabled = false;

    if (!localeKeys.length) {
        status.textContent = 'No valid _locales/*/messages.json files were found.';
        appendLocaleReportErrors(list, result.errors);
        return;
    }

    var warning = '';
    if (!defaultLocale) {
        warning = 'Manifest default_locale is missing; using ' + result.locales[selectedKey].name + ' as the reference. ';
    } else if (!result.locales[defaultKey]) {
        warning = 'Manifest default_locale ' + defaultLocale + ' has no matching messages.json; using ' +
            result.locales[selectedKey].name + ' as the reference. ';
    }
    status.textContent = warning +
        'Select a locale to compare it with ' + result.locales[selectedKey].name + ' side by side.';
    appendLocaleReportErrors(list, result.errors);

    var report = buildLocaleComparison(result, selectedKey);
    var activeLocale = ZenLocaleDiff.currentLocale();
    report.locales.forEach(function(localeReport) {
        var localeKey = localeReport.code;
        // Each locale opens its diff with the reference in the main panel
        // (see locale-diff.js), like a changed file in VS Code.
        var item = document.createElement('li');
        item.className = 'locale-entry';
        item.dataset.locale = localeKey;
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.classList.toggle('is-reference', localeKey === selectedKey);
        item.classList.toggle('is-active', localeKey === activeLocale);
        item.title = localeKey === selectedKey ?
            'The reference locale. Click to see its messages.' :
            'Compare ' + localeReport.name + ' with ' + result.locales[selectedKey].name + ' side by side';

        var heading = document.createElement('div');
        heading.className = 'locale-entry-heading';
        var name = document.createElement('span');
        name.className = 'locale-name';
        name.textContent = localeReport.name + (localeKey === selectedKey ? ' \u00b7 reference' : '');
        var coverage = document.createElement('span');
        coverage.className = 'locale-coverage';
        coverage.textContent = localeReport.coveragePercent === null ? '\u2014' : localeReport.coveragePercent + '%';
        heading.append(name, coverage);
        item.appendChild(heading);

        var progress = document.createElement('progress');
        progress.className = 'locale-progress';
        progress.max = 100;
        progress.value = localeReport.coveragePercent === null ? 0 : localeReport.coveragePercent;
        progress.setAttribute('aria-label', localeReport.coveragePercent === null ?
            'No reference keys' : localeReport.coveragePercent + '% key coverage');
        item.appendChild(progress);

        var stats = document.createElement('p');
        stats.className = 'locale-stats';
        var parts = [];
        // Problems first (\u2715), then keys to review (= same text as the
        // reference, + only in this locale), like in the locale diff.
        var referenceName = result.locales[selectedKey].name;
        if (localeReport.missingKeys.length) {
            parts.push(['missing', '\u2715 ' + localeReport.missingKeys.length + ' missing',
                'No entry in this locale: users see the ' + referenceName + ' text']);
        }
        if (localeReport.invalidKeys.length) {
            parts.push(['invalid', '\u2715 ' + localeReport.invalidKeys.length + ' invalid',
                'Entries without a string "message" value']);
        }
        if (localeKey !== selectedKey && localeReport.identicalTextCount) {
            parts.push(['untranslated', '= ' + localeReport.identicalTextCount + ' same as ' + referenceName,
                'The entry exists but its text is the same as ' + referenceName +
                ': fine for names, or not translated yet']);
        }
        if (localeReport.localeOnlyKeys.length) {
            parts.push(['extra', '+ ' + localeReport.localeOnlyKeys.length + ' only here',
                'Keys that ' + referenceName + ' does not have']);
        }
        if (!parts.length) {
            parts.push(['complete', localeKey === selectedKey ?
                localeReport.referenceKeyCount + ' keys' : 'Complete']);
        }
        parts.forEach(function(part, i) {
            if (i) stats.appendChild(document.createTextNode(' \u00b7 '));
            var span = document.createElement('span');
            span.className = 'locale-stat-' + part[0];
            span.textContent = part[1];
            if (part[2]) span.title = part[2];
            stats.appendChild(span);
        });
        item.appendChild(stats);

        item.onclick = function() {
            ZenLocaleDiff.open(selectedKey, localeKey);
        };
        item.onkeydown = function(event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                item.onclick();
            }
        };
        list.appendChild(item);
    });
}

function exportLocaleCoverage(format) {
    if (!localeCoverageResults) return;
    var referenceKey = document.getElementById('locale-reference').value;
    if (!referenceKey || !localeCoverageResults.locales[referenceKey]) return;
    var report = buildLocaleComparison(localeCoverageResults, referenceKey);
    var extensionName = archiveBaseName().replace(/[^a-z0-9._-]+/gi, '-') || 'extension';
    var referenceName = normalizeLocaleCode(report.referenceLocale.name).replace(/[^a-z0-9_-]+/g, '-') || 'reference';
    var filename = extensionName + '-locale-report-vs-' + referenceName + '.' + format;

    if (format === 'json') {
        downloadTextFile(JSON.stringify(report, null, 2), filename, 'application/json;charset=utf-8');
        return;
    }

    var rows = [[
        'recordType', 'locale', 'referenceLocale', 'coveragePercent', 'presentKeys', 'referenceKeyCount',
        'missingKeyCount', 'changedMessageCount', 'localeOnlyKeyCount', 'identicalTextCount', 'invalidKeyCount',
        'key', 'referenceMessage', 'localeMessage', 'details',
    ]];
    function addRow(type, locale, key, referenceMessage, localeMessage, details) {
        rows.push([
            type, locale || '', report.referenceLocale.name, '', '', report.referenceLocale.keyCount,
            '', '', '', '', '', key || '', referenceMessage == null ? '' : referenceMessage,
            localeMessage == null ? '' : localeMessage, details || '',
        ]);
    }
    report.locales.forEach(function(locale) {
        rows.push([
            'summary', locale.name, report.referenceLocale.name, locale.coveragePercent === null ? '' : locale.coveragePercent,
            locale.presentKeyCount, locale.referenceKeyCount, locale.missingKeys.length,
            locale.changedMessages.length, locale.localeOnlyKeys.length, locale.identicalTextCount, locale.invalidKeys.length,
            '', '', '', '',
        ]);
        locale.missingKeys.forEach(function(entry) {
            addRow('missing-key', locale.name, entry.key, entry.referenceMessage, '',
                entry.referenceValid ? '' : 'Reference message has no valid string value');
        });
        locale.changedMessages.forEach(function(entry) {
            addRow('changed-message', locale.name, entry.key,
                entry.referenceMessage, entry.localeMessage, '');
        });
        locale.localeOnlyKeys.forEach(function(entry) {
            addRow('locale-only-key', locale.name, entry.key, '', entry.localeMessage,
                entry.localeValid ? '' : 'Locale message has no valid string value');
        });
        locale.invalidKeys.forEach(function(key) {
            addRow('invalid-message', locale.name, key, '', '', 'Message field is not a string');
        });
    });
    report.errors.forEach(function(error) {
        addRow('error', '', '', '', '', error.file + ': ' + error.message);
    });
    var csv = rows.map(function(row) {
        return row.map(function(value) {
            return '"' + String(value).replace(/"/g, '""') + '"';
        }).join(',');
    }).join('\r\n');
    downloadTextFile('\uFEFF' + csv, filename, 'text/csv;charset=utf-8');
}

function appendLocaleReportErrors(list, errors) {
    errors.forEach(function(error) {
        var item = document.createElement('li');
        item.className = 'locale-entry locale-error';
        item.textContent = error.file + ': ' + error.message;
        list.appendChild(item);
    });
}

function changeKind(change) {
    return change && change.kind || 'modified';
}

function markFileListItem(filename, change) {
    var li = getFileListItem(filename);
    if (!li) return;
    var kind = change ? changeKind(change) : null;
    li.classList.toggle('file-edited', !!change);
    li.classList.toggle('file-added', kind === 'added');
    li.classList.toggle('file-removed', kind === 'removed');
}

function setFileEdited(entry, editor) {
    // A file added by a patch stays added when its edits are reverted.
    if (!editor && entry._addedChange) editor = entry._addedChange;
    // ...and stays "added" (not "modified") while it is edited.
    if (editor && entry._addedChange && editor !== entry._addedChange && !editor.kind) editor.kind = 'added';
    // This also runs when an edited file is only shown again: the API and
    // locale scans are out of date only when the content really changed.
    var content = editor ? (editor.binary ? editor.getBytes() : editor.getText()) : undefined;
    if (editedFiles.get(entry.filename) !== editor || entry._lastEditedContent !== content) {
        entry._lastEditedContent = content;
        invalidateApiReport();
        invalidateLocaleCoverage();
        ZenReview.invalidate();
    }
    if (editor) {
        editedFiles.set(entry.filename, editor);
    } else {
        editedFiles.delete(entry.filename);
    }
    markFileListItem(entry.filename, editor);
    var button = document.getElementById('download-edited-zip');
    button.hidden = editedFiles.size === 0;
    button.title = 'Download a new zip file that includes your edits to ' +
        editedFiles.size + ' file' + (editedFiles.size === 1 ? '' : 's');
    scheduleChangesPanelRender();
}

function getFileListItem(filename) {
    return document.querySelector('#file-list li[data-filename="' + filename.replace(/["\\]/g, '\\$&') + '"]');
}

// Opens a file in the viewer, like clicking on it in the file tree.
function openFileFromList(filename) {
    var li = getFileListItem(filename);
    if (!li) return;
    revealInFileTree(filename);
    li.click();
    li.scrollIntoView({block: 'nearest'});
}

function revertFile(filename) {
    var editor = editedFiles.get(filename);
    if (editor && confirm('Discard your edits to ' + filename + '?')) {
        editor.revert();
    }
}

// The "Changes" panel lists edited files, like the changed files of a commit.
var scheduleChangesPanelRender = (function() {
    var timer = null;
    return function() {
        clearTimeout(timer);
        timer = setTimeout(renderChangesPanel, 120);
    };
})();

function renderChangesPanel() {
    var panel = document.getElementById('changes-panel');
    var list = document.getElementById('changes-list');
    var selected = document.querySelector('#file-list li.file-selected');
    var selectedName = selected && selected.dataset.filename;
    var filenames = Array.from(editedFiles.keys()).sort(function(a, b) {
        return a.localeCompare(b);
    });
    panel.hidden = filenames.length === 0;
    panel.querySelector('.changes-count').textContent = filenames.length;
    list.textContent = '';
    var totalAdded = 0;
    var totalRemoved = 0;
    filenames.forEach(function(filename) {
        var change = editedFiles.get(filename);
        var kind = changeKind(change);
        var stats = change.diffStats();
        totalAdded += stats.added;
        totalRemoved += stats.removed;
        var slash = filename.lastIndexOf('/');
        var row = document.createElement('li');
        row.className = 'change-row is-' + kind;
        row.classList.toggle('is-selected', filename === selectedName);
        row.title = filename + ' (' + kind + '): ' + stats.added + ' line' + (stats.added === 1 ? '' : 's') +
            ' added, ' + stats.removed + ' removed. Click to view the changes.';
        row.innerHTML =
            '<span class="change-status"></span>' +
            '<span class="change-name"><span class="change-file"></span><span class="change-dir"></span></span>' +
            '<span class="change-stats"><span class="stat-add"></span><span class="stat-del"></span></span>' +
            '<button class="change-revert" title="Discard changes"></button>';
        row.querySelector('.change-status').textContent = {modified: 'M', added: 'A', removed: 'D'}[kind];
        row.querySelector('.change-file').textContent = filename.slice(slash + 1);
        row.querySelector('.change-dir').textContent = slash === -1 ? '' : filename.slice(0, slash);
        if (change.binary) {
            row.querySelector('.change-stats').textContent = 'binary';
        } else {
            row.querySelector('.stat-add').textContent = '+' + stats.added;
            row.querySelector('.stat-del').textContent = '\u2212' + stats.removed;
        }
        row.querySelector('.change-revert').onclick = function(event) {
            event.stopPropagation();
            revertFile(filename);
        };
        row.onclick = function() {
            if (editorPrefs.diffMode === 'off') editorPrefs.diffMode = 'unified';
            openFileFromList(filename);
            // The file may already be shown; apply the diff mode right away.
            document.getElementById('source-code').dispatchEvent(new CustomEvent('diffmodechange'));
        };
        list.appendChild(row);
    });
    var totalElem = panel.querySelector('.changes-total');
    totalElem.textContent = '';
    var addedElem = document.createElement('span');
    addedElem.className = 'stat-add';
    addedElem.textContent = '+' + totalAdded;
    var removedElem = document.createElement('span');
    removedElem.className = 'stat-del';
    removedElem.textContent = '\u2212' + totalRemoved;
    totalElem.append(addedElem, ' ', removedElem);

    // Mark folders that contain edited files, like an editor's source control view.
    var editedFolders = new Set();
    filenames.forEach(function(filename) {
        for (var j = filename.indexOf('/'); j !== -1; j = filename.indexOf('/', j + 1)) {
            editedFolders.add(filename.slice(0, j + 1));
        }
    });
    [].forEach.call(document.querySelectorAll('#file-list li.folder-row'), function(row) {
        row.classList.toggle('folder-has-edits', editedFolders.has(row.dataset.folder));
    });
}

function revertAllFiles() {
    var count = editedFiles.size;
    if (!count || !confirm('Discard your edits to ' + count + ' file' + (count === 1 ? '' : 's') + '?')) return;
    Array.from(editedFiles.values()).forEach(function(editor) {
        editor.revert();
    });
}

// Creates a new zip file with all files of the current archive, using the
// edited text for files that were edited.
function downloadEditedZip() {
    var button = document.getElementById('download-edited-zip');
    var items = [].map.call(document.querySelectorAll('#file-list li[data-filename]'), function(li) {
        return li.zipEntry;
    });
    var originalName = document.getElementById('download-link').download || 'extension.zip';
    var zipName = originalName.replace(/\.(zip|xpi)$/i, '') + '-edited.zip';
    button.disabled = true;
    button.textContent = 'Creating zip\u2026';
    function done(error) {
        button.disabled = false;
        button.textContent = 'Download edited zip';
        if (error) alert('Could not create the zip file: ' + error);
    }
    zip.createWriter(new zip.BlobWriter('application/zip'), function(writer) {
        var i = 0;
        (function addNext() {
            if (i >= items.length) {
                writer.close(function(blob) {
                    var a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = zipName;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
                    done();
                });
                return;
            }
            var entry = items[i++];
            var editor = editedFiles.get(entry.filename);
            if (editor) {
                var content = editor.binary ? editor.getBytes() : editor.getText();
                if (content === null) {
                    addNext(); // Removed by a patch.
                    return;
                }
                writer.add(entry.filename, editor.binary ?
                    new zip.BlobReader(new Blob([content])) : new zip.TextReader(content), addNext);
                return;
            }
            entry.getData(new zip.BlobWriter(), function(blob) {
                writer.add(entry.filename, new zip.BlobReader(blob), addNext);
            });
        })();
    }, done);
}

// ---- Patches (git-style unified diffs, see lib/jsdiff.js)

// The original text of a file in the archive.
function readEntryText(entry) {
    if (entry._originalEntry) return readEntryText(entry._originalEntry);
    if (entry._isAdded) return Promise.resolve(null);
    if (!entry._rawText) {
        entry._rawText = new Promise(function(resolve) {
            entry.getData(new EfficientTextWriter(), resolve);
        });
    }
    return entry._rawText;
}

// The original bytes of a file in the archive (for files replaced by a
// binary patch, the bytes of the replaced file).
function readEntryBytes(entry) {
    var original = entry._originalEntry || entry;
    if (original._isAdded) return Promise.resolve(null);
    if (!original._rawBytes) {
        original._rawBytes = new Promise(function(resolve) {
            original.getData(new Uint8ArrayWriter(), resolve);
        });
    }
    return original._rawBytes;
}

// The current bytes of a file: with edits and patches, or null if removed.
function readCurrentBytes(entry) {
    var change = editedFiles.get(entry.filename);
    if (change && change.binary) return Promise.resolve(change.getBytes());
    if (change) {
        var text = change.getText();
        return Promise.resolve(text === null ? null : new TextEncoder().encode(text));
    }
    return readEntryBytes(entry);
}

// The current text of a file: with edits and patches, or null if removed.
function readCurrentText(entry) {
    var change = editedFiles.get(entry.filename);
    if (change) return Promise.resolve(change.getText());
    return readEntryText(entry);
}

function downloadTextFile(text, filename, type) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], {type: type || 'text/plain'}));
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function() { URL.revokeObjectURL(a.href); }, 60000);
}

function archiveBaseName() {
    var name = document.getElementById('download-link').download || 'extension.zip';
    return name.replace(/\.(zip|xpi)$/i, '');
}

// Downloads all changes (edits and applied patches) as a Git-style patch,
// relative to the original files of the archive (like `git diff`).
function downloadChangesPatch() {
    var filenames = Array.from(editedFiles.keys()).sort(function(a, b) { return a.localeCompare(b); });
    Promise.all(filenames.map(function(filename) {
        var change = editedFiles.get(filename);
        var entry = (getFileListItem(filename) || {}).zipEntry || addedEntries.get(filename);
        if (change.binary) {
            return (entry ? readEntryBytes(entry) : Promise.resolve(null)).then(function(original) {
                return {path: filename, binary: true, oldBytes: original, newBytes: change.getBytes()};
            });
        }
        return (entry ? readEntryText(entry) : Promise.resolve(change.getOriginalText()))
            .then(function(original) {
                return {path: filename, oldText: original, newText: change.getText()};
            });
    })).then(function(files) {
        return ZenPatch.createGitPatchAsync(files);
    }).then(function(patch) {
        if (!patch) {
            alert('There are no changes to save as a patch.');
            return;
        }
        downloadTextFile(patch, archiveBaseName() + '-changes.patch', 'text/x-diff');
    }).catch(function(error) {
        alert('Could not create the patch: ' + (error && error.message || error));
    });
}

// A change made by a patch to a file that has no editor (yet).
function createPatchChange(entry, kind, originalText, newText) {
    return {
        kind: kind,
        getText: function() { return newText; },
        getOriginalText: function() { return originalText; },
        isModified: function() { return true; },
        diffStats: function() {
            if (kind === 'removed') return {added: 0, removed: ZenEditor.diffStats(originalText || '', '').removed};
            if (kind === 'added') return {added: ZenEditor.diffStats('', newText || '').added, removed: 0};
            return ZenEditor.diffStats(originalText || '', newText || '');
        },
        revert: function() {
            if (kind === 'added') {
                delete entry._addedChange;
                addedEntries.delete(entry.filename);
                editedFiles.delete(entry.filename);
                rebuildFileTree();
                return;
            }
            delete entry._patchedText;
            setFileEdited(entry, null);
        },
    };
}

// Files of the archive whose content was replaced by a binary patch (path -> entry).
var replacedEntries = new Map();

// A change made by a binary patch: kind 'modified', 'added' or 'removed'.
function createBinaryChange(entry, kind, newBytes) {
    return {
        kind: kind,
        binary: true,
        getBytes: function() { return newBytes; },
        getText: function() { return kind === 'removed' ? null : undefined; },
        getOriginalText: function() { return null; },
        isModified: function() { return true; },
        diffStats: function() { return {added: 0, removed: 0}; },
        revert: function() {
            if (kind === 'added') {
                delete entry._addedChange;
                addedEntries.delete(entry.filename);
                editedFiles.delete(entry.filename);
                rebuildFileTree();
            } else if (kind === 'modified') {
                replacedEntries.delete(entry.filename);
                editedFiles.delete(entry.filename);
                rebuildFileTree();
            } else {
                setFileEdited(entry, null);
            }
        },
    };
}

// A file created by a patch (text or bytes), usable like a file of the archive.
function createAddedEntry(path, content) {
    var bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    return {
        filename: path,
        directory: false,
        uncompressedSize: bytes.length,
        compressedSize: bytes.length,
        _isAdded: true,
        getData: function(writer, onend) {
            writer.init(function() {
                writer.writeUint8Array(bytes, function() {
                    writer.getData(onend);
                });
            });
        },
    };
}

function rebuildFileTree() {
    var entries = archiveEntries.map(function(entry) {
        return replacedEntries.get(entry.filename) || entry;
    });
    handleZipEntries(entries.concat(Array.from(addedEntries.values())), {keepState: true});
}

// Sets the text of an existing file to the result of a patch.
function setPatchedText(entry, originalText, newText) {
    // If the file is open in an editor, the editor takes the new text.
    if (entry._setPatchedText && entry._setPatchedText(newText)) return;
    entry._patchedText = newText;
    setFileEdited(entry, createPatchChange(entry, 'modified', originalText, newText));
}

// Finds the file a patch refers to, also without a leading directory (like `patch -p1`).
function findPatchTarget(path) {
    if (!path) return null;
    var candidates = [path, path.replace(/^[^/]+\//, '')];
    for (var i = 0; i < candidates.length; ++i) {
        var li = getFileListItem(candidates[i]);
        if (li && li.zipEntry) return li.zipEntry;
    }
    return null;
}

// Applies a patch (e.g. from `git diff`) to the opened add-on, like `git apply`.
function applyPatchText(patchText, patchName) {
    var fileChanges;
    try {
        fileChanges = ZenPatch.parse(patchText);
    } catch (e) {
        showPatchReport(patchName, [{path: patchName, ok: false, message: 'This file is not a valid patch: ' + e.message}]);
        return;
    }
    if (!fileChanges.length) {
        showPatchReport(patchName, [{path: patchName, ok: false, message: 'No file changes found in this patch.'}]);
        return;
    }
    var results = [];
    var treeChanged = false;
    var queue = fileChanges.slice();
    (function next() {
        var change = queue.shift();
        if (!change) {
            if (treeChanged) rebuildFileTree();
            showPatchReport(patchName, results);
            return;
        }
        applyOneFileChange(change).then(function(result) {
            if (result.treeChanged) treeChanged = true;
            results.push(result);
            next();
        }, function(error) {
            results.push({path: change.newPath || change.oldPath, ok: false, message: String(error)});
            next();
        });
    })();
}

function applyOneFileChange(change) {
    var path = change.newPath || change.oldPath;
    if (change.kind === 'binary') {
        return Promise.resolve({path: path, ok: false,
            message: 'The patch does not contain the binary data of this file. Create the patch with \u201cgit diff --binary\u201d.'});
    }
    if (change.binary) {
        return applyBinaryChange(change);
    }
    if (change.kind === 'create') {
        if (findPatchTarget(change.newPath)) {
            return Promise.resolve({path: path, ok: false, message: 'Not created: a file with this name already exists.'});
        }
        var created = ZenPatch.apply('', change.patch);
        if (!created) return Promise.resolve({path: path, ok: false, message: 'Not created: the patch is invalid.'});
        var addedEntry = createAddedEntry(change.newPath, created.text);
        addedEntry._addedChange = createPatchChange(addedEntry, 'added', null, created.text);
        addedEntries.set(change.newPath, addedEntry);
        editedFiles.set(change.newPath, addedEntry._addedChange);
        return Promise.resolve({path: path, ok: true, kind: 'added', treeChanged: true});
    }
    var entry = findPatchTarget(change.oldPath);
    if (!entry) {
        return Promise.resolve({path: change.oldPath, ok: false, message: 'Not found in this add-on.'});
    }
    return Promise.all([readEntryText(entry), readCurrentText(entry)]).then(function(texts) {
        var original = texts[0];
        var current = texts[1];
        if (current === null) {
            return {path: entry.filename, ok: false, message: 'Not applied: this file was removed.'};
        }
        var applied = ZenPatch.apply(current, change.patch);
        if (!applied) {
            return {path: entry.filename, ok: false, message: 'Not applied: the file does not match the patch (it may be a different version).'};
        }
        var note = applied.fuzz ? ' (with fuzz ' + applied.fuzz + ')' : '';
        if (change.kind === 'delete') {
            if (applied.text !== '') {
                return {path: entry.filename, ok: false, message: 'Not removed: the file has more content than the patch removes.'};
            }
            setFileEdited(entry, createPatchChange(entry, 'removed', original, null));
            return {path: entry.filename, ok: true, kind: 'removed', note: note};
        }
        if (change.kind === 'rename') {
            if (findPatchTarget(change.newPath)) {
                return {path: change.newPath, ok: false, message: 'Not renamed: a file with the new name already exists.'};
            }
            setFileEdited(entry, createPatchChange(entry, 'removed', original, null));
            var renamed = createAddedEntry(change.newPath, applied.text);
            renamed._addedChange = createPatchChange(renamed, 'added', null, applied.text);
            addedEntries.set(change.newPath, renamed);
            editedFiles.set(change.newPath, renamed._addedChange);
            return {path: entry.filename + ' \u2192 ' + change.newPath, ok: true, kind: 'renamed', note: note, treeChanged: true};
        }
        setPatchedText(entry, original, applied.text);
        return {path: entry.filename, ok: true, kind: 'modified', note: note};
    });
}

// Applies a Git binary patch (literal or delta) to a file, like `git apply`.
function applyBinaryChange(change) {
    var path = change.newPath || change.oldPath;
    if (change.kind === 'create') {
        if (findPatchTarget(change.newPath)) {
            return Promise.resolve({path: path, ok: false, message: 'Not created: a file with this name already exists.'});
        }
        var created = ZenPatch.applyBinary(null, change);
        if (created.error) return Promise.resolve({path: path, ok: false, message: 'Not created: ' + created.error + '.'});
        addBinaryFile(change.newPath, created.bytes);
        return Promise.resolve({path: path, ok: true, kind: 'added (binary)', treeChanged: true});
    }
    var entry = findPatchTarget(change.oldPath);
    if (!entry) {
        return Promise.resolve({path: change.oldPath, ok: false, message: 'Not found in this add-on.'});
    }
    return readCurrentBytes(entry).then(function(current) {
        if (current === null) {
            return {path: entry.filename, ok: false, message: 'Not applied: this file was removed.'};
        }
        var result = ZenPatch.applyBinary(current, change);
        if (result.error) {
            return {path: entry.filename, ok: false, message: 'Not applied: ' + result.error + '.'};
        }
        if (change.kind === 'delete') {
            setFileEdited(entry, createBinaryChange(entry, 'removed', null));
            return {path: entry.filename, ok: true, kind: 'removed (binary)'};
        }
        if (change.kind === 'rename') {
            if (findPatchTarget(change.newPath)) {
                return {path: change.newPath, ok: false, message: 'Not renamed: a file with the new name already exists.'};
            }
            setFileEdited(entry, createBinaryChange(entry, 'removed', null));
            addBinaryFile(change.newPath, result.bytes);
            return {path: entry.filename + ' \u2192 ' + change.newPath, ok: true, kind: 'renamed (binary)', treeChanged: true};
        }
        var original = entry._originalEntry || entry;
        var replacement = createAddedEntry(original.filename, result.bytes);
        replacement._isAdded = false;
        replacement._originalEntry = original;
        replacedEntries.set(original.filename, replacement);
        editedFiles.set(original.filename, createBinaryChange(replacement, 'modified', result.bytes));
        return {path: entry.filename, ok: true, kind: 'modified (binary)', treeChanged: true};
    });
}

function addBinaryFile(path, bytes) {
    var addedEntry = createAddedEntry(path, bytes);
    addedEntry._addedChange = createBinaryChange(addedEntry, 'added', bytes);
    addedEntries.set(path, addedEntry);
    editedFiles.set(path, addedEntry._addedChange);
}

function showPatchReport(patchName, results) {
    var dialog = document.createElement('dialog');
    dialog.className = 'patch-report';
    var applied = results.filter(function(r) { return r.ok; }).length;
    var title = document.createElement('h3');
    title.textContent = applied === results.length ?
        'Patch applied' : applied ? 'Patch partly applied' : 'Patch not applied';
    dialog.appendChild(title);
    var summary = document.createElement('p');
    summary.textContent = patchName + ': ' + applied + ' of ' + results.length + ' file' +
        (results.length === 1 ? '' : 's') + ' changed.' +
        (applied ? ' Review them in the Changes panel; you can revert any of them.' : '');
    dialog.appendChild(summary);
    var list = document.createElement('ul');
    results.forEach(function(r) {
        var item = document.createElement('li');
        item.className = r.ok ? 'is-ok' : 'is-failed';
        var mark = document.createElement('span');
        mark.className = 'patch-mark';
        mark.textContent = r.ok ? '\u2713' : '\u2715';
        var name = document.createElement('span');
        name.className = 'patch-path';
        name.textContent = r.path;
        var detail = document.createElement('span');
        detail.className = 'patch-detail';
        detail.textContent = r.ok ? r.kind + (r.note || '') : r.message;
        item.append(mark, name, detail);
        list.appendChild(item);
    });
    dialog.appendChild(list);
    var close = document.createElement('button');
    close.textContent = 'OK';
    close.onclick = function() { dialog.close(); };
    dialog.appendChild(close);
    dialog.onclose = function() { dialog.remove(); };
    document.body.appendChild(dialog);
    dialog.showModal();
}

(function() {
    var button = document.getElementById('apply-patch');
    var input = document.createElement('input');
    input.type = 'file';
    input.accept = '.patch,.diff,.txt,text/x-diff,text/x-patch,text/plain';
    input.onchange = function() {
        var file = input.files[0];
        input.value = '';
        if (!file) return;
        file.text().then(function(text) {
            applyPatchText(text, file.name);
        });
    };
    button.onclick = function() {
        input.click();
    };
    document.getElementById('changes-download-patch').onclick = downloadChangesPatch;
})();

// The top bar can wrap onto more rows in narrow windows. Publish its height
// so that the panels below it (see viewer.less) fill the rest of the window.
(function() {
    var topBar = document.getElementById('top-bar');
    var lastHeight = -1;
    function updateTopBarHeight() {
        var height = topBar.offsetHeight;
        if (height === lastHeight) return;
        lastHeight = height;
        document.documentElement.style.setProperty('--top-bar-height', height + 'px');
    }
    updateTopBarHeight();
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(updateTopBarHeight).observe(topBar);
    } else {
        window.addEventListener('resize', updateTopBarHeight);
    }
})();

// The code editor that is currently shown, if any.
var currentCodeEditor = null;

// Ctrl/Cmd+F and Ctrl/Cmd+G anywhere on the page: search in the shown code
// instead of opening the browser's find bar.
window.addEventListener('keydown', function(event) {
    var isMac = /Mac|iPhone|iPad/.test(navigator.platform);
    var mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.altKey) return;
    var key = event.key.toLowerCase();
    if (key !== 'f' && key !== 'g') return;
    // Inside the editor (or its search box), CodeMirror handles these keys itself.
    var active = document.activeElement;
    if (active && active.closest && active.closest('.cm-editor')) return;
    if (key === 'f') {
        event.preventDefault();
        if (currentCodeEditor) {
            currentCodeEditor.openSearch();
        } else {
            var fileFilter = document.getElementById('file-filter');
            fileFilter.focus();
            fileFilter.select();
        }
    } else if (currentCodeEditor) {
        event.preventDefault();
        var button = document.querySelector('#source-toolbar ' + (event.shiftKey ? '.find-prev' : '.find-next'));
        if (button) button.click();
    }
}, true);

document.getElementById('download-edited-zip').onclick = downloadEditedZip;
document.getElementById('revert-all-changes').onclick = revertAllFiles;
document.getElementById('changes-download-zip').onclick = downloadEditedZip;

window.addEventListener('beforeunload', function(event) {
    if (editedFiles.size) {
        // Ask the user before closing the viewer with unsaved edits.
        event.preventDefault();
        event.returnValue = '';
    }
});

var viewFileInfo = (function() {
    var _currentEntry = null;
    var handlers = {};
    var wantRawSourceGlobalDefault = false;

    // To increase performance, intermediate results are cached
    // _cachedResult = extracted content
    // _cachedCallback = If existent, a function which renders the (cached) result.
    // Additional members:
    // _initialViewParams = If set, will be used the first time that the entry is rendered.
    function viewFileInfo(entry) {
        function onReturnEarly() {
            // Clear parameters when the user switches elsewhere,
            // or when the parameters are used.
            delete entry._initialViewParams;
        }
        if (_currentEntry === entry) return onReturnEarly();
        _currentEntry = entry;
        if (entry._cachedCallback) {
            // If cachedCallback returns false, then nothing was rendered.
            if (entry._cachedCallback() !== false);
                return onReturnEarly();
        }

        var mimeType = getMimeTypeForFilename(entry.filename);
        var mt = mimeType.split('/');

        var handler = handlers[mimeType] || handlers[mt[0]];
        if (!handler) {
            switch (getGenericType(entry.filename)) {
            case 'code':
            case 'markup':
            case 'locales':
                handler = handlers.text;
                break;
            case 'images':
                handler = handlers.image;
                break;
            }
        }

        if (!handler) {
            if (!confirm('No handler for ' + mimeType + ' :(\nWant to open as plain text?'))
                return onReturnEarly();
            mimeType = 'text/plain';
            handler = handlers.text;
        }
        var callback = handler.callback;

        if (entry._cachedResult) {
            saveScroll();
            willSwitchSourceView();
            callback(entry, entry._cachedResult);
            restoreScroll(entry.filename);
            return onReturnEarly();
        }

        var Writer = handler.Writer;
        var writer;
        if (Writer === zip.Data64URIWriter ||
            Writer === zip.BlobWriter) {
            writer = new Writer(mimeType);
        } else {
            writer = new Writer();
        }

        entry.getData(writer, function(result) {
            entry._cachedResult = result;
            if (_currentEntry !== entry) {
                console.log('Finished reading file, but another file was opened!');
                return onReturnEarly();
            }
            saveScroll();
            willSwitchSourceView();
            callback(entry, result, function finalCallback(callbackResult) {
                if (callbackResult && typeof callbackResult !== 'function') {
                    throw new Error('callbackResult exists and is not a function!');
                }
                entry._cachedCallback = function() {
                    saveScroll();
                    if (callbackResult) {
                        willSwitchSourceView();
                        onReturnEarly();
                        callbackResult();
                    }
                    restoreScroll(entry.filename);
                    return typeof callbackResult == 'function';
                };
                // Final callback = thing has been rendered for the first time,
                // or something like that.
                restoreScroll(entry.filename);
            });
        }, function(current, total) {
            // Progress, todo
        });
    }
    handlers['application/vnd.mozilla.xul+xml'] =
    handlers['application/javascript'] =
    handlers['application/json'] =
    handlers['application/rdf+xml'] =
    handlers['application/xhtml+xml'] =
    handlers['application/xml-dtd'] =
    handlers.text = {
        Writer: EfficientTextWriter,
        callback: function(entry, text, finalCallback) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            var sourceCodeElem = document.getElementById('source-code');

            // One CodeMirror editor per view (original and beautified code).
            var hostRaw = document.createElement('div');
            var hostBeauty = document.createElement('div');
            hostRaw.className = hostBeauty.className = 'cm-host';
            var editorRaw, editorBeauty;
            var editorCurrent; // The currently displayed editor.
            var hostCurrent;
            var scrollSnapshots = new Map();

            var heading = document.createElement('div');
            heading.className = 'file-specific-toolbar';

            // Downloads the current text, including any edits.
            var downloadLink = createDownloadLink(entry);
            downloadLink.textContent = 'Download file';
            downloadLink.onclick = function() {
                if (!editorCurrent) return false;
                if (downloadLink.href) URL.revokeObjectURL(downloadLink.href);
                downloadLink.download = entry.filename.split('/').pop();
                downloadLink.href = URL.createObjectURL(new Blob([editorCurrent.getText()], {
                    type: getMimeTypeForFilename(entry.filename),
                }));
            };
            heading.appendChild(downloadLink);
            heading.appendChild(createContentVerifier(entry));

            var goToLineButton = document.createElement('button');
            goToLineButton.textContent = 'Go to line';
            goToLineButton.title = 'Jump to a line (Ctrl+Alt+G / Cmd+Alt+G)';
            goToLineButton.onclick = function() {
                if (editorCurrent) editorCurrent.gotoLine();
            };
            heading.appendChild(goToLineButton);

            var toggleBeautify = document.createElement('button');
            heading.appendChild(toggleBeautify);

            var toggleEdit = document.createElement('button');
            toggleEdit.className = 'toggle-edit';
            toggleEdit.onclick = function() {
                editorPrefs.editable = !editorPrefs.editable;
                applyEditorPrefs();
                if (editorPrefs.editable && editorCurrent) editorCurrent.view.focus();
            };
            heading.appendChild(toggleEdit);

            var revertButton = document.createElement('button');
            revertButton.textContent = 'Revert';
            revertButton.title = 'Discard your edits to this file';
            revertButton.hidden = true;
            revertButton.onclick = function() {
                if (editorCurrent && confirm('Discard your edits to ' + entry.filename + '?')) {
                    editorCurrent.revert();
                }
            };
            heading.appendChild(revertButton);

            var toggleWrap = document.createElement('button');
            toggleWrap.onclick = function() {
                editorPrefs.wrap = !editorPrefs.wrap;
                applyEditorPrefs();
            };
            heading.appendChild(toggleWrap);

            heading.insertAdjacentHTML('beforeend',
                '<button class="find-prev" title="Find previous match of the search term (from the filter box, after !)">&#9650;</button>' +
                '<button class="find-next" title="Find next match of the search term (from the filter box, after !)">&#9660;</button>' +
                '<button class="find-all" title="Highlight all occurrences of the search term"><span class="find-all-indicator">H</span></button>' +
                '<span class="find-status"></span>' +
                '<span class="toolbar-spacer"></span>' +
                '<span class="diff-controls" hidden>' +
                    '<button class="change-prev" title="Previous change">&#8593;</button>' +
                    '<button class="change-next" title="Next change">&#8595;</button>' +
                    '<span class="diff-switch" role="group" aria-label="How to show your changes">' +
                        '<button data-mode="off" title="Show the edited code">Code</button>' +
                        '<button data-mode="unified" title="Show changes inline, like a unified diff">Diff</button>' +
                        '<button data-mode="split" title="Show the original and edited code side by side">Split</button>' +
                    '</span>' +
                '</span>' +
                '<span class="language-label"></span>' +
                '');
            [].forEach.call(heading.querySelectorAll('.diff-switch > button'), function(button) {
                button.onclick = function() {
                    editorPrefs.diffMode = button.dataset.mode;
                    applyDiffMode();
                };
            });
            heading.querySelector('.change-prev').onclick = function() {
                editorCurrent.goToChange(-1);
            };
            heading.querySelector('.change-next').onclick = function() {
                editorCurrent.goToChange(1);
            };
            // Sent when a file is opened from the Changes panel.
            sourceCodeElem.addEventListener('diffmodechange', function() {
                if (sourceToolbarElem.firstChild === heading) applyDiffMode();
            });

            var shouldHighlightAll = false;
            heading.querySelector('.find-prev').onclick = function() {
                if (!editorCurrent.getQueryStatus().hasQuery) {
                    editorCurrent.openSearch();
                    showFindStatus(true);
                    return;
                }
                editorCurrent.findPrev();
                showFindStatus(true);
            };
            heading.querySelector('.find-next').onclick = function() {
                if (!editorCurrent.getQueryStatus().hasQuery) {
                    editorCurrent.openSearch();
                    showFindStatus(true);
                    return;
                }
                editorCurrent.findNext();
                showFindStatus(true);
            };
            var findAllButton = heading.querySelector('.find-all');
            function setHighlightAll(enabled) {
                shouldHighlightAll = enabled;
                findAllButton.firstChild.classList.toggle('find-all-enabled', enabled);
                findAllButton.classList.toggle('is-active', enabled);
                findAllButton.setAttribute('aria-pressed', String(enabled));
                findAllButton.title = enabled ?
                    'Highlighting all matches. Click to turn highlighting off.' :
                    'Highlight all matches of the search term';
                if (editorCurrent) editorCurrent.setHighlightAll(enabled);
            }
            findAllButton.onclick = function() {
                setHighlightAll(!shouldHighlightAll);
                if (shouldHighlightAll && !editorCurrent.getQueryStatus().hasQuery) {
                    // Nothing to highlight yet: let the user type a search term.
                    editorCurrent.openSearch();
                }
                if (shouldHighlightAll) {
                    showFindStatus(true);
                } else {
                    hideFindStatus();
                }
            };
            function hideFindStatus() {
                var statusElem = heading.querySelector('.find-status');
                statusElem.style.cursor = '';
                statusElem.textContent = statusElem.title = '';
            }
            function showFindStatus(isUserGesture) {
                var statusElem = heading.querySelector('.find-status');
                var status = editorCurrent.getQueryStatus();
                if (!status.hasQuery) {
                    if (!isUserGesture) {
                        hideFindStatus();
                        return;
                    }
                    statusElem.textContent = 'Type a search term';
                    statusElem.style.cursor = 'help';
                    statusElem.title =
                        'Search this file with Ctrl+F (Cmd+F on a Mac), or search all files by typing\n' +
                        ' !(search term)\n' +
                        'in the filter box in the upper-left corner.\n' +
                        'Then use the arrow buttons to jump between matches, and H to highlight all of them.';
                    return;
                }
                statusElem.style.cursor = '';
                var searchDescription = '"' + status.term + '" (' +
                    (status.source === 'panel' ? 'search box of this file' : 'filter box') + ')';
                if (!status.resultTotal) {
                    statusElem.textContent = '0';
                    statusElem.title = 'No matches for ' + searchDescription;
                    return;
                }
                // If there are many results, then not the total count is
                // returned. In that case, we know that the total number is
                // the minimum number of results, so add a visual indicator.
                var totalShortStr =
                    status.resultTotal + (status.isTotalDefinite ? '' : '+');
                var totalLongStr =
                    (status.isTotalDefinite ? '' : 'at least ') +
                    status.resultTotal + ' occurrence' +
                    (status.resultTotal === 1 ? '' : 's');
                if (status.resultIndex === -1) {
                    statusElem.textContent = totalShortStr;
                    statusElem.title = 'Found ' + totalLongStr + ' of ' + searchDescription;
                    return;
                }
                var resultIndexOneBased = status.resultIndex + 1;
                statusElem.textContent = resultIndexOneBased + '/' + totalShortStr;
                statusElem.title = 'Showing result ' + resultIndexOneBased + ' of ' + totalLongStr +
                    ' of ' + searchDescription;
            }
            function enableEditorButtons(enabled) {
                [].forEach.call(heading.querySelectorAll(
                    '.find-next, .find-prev, .find-all, .toggle-edit, .toggle-wrap'), function(button) {
                    button.disabled = !enabled;
                });
                goToLineButton.disabled = !enabled;
            }
            toggleWrap.className = 'toggle-wrap';
            // Disabled until the editor exists (beautifying can take a moment).
            enableEditorButtons(false);

            function applyEditorPrefs() {
                toggleEdit.textContent = editorPrefs.editable ? 'Editing' : 'Edit';
                toggleEdit.classList.toggle('is-active', editorPrefs.editable);
                toggleEdit.title = editorPrefs.editable ?
                    'Editing is on. Click to make the code read-only.' :
                    'Click to edit this code. Edited files can be downloaded individually or as a new zip.';
                toggleWrap.textContent = 'Wrap';
                toggleWrap.classList.toggle('is-active', editorPrefs.wrap);
                toggleWrap.title = editorPrefs.wrap ? 'Line wrapping is on. Click to turn it off.' :
                    'Line wrapping is off. Click to turn it on.';
                if (editorCurrent) {
                    editorCurrent.setReadOnly(!editorPrefs.editable);
                    editorCurrent.setWrap(editorPrefs.wrap);
                }
            }

            // Shows the diff of edited files as chosen with the Code/Diff/Split switch.
            function applyDiffMode() {
                if (!editorCurrent) return;
                var modified = editorCurrent.isModified();
                var mode = modified ? editorPrefs.diffMode : 'off';
                editorCurrent.setDiffMode(mode);
                heading.querySelector('.diff-controls').hidden = !modified;
                heading.querySelector('.change-prev').hidden =
                heading.querySelector('.change-next').hidden = mode === 'off';
                [].forEach.call(heading.querySelectorAll('.diff-switch > button'), function(button) {
                    button.classList.toggle('is-active', button.dataset.mode === mode);
                });
            }

            function updateModifiedState() {
                var modified = !!editorCurrent && editorCurrent.isModified();
                revertButton.hidden = !modified;
                if (!modified && editorCurrent && editorCurrent.getDiffMode() !== 'off') {
                    // Nothing left to compare; show the plain editor again.
                    applyDiffMode();
                }
                heading.querySelector('.diff-controls').hidden = !modified;
                var currentMode = editorCurrent ? editorCurrent.getDiffMode() : 'off';
                [].forEach.call(heading.querySelectorAll('.diff-switch > button'), function(button) {
                    button.classList.toggle('is-active', button.dataset.mode === currentMode);
                });
                heading.querySelector('.change-prev').hidden =
                heading.querySelector('.change-next').hidden = currentMode === 'off';
                // Switching between original and beautified code would hide the edits.
                if (beautify.getType(entry.filename)) {
                    toggleBeautify.disabled = modified;
                    if (modified) {
                        toggleBeautify.title = 'Revert your edits to switch between beautified and original code.';
                    } else {
                        toggleBeautify.title = 'Click on this button to toggle between beautified and non-beautified (original) code.';
                    }
                }
                setFileEdited(entry, modified ? editorCurrent : null);
            }

            function createEditor(host, doc, initialDoc) {
                var editor = ZenEditor.create({
                    parent: host,
                    doc: doc,
                    initialDoc: initialDoc,
                    filename: entry.filename,
                    readOnly: !editorPrefs.editable,
                    wrap: editorPrefs.wrap,
                    onSearchChange: function() {
                        if (editor === editorCurrent) showFindStatus(false);
                    },
                    onModifiedChange: function(modified) {
                        if (editor === editorCurrent) {
                            updateModifiedState();
                        } else {
                            // E.g. reverted from the Changes panel while another file is shown.
                            setFileEdited(entry, modified ? editor : null);
                        }
                    },
                });
                return editor;
            }

            // Shows the original (useBeautified=false) or beautified code.
            function selectView(useBeautified) {
                if (hostCurrent && editorCurrent) {
                    scrollSnapshots.set(hostCurrent, editorCurrent.view.scrollSnapshot());
                }
                hostCurrent = useBeautified ? hostBeauty : hostRaw;
                editorCurrent = useBeautified ? editorBeauty : editorRaw;
                toggleBeautify.textContent = 'Beautify';
                toggleBeautify.classList.toggle('was-beautify-enabled', useBeautified);
                toggleBeautify.classList.toggle('is-active', useBeautified);
                if (!editorCurrent) {
                    if (!useBeautified) {
                        // Text from an applied patch, if any (see setPatchedText).
                        var patchedText = entry._patchedText;
                        delete entry._patchedText;
                        editorRaw = editorCurrent = createEditor(hostRaw, text, patchedText);
                    } else {
                        enableEditorButtons(false);
                        beautify({
                            text: text,
                            type: beautify.getType(entry.filename),
                            wrap: 0
                        }, function(textBeauty) {
                            editorBeauty = createEditor(hostBeauty, textBeauty);
                            if (hostCurrent === hostBeauty) {
                                editorCurrent = editorBeauty;
                                onEditorShown();
                            }
                        });
                    }
                }
                doRenderSourceCodeViewer();
            }

            function onEditorShown() {
                if (sourceToolbarElem.firstChild !== heading || !editorCurrent) {
                    // The user switched to another file in the meantime.
                    return;
                }
                enableEditorButtons(true);
                entry._searchEngineForPermalink = editorCurrent;
                heading.querySelector('.language-label').textContent = editorCurrent.languageName;
                applyEditorPrefs();
                updateModifiedState();
                applyDiffMode();
                editorCurrent.refresh();
                var snapshot = scrollSnapshots.get(hostCurrent);
                if (snapshot) editorCurrent.view.dispatch({effects: snapshot});

                editorCurrent.setSearch(textSearchEngine.getCurrentSearchTerm());
                setHighlightAll(shouldHighlightAll);
                currentCodeEditor = editorCurrent;
                showFindStatus(false);
                textSearchEngine.setQueryChangeCallback(function() {
                    editorCurrent.setSearch(textSearchEngine.getCurrentSearchTerm());
                    showFindStatus(false);
                });
                var initialViewParams = entry._initialViewParams;
                if (initialViewParams) {
                    delete entry._initialViewParams; // = "onReturnEarly".
                    if (initialViewParams.qh) {
                        setHighlightAll(true);
                        showFindStatus(false);
                    }
                    if (initialViewParams.qi) {
                        // Find the qi-th result.
                        for (var i = initialViewParams.qi; i > 0; --i) {
                            editorCurrent.findNext();
                        }
                        showFindStatus(false);
                    }
                }
            }

            if (beautify.getType(entry.filename)) {
                toggleBeautify.className = 'toggle-beautifier';
                toggleBeautify.title = 'Click on this button to toggle between beautified and non-beautified (original) code.';
                toggleBeautify.onclick = function() {
                    // Note: Toggling the state is based on the local editor
                    // instead of `!wantRawSourceGlobalDefault` because
                    // the two may differ when the user switches to a different
                    // file and modifies toggles the beautifier in that file.
                    wantRawSourceGlobalDefault = hostCurrent !== hostRaw;
                    selectView(!wantRawSourceGlobalDefault);
                };

                if (entry._initialViewParams) {
                    wantRawSourceGlobalDefault = !entry._initialViewParams.qb;
                }
            } else {
                toggleBeautify.title = 'Beautify not available for this file type';
                toggleBeautify.disabled = true;
            }

            function doRenderSourceCodeViewer() {
                sourceCodeElem.classList.add('has-editor');
                if (sourceCodeElem.lastChild !== hostCurrent) {
                    if (sourceCodeElem.lastChild === hostRaw || sourceCodeElem.lastChild === hostBeauty) {
                        sourceCodeElem.lastChild.remove();
                    }
                    sourceCodeElem.appendChild(hostCurrent);
                }
                if (editorCurrent) onEditorShown();
            }

            function onSourceViewShow() {
                sourceCodeElem.addEventListener('sourceviewhide', onSourceViewHide);
                sourceToolbarElem.appendChild(heading);
                if (entry._patchedText !== undefined && hostCurrent !== hostRaw) {
                    // A patch changed this file: show the original (patched) code.
                    selectView(false);
                    return;
                }
                doRenderSourceCodeViewer();
            }

            // Called by setPatchedText. Returns whether this editor took the text.
            entry._setPatchedText = function(newText) {
                if (editorRaw) {
                    editorRaw.setText(newText);
                    if (sourceToolbarElem.firstChild === heading && hostCurrent !== hostRaw) {
                        selectView(false);
                    }
                    return true;
                }
                if (sourceToolbarElem.firstChild === heading) {
                    entry._patchedText = newText;
                    selectView(false);
                    return true;
                }
                return false;
            };

            function onSourceViewHide() {
                sourceCodeElem.removeEventListener('sourceviewhide', onSourceViewHide);
                sourceCodeElem.classList.remove('has-editor');
                if (editorCurrent) {
                    scrollSnapshots.set(hostCurrent, editorCurrent.view.scrollSnapshot());
                }
                textSearchEngine.setQueryChangeCallback(null);
                currentCodeEditor = null;
            }

            sourceToolbarElem.appendChild(heading);
            sourceCodeElem.addEventListener('sourceviewhide', onSourceViewHide);
            // Use the last selected option for new views.
            // Note: This state only changes when the user clicks on the
            // `toggleBeautify` button, not when they change the file view.
            selectView(!!beautify.getType(entry.filename) && !wantRawSourceGlobalDefault &&
                entry._patchedText === undefined);
            finalCallback(onSourceViewShow);
        }
    };
    handlers.image = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, data_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<img>';
            var img = sourceCodeElem.firstChild;
            img.onload = function() {
                renderImageInfo('Width: ' + this.naturalWidth + ' Height: ' + this.naturalHeight);
            };
            img.onerror = function() {
                renderImageInfo('Failed to load image');
            };
            img.src = data_url;

            function renderImageInfo(text) {
                if (sourceCodeElem.firstChild === img) {
                    // The image is still being displayed.
                    sourceToolbarElem.appendChild(document.createTextNode(' ' + text));
                }
            }
        }
    };
    handlers.audio = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, data_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<audio controls>';
            var audio = sourceCodeElem.firstChild;
            audio.onloadeddata = function() {
                renderAudioInfo('Duration: ' + audio.duration + ' seconds');
            };
            audio.onerror = function() {
                renderAudioInfo('Failed to load audio');
            };
            audio.src = data_url;

            function renderAudioInfo(text) {
                if (sourceCodeElem.firstChild === audio) {
                  // The audio element is still being displayed.
                  sourceToolbarElem.appendChild(document.createTextNode(' ' + text));
                }
            }
        }
    };
    handlers.video = {
        Writer: zip.Data64URIWriter,
        callback: function(entry, data_url) {
            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, data_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<video controls>';
            var video = sourceCodeElem.firstChild;
            video.onloadeddata = function() {
                renderVideoInfo('Width: ' + this.videoWidth + ' Height: ' + this.videoHeight + ' Duration: ' + this.duration + ' seconds');
            };
            video.onerror = function() {
                renderVideoInfo('Failed to load video');
            };
            video.src = data_url;

            function renderVideoInfo(text) {
                if (sourceCodeElem.firstChild === video) {
                    // The video is still being displayed.
                    sourceToolbarElem.appendChild(document.createTextNode(' ' + text));
                }
            }
        }
    };
    handlers['application/java-archive'] =
    handlers['application/zip'] = {
        Writer: zip.BlobWriter,
        callback: function(entry, blob) {
            var viewerUrl = 'viewer.html';
            var blob_url = URL.createObjectURL(blob);
            if (getParam('url') === window.addon_url && window.addon_url) {
                // The URL parameters are probably reliable (=describing the zip), so use it.
                var inside = getParam('inside[]');
                inside.push(entry.filename);
                viewerUrl += '?' + encodeQueryString({
                    // Pass these parameters in case the blob URL disappears.
                    url: window.addon_url,
                    inside: inside,
                    // Allow the viewer to re-use our cached blob.
                    blob: blob_url,
                });
            } else {
                viewerUrl += '?' + encodeQueryString({
                    blob: blob_url,
                    zipname: entry.filename,
                });
            }

            var sourceToolbarElem = document.getElementById('source-toolbar');
            sourceToolbarElem.appendChild(createDownloadLink(entry, blob_url));
            sourceToolbarElem.appendChild(createContentVerifier(entry));

            var sourceCodeElem = document.getElementById('source-code');
            sourceCodeElem.innerHTML = '<button>View the content of this file in a new viewer</button>';
            sourceCodeElem.firstChild.onclick = function() {
                window.open(viewerUrl);
            };
        }
    };

    // The locale diff (locale-diff.js) replaced the file view: clicking the
    // same file again must show it again.
    viewFileInfo.forgetCurrentEntry = function() {
        _currentEntry = null;
    };

    // Called right before the source viewer switches to another view.
    function willSwitchSourceView() {
        var sourceToolbarElem = document.getElementById('source-toolbar');
        sourceToolbarElem.textContent = '';

        var sourceCodeElem = document.getElementById('source-code');
        sourceCodeElem.dispatchEvent(new CustomEvent('sourceviewhide'));
        sourceCodeElem.textContent = '';
    }

    var scrollingOffsets = {};
    // identifier = filename, for example
    function saveScroll(identifier) {
        var sourceCodeElem = document.getElementById('source-code');
        if (!identifier) identifier = sourceCodeElem.dataset.filename;
        else sourceCodeElem.dataset.filename = identifier;
        if (!identifier) return;
        scrollingOffsets[identifier] = sourceCodeElem.scrollTop;
    }
    function restoreScroll(identifier) {
        var sourceCodeElem = document.getElementById('source-code');
        var currentFilename = sourceCodeElem.dataset.filename;
        if (!identifier) identifier = currentFilename;
        else sourceCodeElem.dataset.filename = identifier;
        var scrollTop = scrollingOffsets[identifier];
        if (scrollTop === undefined && !currentFilename) {
            // This is the first run, don't restore the scroll offset.
            return;
        }
        // Switched view, reset to previous offset (or default to 0).
        sourceCodeElem.scrollTop = scrollTop || 0;
    }
    function createDownloadLink(entry, url) {
        var mimeType = getMimeTypeForFilename(entry.filename);
        var filename = entry.filename.split('/').pop();

        var a = document.createElement('a');
        a.className = 'file-specific-download-link';
        a.textContent = 'Show download';
        a.title = 'Download ' + entry.filename + ' (' + formatByteSize(entry.uncompressedSize) + ' bytes, type ' + mimeType + ')';
        a.onclick = function() {
            a.onclick = null;
            a.textContent = 'Creating link';
            entry.getData(new zip.BlobWriter(mimeType), function(blob) {
                a.download = filename;
                a.textContent = 'Download file';
                a.href = URL.createObjectURL(blob);
            });
        };
        if (url) {
            a.onclick = null;
            a.download = filename;
            a.textContent = 'Download file';
            a.href = url;
        }
        return a;
    }
    function createContentVerifier(entry) {
        var wrapper = document.createElement('div');
        wrapper.className = 'content-verifier-wrapper';
        var output = document.createElement('div');
        output.className = 'content-verifier-output';
        var button = document.createElement('button');
        var displayedHashes = [
            'md5',
            'sha1',
            'sha256',
            'sha384',
            'sha512',
        ];
        button.onclick = function() {
            button.onclick = toggleOutputVisibility;

            var infoTable = createInfoTable();

            infoTable.addRow('File name', entry.filename);
            // The zip file could report an incorrect value, so we will update this later.
            infoTable.addRow('File size', formatByteSize(entry.uncompressedSize) + ' bytes');

            displayedHashes.forEach(function(algo, i) {
                infoTable.addRow(algo, '');
            });

            entry.getData(new Uint8ArrayWriter(), function(uint8array) {
                infoTable.updateRow('File size', formatByteSize(uint8array.length) + ' bytes');
                displayedHashes.forEach(function(algo, i) {
                    // ModernCrypto.md5, ModernCrypto.sha1, etc.
                    ModernCrypto[algo](uint8array, function(hash) {
                        infoTable.updateRow(algo, hash);
                    });
                });
            });

            var linkCell = infoTable.addRow('Link', '');
            linkCell.appendChild(createPermaLinkAnchor(entry));
            var noLinkNote = document.createElement('span');
            noLinkNote.className = 'permalink-unavailable';
            noLinkNote.textContent = 'Not available for files opened from your computer (they have no web address).';
            linkCell.appendChild(noLinkNote);

            if (entry.filename === 'manifest.json') {
                infoTable.addRow('Extension ID', '(unknown)');
                calculateExtensionID().then(function(result) {
                    infoTable.updateRow('Extension ID', result);
                });
            }

            output.appendChild(infoTable);
            toggleOutputVisibility();
        };
        function toggleOutputVisibility() {
            output.hidden = !output.hidden;
            if (output.hidden) {
                button.textContent = 'Show analysis';
                button.title = 'View more information about this file.';
            } else {
                button.textContent = 'Hide analysis';
                button.title = '';
                var permalinkAnchor = output.querySelector('tr[data-description="Link"] a');
                permalinkAnchor.hidden = !permalinkAnchor.updatePermalink();
                permalinkAnchor.nextElementSibling.hidden = !permalinkAnchor.hidden;
            }
        }
        // Hide the output and update the button label.
        toggleOutputVisibility();
        wrapper.appendChild(button);
        wrapper.appendChild(output);
        return wrapper;
    }

    function createInfoTable() {
        var infoTable = document.createElement('table');

        function addRow(description, initialValue) {
            var row = infoTable.insertRow(-1);
            row.className = 'info-table-row';
            row.dataset.description = description.replace(/"/g, '');
            row.insertCell(0).textContent = description;
            row.insertCell(1).textContent = initialValue || '';
            return row.cells[1];
        }
        function updateRow(description, value) {
            var row = infoTable.querySelector('tr[data-description="' + description.replace(/"/g, '') + '"]');
            row.cells[1].textContent = value;
        }
        infoTable.addRow = addRow;
        infoTable.updateRow = updateRow;
        return infoTable;
    }

    function createPermaLinkAnchor(entry) {
        var a = document.createElement('a');
        a.textContent = 'External link to current view';
        a.className = 'permalink';
        // Open in a new tab, so the current view (and any unsaved edits) stays.
        a.target = '_blank';
        a.rel = 'noopener';
        a.title = 'Opens this add-on, file and search in a new tab. ' +
            'Copy it to bookmark or share the view.';
        a.updatePermalink = function() {
            if (window.addon_url) {
                // Can only generate permalinks for public URLs.
                a.href = generatePseudoPermalink(entry);
                return true;
            }
            a.removeAttribute('href');
            return false;
        };
        // The search position, highlighting and beautify state can change
        // after the analysis was shown, so rebuild the link right before it is
        // used: hover (status bar), click, middle-click, right-click "Copy
        // Link" and keyboard focus. Focus alone is not enough, because mouse
        // clicks do not focus links on every platform.
        ['focus', 'mouseenter', 'mousedown', 'click', 'auxclick', 'contextmenu'].forEach(function(type) {
            a.addEventListener(type, a.updatePermalink);
        });
        return a;
    }
    function generatePseudoPermalink(entry) {
        var params = {
            url: window.addon_url,
        };
        var inside = getParam('url') === window.addon_url && getParam('inside[]');
        if (inside && inside.length) {
            params.inside = inside;
        }

        var fileFilterElem = document.getElementById('file-filter');
        if (fileFilterElem.value) {
            params.q = fileFilterElem.value;
        }

        // All params starting with "q" are used in renderInitialViewFromUrlParams.
        params.qf = entry.filename;

        // Only code views have this toolbar (not images, audio or video).
        var heading = document.querySelector('#source-toolbar .file-specific-toolbar');
        if (heading && heading.querySelector('.toggle-beautifier')) {
            params.qb = heading.querySelector('.was-beautify-enabled') ? '1' : '0';
        }

        var searchEngine = entry._searchEngineForPermalink;
        var status = searchEngine && searchEngine.getQueryStatus();
        if (status && status.resultTotal) {
            params.qh = searchEngine.isHighlighting ? '1' : '0';
            if (status.resultIndex !== -1) {
                // Our search result indices in qi are one-based.
                params.qi = status.resultIndex + 1;
            }
        }

        var permalink = location.origin + location.pathname;

        permalink += '?' + encodeQueryString(params);
        return permalink;
    }

    return viewFileInfo;
})();

function parseExtensionIdFromManifest(manifest) {
    var id;
    if (manifest.browser_specific_settings &&
        manifest.browser_specific_settings.gecko &&
        (id = manifest.browser_specific_settings.gecko.id)) {
        return id;
    }

    if (manifest.applications && manifest.applications.gecko &&
        (id = manifest.applications.gecko.id)) {
        return id;
    }

    return '';
}

// Parse a manifest.json file into an object. These can contain '//' comments.
function parseManifest(str) {
    var parsed;
    try {
        parsed = JSON.parse(str);
    } catch (e) {
        // Allow comments and trailing commas (lib/strip-json-comments.js).
        parsed = JSON.parse(stripJsonComments(str, {trailingCommas: true}));
    }
    return parsed;
}

// Extract the extension ID from the currently loaded extension. The ID will be
// determined from the COSE signature, the PKCS#7 signature, or manifest.json,
// whatever comes first. Resolves to the extension ID (and the signature type
// between parentheses if available), or rejects on parser errors.
function calculateExtensionID() {
    var fileList = document.getElementById('file-list');
    var readEntry = function(filename, Writer) {
        var li = fileList.querySelector('li[data-filename="' + filename + '"]');
        if (!li) {
            return null;
        }
        return new Promise(function(resolve) {
            li.zipEntry.getData(new Writer(), function(data) {
                resolve(data);
            });
        });
    };
    // https://searchfox.org/mozilla-central/rev/2738efcf/toolkit/components/extensions/schemas/manifest.json#421-431
    var extensionID_pattern =
        /^(\{[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\}|[a-z0-9-._]*@[a-z0-9-._]+)$/i;
    var formatSubject = function(id, subject) {
        if (extensionID_pattern.test(subject.CN)) {
            id = subject.CN;
        }
        var mapping = {
            'Mozilla Components': 'system',
            'Mozilla Extensions': 'privileged',
        };
        var type = mapping[subject.OU] || 'signed';
        return id + ' (' + type + ')';
    };

    return Promise.all([
        readEntry('manifest.json', EfficientTextWriter),
        readEntry('META-INF/cose.sig', Uint8ArrayWriter),
        readEntry('META-INF/mozilla.rsa', Uint8ArrayWriter),
    ]).then(function(entries) {
        var manifest_json = entries[0];
        var cose_sig = entries[1];
        var pkcs7_sig = entries[2];
        var id;

        // manifest.json contains the certification source (e.g. Production), so
        // check it in addition to the other sources.
        if (manifest_json) {
            id = parseExtensionIdFromManifest(parseManifest(manifest_json));
        }

        if (cose_sig) {
            return formatSubject(id, parseCertificate(parseMozCOSE(cose_sig)));
        }

        if (pkcs7_sig) {
            return formatSubject(id, parseCertificate(pkcs7_sig));
        }

        if (id) {
            // Unsigned extension, return it as-is.
            return id;
        }

        throw new Error('Invalid extension file');
    });
}

var textSearchEngine;  // Initialized as soon as we have a zip file.
var TextSearchEngine = (function() {
    // A text search engine. It is guaranteed to report a result for every entry in the zip file.
    // When a new search is started before the previous search completes, no old search results will
    // appear again.
    function TextSearchEngine(zipBlob) {
        // Lazily initialize the worker.
        Object.defineProperty(this, 'worker', {
            configurable: true,
            enumerable: true,
            get: function() {
                var worker = initializeWorker(this);
                worker.postMessage({
                    zipBlob: zipBlob,
                });
                delete this.worker;
                this.worker = worker;
                return worker;
            },
        });
        /**
         * Called twice for every new search. First with null, and then again with true or false.
         *
         * @callback resultCallback
         * @param {string|null} filename The filename of the result. null for all files.
         * @param {boolean|null} found true if found, false if not found, null if unknown.
         */
        this.resultCallback = null;
        this.queryChangeCallback = null;
        this._currentSearchTerm = '';
        this._currentSearchRequestId = 0;
        this._currentSearchStart = 0;
        this._recentSearchResults = {
            // This is often identical to this._currentSearchTerm, except the latter may become an
            // empty string, whereas this is not. This allows known-good search results to be
            // supplied much faster.
            searchTerm: '',
            found: [],
            notfound: [],
        };
    }

    /**
     * Validates the search term and returns a regular expression if the query
     * is a regular expression. This is the case when |searchTerm| starts with
     * "regexp:" or "iregexp:" (the latter is a case-insensitive search).
     *
     * @param {string} searchTerm
     * @returns {null|RegExp} null iff it is not a regular expression query.
     * @throws {Error} If the query is a regular expression, but the pattern is invalid.
     */
    TextSearchEngine.parsePatternAsRegExp = function(searchTerm) {
        // Keep this search term parsing logic in sync with search-worker.js.
        var parsed = /^(i?)regexp:(.*)$/.exec(searchTerm);
        if (!parsed) {
            return null;
        }
        var pattern = parsed[2];
        var flags = parsed[1]; // 'i' or ''.
        try {
            return new RegExp(pattern, flags);
        } catch (e) {
            // Browsers include the regexp in the error message, omit this.
            throw new Error((e.message+'').replace(': /' + pattern + '/' + flags, ''));
        }
    };

    TextSearchEngine.prototype.setResultCallback = function(resultCallback) {
        this.resultCallback = resultCallback;
    };

    TextSearchEngine.prototype.setQueryChangeCallback = function(queryChangeCallback) {
        // This is to support the in-file search. For now I only expect one callback
        // at any time. If more listeners are needed, switch to an event emitter.
        this.queryChangeCallback = queryChangeCallback;
    };

    /**
     * @returns {RegExp|null} The current search term, as a RegExp.
     *     null if there there is no search query.
     */
    TextSearchEngine.prototype.getCurrentSearchTerm = function() {
        // Keep this search term parsing logic in sync with search-worker.js.
        var searchTerm = this._currentSearchTerm;
        // Assuming that the query is a valid regexp, if it is a regexp.
        var regexpTerm = TextSearchEngine.parsePatternAsRegExp(searchTerm);
        if (regexpTerm) {
            searchTerm = regexpTerm;
        } else if (searchTerm) {
            searchTerm = searchTerm.replace(/[\\^$*+?.()|[\]{}]/g, '\\$&');
            if (searchTerm.lastIndexOf('case:', 0) === 0) {
                searchTerm = new RegExp(searchTerm.slice(5), '');
            } else {
                searchTerm = new RegExp(searchTerm, 'i');
            }
        } else {
            searchTerm = null;
        }
        return searchTerm;
    };

    /**
     * @param {string} searchTerm A case-insensitive search query.
     * @param {Array<string>} lowPrioFilenames List of files that the caller is not really
     *     interested in, e.g. because the files are hidden anyway.
     */
    TextSearchEngine.prototype.doPlaintextSearch = function(searchTerm, lowPrioFilenames) {
        if (!this.resultCallback) {
            console.warn('Ignored search request because the result handler was not set.');
            return;
        }

        if (!searchTerm) {
            if (this._currentSearchTerm === searchTerm) {
                return; // No change in result, do not lazily initialize the worker.
            }
            this._currentSearchTerm = '';
            this._currentSearchRequestId++;
            this.worker.postMessage({
                searchTerm: '',
                requestId: this._currentSearchRequestId,
            });
            // No search term = every file matches.
            this.resultCallback(null, true);
            if (this.queryChangeCallback) {
                this.queryChangeCallback();
            }
            return;
        }
        this.resultCallback(null, null); // Should not call doPlaintextSearch again.

        this._currentSearchRequestId++;

        // Re-use the last search results if possible.
        var previousLiteral = getLiteralSearchInfo(this._recentSearchResults.searchTerm);
        var currentLiteral = getLiteralSearchInfo(searchTerm);
        if (this._recentSearchResults.searchTerm === searchTerm) {
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.found);
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.notfound);
            this.resultCallback(this._recentSearchResults.found, true);
            this.resultCallback(this._recentSearchResults.notfound, false);
        } else if (previousLiteral && currentLiteral &&
                previousLiteral.caseSensitive === currentLiteral.caseSensitive &&
                previousLiteral.text.indexOf(currentLiteral.text) !== -1) {
            // E.g. "test" -> "tes". If the result contained "test" then it also includes "tes".
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.found);
            this.resultCallback(this._recentSearchResults.found, true);
            this._recentSearchResults.notfound.length = 0;
        } else if (previousLiteral && currentLiteral &&
                previousLiteral.caseSensitive === currentLiteral.caseSensitive &&
                currentLiteral.text.indexOf(previousLiteral.text) !== -1) {
            // E.g. "tes" -> "test". If the result did not contain "tes" then it will not contain
            // "test" either.
            lowPrioFilenames = mergeUnique(lowPrioFilenames, this._recentSearchResults.notfound);
            this.resultCallback(this._recentSearchResults.notfound, false);
            this._recentSearchResults.found.length = 0;
        } else {
            this._recentSearchResults.found.length = 0;
            this._recentSearchResults.notfound.length = 0;
        }
        this._recentSearchResults.searchTerm = searchTerm;
        this._currentSearchTerm = searchTerm;
        this._currentSearchStart = Date.now();
        this.worker.postMessage({
            searchTerm: searchTerm,
            lowPrioFilenames: lowPrioFilenames,
            requestId: this._currentSearchRequestId,
        });
        if (this.queryChangeCallback) {
            this.queryChangeCallback();
        }
    };

    // Stably merge two arrays, ignoring duplicate entries from the second array.
    function mergeUnique(a, b) {
        var merged = a.slice();
        // a is probably not large, in the worst case thousands, so this algorithm should be fine.
        for (var i = 0; i < b.length; ++i) {
            if (a.indexOf(b[i]) === -1) {
                merged.push(b[i]);
            }
        }
        return merged;
    }

    // Prefix/suffix reuse is valid for literal substring searches only. It is
    // not valid for regular expressions or across case-sensitive modes.
    function getLiteralSearchInfo(searchTerm) {
        if (TextSearchEngine.parsePatternAsRegExp(searchTerm)) {
            return null;
        }
        if (searchTerm.lastIndexOf('case:', 0) === 0) {
            return {text: searchTerm.slice(5), caseSensitive: true};
        }
        return {text: searchTerm, caseSensitive: false};
    }

    function initializeWorker(textSearchEngine) {
        var worker = new Worker('search-worker.js');
        worker.addEventListener('message', function(event) {
            if (beautify.maybeInterceptMessageEvent(event)) {
                return;
            }
            var message = event.data;
            if (message.requestId !== textSearchEngine._currentSearchRequestId) {
                return;
            }
            if (message.found.length) {
                textSearchEngine._recentSearchResults.found =
                    mergeUnique(textSearchEngine._recentSearchResults.found, message.found);
                textSearchEngine.resultCallback(message.found, true);
            }
            if (message.notfound.length) {
                textSearchEngine._recentSearchResults.notfound =
                    mergeUnique(textSearchEngine._recentSearchResults.notfound, message.notfound);
                textSearchEngine.resultCallback(message.notfound, false);
            }
            if (message.remaining === 0) {
                // This is the time spent on waiting until the zip file is extracted (first time
                // only) and busy main thread (e.g. updating the UI).
                var totalTime = Date.now() - textSearchEngine._currentSearchStart;
                console.log('Query finished in ' + message.querytime + 'ms' +
                        (totalTime > 10 ? ' (' + totalTime + 'ms total)' : '') +
                        ' for ' + message.searchTerm);
            }
        });
        return worker;
    }

    return TextSearchEngine;
})();

function renderInitialViewFromUrlParams() {
    // Filename!pattern
    var q = getParam('q') || '';
    // Whether to beautify (anything but &qb=0).
    var qb = getParam('qb') !== '0';
    // The file to select.
    var qf = getParam('qf') || '';
    // Highlight all (&qh=1).
    var qh = getParam('qh') === '1';
    // The nth search result to select (0 = none, 1 = first, etc.).
    var qi = parseInt(getParam('qi')) || 0;
    if (!q && !qf) return;
    var fileFilterElem = document.getElementById('file-filter');
    if (fileFilterElem.value && fileFilterElem.value !== q) {
        // Page restored from cache (refresh?), query parameter does not match
        // input, so do not change the view.
        console.warn('File filter input is not empty. Ignoring query from URL.');
        return;
    }

    fileFilterElem.value = q;

    // Hide all files in the UI that do not match the query.
    checkAndApplyFilter();
    if (fileFilterElem.classList.contains('invalid')) {
        // The query is invalid. Don't bother with searching.
        return;
    }

    var selectedItem;
    var fileList = document.getElementById('file-list');
    // checkAndApplyFilter above ensures that all unfiltered items match the file pattern.
    var unfilteredItems = fileList.querySelectorAll('li[data-filename]:not(.file-filtered)');
    if (qf) {
        var listItems = fileList.querySelectorAll('li[data-filename]');
        for (var i = 0; i < listItems.length; ++i) {
            if (listItems[i].dataset.filename === qf) {
                selectedItem = listItems[i];
                break;
            }
        }
        if (!selectedItem) {
            console.warn('No entry found with name ' + qf);
            return;
        }
        if ([].indexOf.call(unfilteredItems, selectedItem) === -1) {
            console.warn('The selected item is invisible because it did not match the search filter.');
        }
    } else if (unfilteredItems.length === 1) {
        selectedItem = unfilteredItems[0];
    } else if (unfilteredItems.length > 1) {
        // More than one item matches. Select the shortest matching filename,
        // because we assume that the "permalink" includes the file name,
        // so that we don't actually have to search through all files.
        // TODO: Wait for the first positive search result?
        var smallestNameLength = Infinity;
        [].forEach.call(unfilteredItems, function(listItem) {
            var len = listItem.dataset.filename.length;
            if (smallestNameLength > len) {
                smallestNameLength = len;
                selectedItem = listItem;
            }
        });
    }
    if (!selectedItem) {
        console.warn('Ignoring query from URL because there is no matching file.');
        return;
    }
    selectedItem.classList.add('file-selected');
    revealInFileTree(selectedItem.dataset.filename);
    scrollElementIntoViewIfNeeded(fileList.parentNode, selectedItem);
    selectedItem.zipEntry._initialViewParams = {
        qb: qb,
        qh: qh,
        qi: qi,
    };
    viewFileInfo(selectedItem.zipEntry);
}

function scrollElementIntoViewIfNeeded(scrollableElement, element) {
    var scrollableRect = scrollableElement.getBoundingClientRect();
    var elementRect = element.getBoundingClientRect();
    if (elementRect.height >= scrollableRect.height) {
        // Show start of line if it does not fit.
        scrollableElement.scrollTop += elementRect.top - scrollableRect.top;
    } else if (elementRect.top < scrollableRect.top || elementRect.bottom > scrollableRect.bottom) {
        // Vertically center otherwise.
        scrollableElement.scrollTop +=
            elementRect.top - scrollableRect.top +
            elementRect.height / 2 - scrollableRect.height / 2;
    }
}

function escapeHTML(string, useAsAttribute) {
    string = string
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    if (useAsAttribute)
        string = string
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    return string;
}


function renderPanelResizer() {
    var leftPanel = document.getElementById('left-panel');
    var rightPanel = document.getElementById('right-panel');
    var resizer = document.createElement('div');
    var rightPanelPadding = parseFloat(getComputedStyle(rightPanel).paddingLeft);
    rightPanelPadding = (rightPanelPadding - leftPanel.offsetWidth) || 0;
    var oldX;
    var width;
    var TOGGLED_CLASS = 'toggled';

    var toggler = document.createElement('div');
    toggler.className = 'toggler';
    toggler.addEventListener('click', function(e) {
        e.stopPropagation();
        leftPanel.classList.toggle(TOGGLED_CLASS);
        dispatchPanelSizeChange();
    });
    rightPanel.classList.add('toggleable');

    resizer.className = 'resizer';
    resizer.addEventListener('mousedown', function(e) {
        if (leftPanel.classList.contains(TOGGLED_CLASS)) return;
        e.preventDefault();
        oldX = e.clientX;
        width = leftPanel.offsetWidth;
        window.addEventListener('mousemove', resizeHandler);
        window.addEventListener('mouseup', function(e) {
            window.removeEventListener('mousemove', resizeHandler);
        });
    });
    resizer.appendChild(toggler);
    leftPanel.appendChild(resizer);

    function resizeHandler(e) {
        var newWidth = width + (e.clientX - oldX);
        if (newWidth < 0) {
            if (width > 0)
                newWidth = 0;
            else
                return;
        }
        var newWidthPx = newWidth + 'px';
        if (leftPanel.style.width === newWidthPx) return;
        leftPanel.style.width = newWidthPx;
        rightPanel.style.paddingLeft = (newWidth + rightPanelPadding) + 'px';
        dispatchPanelSizeChange();
    }
    function dispatchPanelSizeChange() {
        // Generate an artificial resize event so that the code editor
        // re-measures its layout.
        window.dispatchEvent(new CustomEvent('resize'));
    }
}

var checkAndApplyFilter = (function() {
    var filteredFilenames = [];
    // Filter for file names
    function applyFilter(/*regex*/pattern) {
        var CLASS_FILTERED = 'file-filtered';
        var fileList = document.getElementById('file-list');
        var listItems = fileList.querySelectorAll('li[data-filename]');
        filteredFilenames.length = 0;
        for (var i = 0; i < listItems.length; ++i) {
            var listItem = listItems[i];
            var filename = listItem.dataset.filename;
            if (pattern.test(filename)) {
                listItem.classList.remove(CLASS_FILTERED);
            } else {
                listItem.classList.add(CLASS_FILTERED);
                filteredFilenames.push(filename);
            }
        }
        renderTotalFileSize();
    }
    // Filter on files containing |searchTerm|. See search-worker.js for the algorithm.
    function grepSearch(searchTerm) {
        if (!textSearchEngine) {
            return;
        }
        textSearchEngine.setResultCallback(function(filenames, found) {
            var listItems = document.querySelectorAll('#file-list li[data-filename]');
            for (var i = 0; i < listItems.length; ++i) {
                var listItem = listItems[i];
                if (filenames !== null && filenames.indexOf(listItem.dataset.filename) === -1) {
                    continue;
                }
                listItem.classList.toggle('grep-unknown', found === null);
                listItem.classList.toggle('grep-no-match', found === false);
            }
            renderTotalFileSize();
        });
        textSearchEngine.doPlaintextSearch(searchTerm, filteredFilenames);
    }
    function parseApiSearch(searchTerm) {
        var match = /^api:(.*)$/i.exec(searchTerm);
        if (!match) {
            return null;
        }
        var apiPath = match[1].trim().replace(/^(?:browser|chrome)\./i, '');
        if (!/^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.test(apiPath)) {
            throw new Error('Use api:namespace[.method], for example api:tabs.query');
        }
        var propertyAccess = apiPath.split('.').map(function(property) {
            property = property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            // Match dot access, optional chaining, and quoted bracket access.
            return '(?:\\?\\.\\s*' + property + '|\\.\\s*' + property +
                '|\\[\\s*["\']' + property + '["\']\\s*\\])';
        }).join('');
        // Match both Firefox's browser.* and Chrome's chrome.* namespace.
        return 'iregexp:\\b(?:browser|chrome)\\s*' + propertyAccess + '(?![\\w$])';
    }
    function renderTotalFileSize() {
        var listItems = document.querySelectorAll('#file-list li[data-filename]:not(.file-filtered):not(.grep-no-match)');
        var totalUncompressedSize = 0;
        for (var i = 0; i < listItems.length; ++i) {
            var listItem = listItems[i];
            if (listItem.gtypefiltered) continue;
            totalUncompressedSize += listItem.zipEntry.uncompressedSize;
        }
        var totalSizeElem = document.getElementById('total-size');
        // parentNode = .total-size-wrapper
        totalSizeElem.parentNode.hidden = totalUncompressedSize === 0;
        totalSizeElem.title = 'Total size: ' + formatByteSize(totalUncompressedSize) + ' bytes';
        totalSizeElem.textContent = formatByteSizeSuffix(totalUncompressedSize);
        updateFileTree();
    }
    var debounceGrep;
    function checkAndApplyFilter(shouldDebounce) {
        var fileFilterElem = document.getElementById('file-filter');
        var feedback = document.getElementById('file-filter-feedback');
        var pattern = fileFilterElem.value;
        var grepTerm = '';

        // Allow ! to be escaped if a user really wants to look for a ! in the filename.
        var i = -1;
        exclamation_search_loop: while ((i = pattern.indexOf('!', i + 1)) != -1) {
            // (?! is a negative look-ahead, don't treat it as a search either.
            if (pattern.substring(i - 2, i) != '(?') {
                // Allow '!' to be escaped. Note that in a RegExp, '\!' is identical to '!', so we
                // don't have to worry about changing semantics by requiring ! to be escaped to
                // disable search.
                for (var j = i; j > 0 && pattern.charAt(j - 1) === '\\'; --j);
                if ((j - i) % 2 === 0) {
                    // An unescaped !. Let's treat this as the delimiter for grep.
                    grepTerm = pattern.slice(i + 1);
                    pattern = pattern.slice(0, i);
                    break exclamation_search_loop;
                }
            }
        }

        try {
            var apiSearchTerm = parseApiSearch(grepTerm);
            if (apiSearchTerm !== null) {
                grepTerm = apiSearchTerm;
                if (!pattern.trim()) {
                    // With no explicit filename filter, limit API searches to
                    // common source files instead of matching docs and assets.
                    pattern = '\\.(?:[cm]?js|jsx|tsx?|html?)$';
                }
            }
            TextSearchEngine.parsePatternAsRegExp(grepTerm);
        } catch (e) {
            fileFilterElem.classList.add('invalid');
            feedback.textContent = 'Search: ' + e.message;
            return;
        }

        try {
            pattern = new RegExp(pattern, 'i');
            feedback.textContent = '';
            fileFilterElem.classList.remove('invalid');
        } catch (e) {
            fileFilterElem.classList.add('invalid');
            // Strip Regexp, the user can see it themselves..
            // Invalid regular expression: /..pattern.../ : blablabla
            feedback.textContent = (e.message+'').replace(': /' + pattern + '/i', '').replace(': /' + pattern + '/', '');
            return;
        }
        applyFilter(pattern);

        clearTimeout(debounceGrep);
        if (shouldDebounce && !debounceGrep) {
            debounceGrep = setTimeout(function() {
                debounceGrep = null;
                grepSearch(grepTerm);
            }, 300);
        } else {
            debounceGrep = null;
            grepSearch(grepTerm);
        }
    }
    (function() {
        // Bind to checkbox filter
        var storageArea = chrome.storage.sync;

        var FILTER_STORAGE_PREFIX = 'filter-';
        var fileList = document.getElementById('file-list');
        var checkboxes = document.querySelectorAll('input[data-filter-type]');

        if (!checkboxes.length) return;
        // In Firefox, checkbox elements don't respect width/height style for checkbox.
        // Resize it if needed.
        var checkbox = checkboxes[0];
        var elementOnSameLine = checkbox.parentNode.querySelector('.gcount');
        var actualHeight = checkbox.getBoundingClientRect().height;
        var expectedHeight = elementOnSameLine.getBoundingClientRect().height;
        var scaleFactor = 1;
        if (actualHeight && expectedHeight && actualHeight !== expectedHeight) {
            scaleFactor = expectedHeight / actualHeight;
        }
        [].forEach.call(checkboxes, function(checkbox) {
            if (scaleFactor !== 1) {
                checkbox.style.transformOrigin = '0 0';
                checkbox.style.transform = 'scale(' + scaleFactor + ')';
            }
            var storageKey = FILTER_STORAGE_PREFIX + checkbox.dataset.filterType;
            checkbox.checked = localStorage.getItem(storageKey) !== '0';
            checkbox.onchange = function() {
                var items = {};
                items[storageKey] = checkbox.checked;
                storageArea.set(items);
                updateFileListView();
            };
                storageArea.get(storageKey, function(items) {
                    checkbox.checked = items[storageKey] !== false;
                    updateFileListView();
                });
            function updateFileListView() {
                fileList.classList.toggle('gfilter-' + checkbox.dataset.filterType, !checkbox.checked);
                // Save filter state for renderTotalFileSize.
                var gtypefiltered = !checkbox.checked;
                [].forEach.call(fileList.querySelectorAll('li.gtype-' + checkbox.dataset.filterType), function(li) {
                    li.gtypefiltered = gtypefiltered;
                });
                renderTotalFileSize();
            }
        });
    })();
    // Bind event
    var fileFilterElem = document.getElementById('file-filter');
    fileFilterElem.addEventListener('input', function() {
        checkAndApplyFilter(true);
    });
    fileFilterElem.addEventListener('change', function() {
        updateUrlWithSearchQuery(this.value);
    });

    function updateUrlWithSearchQuery(query) {
        // Do not update the URL if we are in a permalink view.
        if (getParam('qf') || getParam('qb') || getParam('qh') || getParam('qi')) {
            return;
        }
        var params = {};
        var addonUrl = getParam('url');
        if (!addonUrl) {
          // url param may be missing if the user has not opened any file, or
          // if the file picker was used. A permalink would not work for these.
          return;
        }
        params.url = addonUrl;
        var blob = getParam('blob');
        if (blob) params.blob = blob;
        var inside = getParam('inside[]');
        if (inside) params.inside = inside;

        if (query) {
            params.q = query;
        }
        var newUrl = location.pathname + '?' + encodeQueryString(params);
        history.replaceState(null, '', newUrl);
    }
    fileFilterElem.form.onsubmit = function(e) {
        e.preventDefault();
        checkAndApplyFilter();
    };

    return checkAndApplyFilter;
})();
// Go load the stuff
initialize();
function initialize() {
    initializeApiReportPanel();
    initializeLocaleCoveragePanel();
    if (getParam('noview')) {
        showAdvancedOpener();
        return;
    }
    var addon_url = getParam('url');
    var blob_url = getParam('blob');
    if (!addon_url && !blob_url) {
        showAdvancedOpener();
        return;
    }
    var listing_url = addon_url && get_listing_url(addon_url);
    // Only consider rewriting the URL if it is not a known add-on download.
    if (!is_addon_download_url(addon_url)) {
        if (is_listing_url(addon_url)) {
            // Prefer given URL because its slug contains an extra human-readable short name.
            listing_url = addon_url;
        }
        // This is a no-op if the URL is not recognized.
        addon_url = get_addon_download_url(listing_url || addon_url);
    }
    if (listing_url) {
        var listing_link = document.getElementById('listing-link');
        listing_link.href = listing_url;
        listing_link.title = listing_url;
    }
    var inside = getParam('inside[]');
    var zipname = getParam('zipname');

    // blob:-URL without inside parameter = looking inside an (embedded) zip file for which we don't
    // have a URL, e.g. a file selected via <input type=file>
    if (!inside.length && blob_url) {
        loadCachedUrlInViewer(blob_url, addon_url || zipname || blob_url, function(blob) {
            openAddonInViewer(addon_url, zipname, blob);
        }, function() {
            if (addon_url) {
                openAddonInViewer(addon_url, zipname);
            } else {
                var progressDiv = document.getElementById('initial-status');
                progressDiv.textContent = 'Cannot open ' + (zipname || blob_url);
                appendFileChooser();
            }
        });
        return;
    }
    if (addon_url && inside.length) {
        openEmbeddedZipFile(addon_url, inside, blob_url);
        return;
    }

    // Plain and simple: Open the add-on at the given URL.
    openAddonInViewer(addon_url, zipname);
}

function showAdvancedOpener() {
    var advancedOpenView = document.getElementById('advanced-open');
    var openForm = document.getElementById('advanced-open-form');
    var amoOptions = document.getElementById('advanced-open-amo-extension');
    var urlInput = openForm.querySelector('input[type=url]');
    var fileInput = openForm.querySelector('input[type=file]');
    // Fills in the add-on slug when a URL of addons.mozilla.org is entered.
    function maybeFillAmoForm() {
        var amoslug = get_amo_slug(urlInput.value);
        var maybeXpi = /\.xpi([?#&]|$)|\.mozilla\./i.test(urlInput.value) || !!amoslug;
        if (amoslug) {
            amoOptions.querySelector('input[name="amoslugorid"]').value = amoslug;
        }
        amoOptions.classList.toggle('disabled-site', !maybeXpi && !!urlInput.value);
    }
    function closeViewAndOpenAddonUrl(addonUrl) {
        var url = location.pathname + '?' + encodeQueryString({
            url: addonUrl,
        });
        advancedOpenView.classList.remove('visible');
        // This open dialog only appears at the start of the page, and there is
        // no data to lose, so we just replace the current URL.
        history.replaceState(history.state, null, url);
        initialize();
    }

    openForm.onsubmit = function(e) {
        e.preventDefault();
        if (!urlInput.value) {
            if (fileInput.files[0]) {
                // Navigate back in history or just reloaded page.
                fileInput.onchange();
            }
            return;
        }
        closeViewAndOpenAddonUrl(urlInput.value);
    };
    amoOptions.onsubmit = function(e) {
        e.preventDefault();
        // Derive the AMO domain from the URL input if non-empty, otherwise try the url param.
        var amodomain = get_amo_domain(urlInput.value || getParam('url'));
        var amodescription = amoOptions.querySelector('.amodescription');
        var slugorid = amoOptions.querySelector('input[name="amoslugorid"]').value;
        amodescription.textContent = 'Searching for add-ons with slug or ID: ' + slugorid;
        var amoxpilist = amoOptions.querySelector('.amoxpilist');
        getXpis(amodomain, slugorid, 0, function(description, results, nextPage) {
            amodescription.textContent = description;
            if (results.length) {
                var a = document.createElement('a');
                a.href = 'https://' + amodomain + '/addon/' + slugorid;
                a.textContent = 'add-on listing';
                amodescription.appendChild(document.createTextNode(' ('));
                amodescription.appendChild(a);
                amodescription.appendChild(document.createTextNode(')'));
            }
            amoxpilist.textContent = '';
            appendResults(results);
            if (nextPage) {
                showMoreResultsPager(nextPage);
            }
        });

        function appendResults(results) {
            var fragment = document.createDocumentFragment();
            results.forEach(function(result) {
                var a = document.createElement('a');
                a.textContent = 'Version ' + result.version + ' (' + result.platform + '), ' + result.createdDate.toLocaleString();
                a.href = location.pathname + '?' + encodeQueryString({
                    url: result.url,
                });
                a.title = 'View source of ' + result.url;
                a.onclick = function(event) {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    closeViewAndOpenAddonUrl(result.url);
                };
                var li = document.createElement('li');
                li.appendChild(a);
                fragment.appendChild(li);
            });
            amoxpilist.appendChild(fragment);
        }
        function showMoreResultsPager(page) {
            var li = document.createElement('li');
            var button = document.createElement('button');
            button.textContent = 'Show more versions from page ' + page;
            button.onclick = function(e) {
                e.preventDefault();
                button.disabled = true;
                getXpis(amodomain, slugorid, page, function(description, results, nextPage) {
                    if (!results.length) {
                        // Odd. The button should only be shown if there are more items.
                        // There might be an intermittent (network) error,
                        // so allow the user to retry the same action.
                        button.disabled = false;
                        return;
                    }
                    appendResults(results);
                    if (nextPage) {
                        // Replace button with page separator.
                        li.textContent = 'Results from page ' + page + ':';
                        showMoreResultsPager(nextPage);
                    } else {
                        li.remove();
                    }
                });
            };
            li.appendChild(button);
            amoxpilist.appendChild(li);
        }
    };
    function openLocalFile(file) {
        if (file) {
            advancedOpenView.classList.remove('visible');
            openAddonInViewer('', file.name, file);
        }
    }
    fileInput.onchange = function() {
        openLocalFile(fileInput.files[0]);
    };
    var fileDrop = document.getElementById('open-file-drop');
    fileDrop.onkeydown = function(e) {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            fileInput.click();
        }
    };
    // A file can be dropped anywhere on the page while this view is shown.
    // Elsewhere, Firefox would open (and offer to install) a dropped .xpi file.
    if (!showAdvancedOpener.hasDropListeners) {
        showAdvancedOpener.hasDropListeners = true;
        var isOpenViewShown = function(e) {
            return advancedOpenView.classList.contains('visible') &&
                e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') !== -1;
        };
        document.addEventListener('dragover', function(e) {
            if (!isOpenViewShown(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            fileDrop.classList.add('is-dragging');
        });
        document.addEventListener('dragleave', function(e) {
            if (!e.relatedTarget) fileDrop.classList.remove('is-dragging');
        });
        document.addEventListener('drop', function(e) {
            if (!isOpenViewShown(e)) return;
            e.preventDefault();
            fileDrop.classList.remove('is-dragging');
            openLocalFile(e.dataTransfer.files[0]);
        });
    }
    // From the toolbar popup's "Upload": Firefox closes the popup when a file
    // dialog opens, so the file is chosen here instead.
    var isUpload = !!getParam('upload');
    fileDrop.classList.toggle('is-highlighted', isUpload);

    urlInput.addEventListener('input', maybeFillAmoForm);
    urlInput.value = getParam('url') || '';
    maybeFillAmoForm();

    advancedOpenView.classList.add('visible');
    if (isUpload) {
        fileDrop.focus();
    }
}

// |addon_url| is the canonical representation (absolute URL) of the zip file.
// |inside| is the path to the file that we want to open. Every extra item is another level inside
// the zip file, e.g. ['foo.jar','bar.zip'] is the "bar.zip" file inside "foo.jar" inside |addon_url|.
// The list must contain at least one item.
// |blob_url| is the (ephemeral) URL of the Blob, used if possible.
function openEmbeddedZipFile(addon_url, inside, blob_url) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;

    var zipname = inside[inside.length - 1];

    loadCachedUrlInViewer(blob_url, zipname, function(blob) {
        openAddonInViewer(addon_url, zipname, blob);
    }, function() {
        progressDiv.textContent = 'Loading ' + zipname;
        loadUrlInViewer(addon_url, function(blob) {
            peekIntoZipUntilEnd(0, blob);
        });
    });

    function peekIntoZipUntilEnd(index, blob) {
        var human_readable_name = inside.slice(0, index + 1).reverse().join(' in ') + ' from ' + addon_url;
        var zipname = inside[index];

        zip.createReader(new zip.BlobReader(blob), function(zipReader) {
            zipReader.getEntries(function(entries) {
                var entry = entries.filter(function(entry) {
                    return entry.filename === zipname;
                })[0];
                if (!entry) {
                    progressDiv.textContent = 'Cannot open (did not find) ' + human_readable_name;
                    zipReader.close();
                    return;
                }
                entry.getData(new zip.BlobWriter(), function(blob) {
                    zipReader.close();
                    if (++index < inside.length) {
                        peekIntoZipUntilEnd(index, blob);
                    } else {
                        openAddonInViewer(addon_url, zipname, blob);
                    }
                }, function() {
                    progressDiv.textContent = 'Cannot read ' + human_readable_name;
                    zipReader.close();
                });
            });
        }, function(error) {
            progressDiv.textContent = 'Cannot open ' + human_readable_name + ' as a zip file: ' + error;
        });
    }
}

function appendFileChooser() {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.insertAdjacentHTML('beforeend',
            '<br><br>' +
            'Visit addons.mozilla.org or addons.thunderbird.net<br>' +
            'and click on the button in the address bar to view the source of an add-on.' +
            '<br><br>Or select a .xpi/.zip file:' +
            '<br><br>');
    var fileChooser = document.createElement('input');
    fileChooser.type = 'file';
    fileChooser.accept = '.xpi,.zip,.jar';
    fileChooser.onchange = function() {
        var file = fileChooser.files[0];
        if (file) openAddonInViewer('', file.name, file);
    };
    progressDiv.appendChild(fileChooser);

    progressDiv.insertAdjacentHTML('beforeend',
            '<br><br>' +
            'Or <a class="open-different-url">click here to find and open</a> a different URL.'
    );
    var openDifferentAnchor = progressDiv.querySelector('.open-different-url');
    openDifferentAnchor.href = 'viewer.html';
    var addon_url = window.addon_url || getParam('url');
    if (addon_url) {
        openDifferentAnchor.search = '?' + encodeQueryString({
            noview: 'on',
            url: addon_url,
        });
    }
    openDifferentAnchor.onclick = function(event) {
        if (event.button !== 0) return;
        event.preventDefault();
        showAdvancedOpener();
    };
}

// addon_url: full URL to the add-on (XPI) or zip file, may be an empty string.
// zipname: Preferred file name.
// addon_blob: Blob of the zip file.
// One (or both) of addon_url or addon_blob must be set.
function openAddonInViewer(addon_url, zipname, addon_blob) {
    // Now we have fixed the addon_url, update the global var.
    window.addon_url = addon_url;
    zipname = get_zip_name(addon_url, zipname);

    // We are switching from the initial view (selecting an add-on/zip)
    // to the next view (showing the contents of the add-on/zip file).
    // Show a link to open a new viewer, prepopulated with the current
    // settings to allow the user to modify one bit of the download.
    setViewerLink(addon_url);

    if (addon_blob) {
        handleBlob(zipname, addon_blob);
        return;
    }
    loadUrlInViewer(addon_url, function(blob) {
        handleBlob(zipname, blob);
    });
}

function loadCachedUrlInViewer(blob_url, human_readable_name, onHasBlob, onHasNoBlob) {
    if (!/^blob:/.test(blob_url)) {
        onHasNoBlob();
        return;
    }
    loadBlobUrlInViewer(blob_url, human_readable_name, onHasBlob, onHasNoBlob);
}

function loadBlobUrlInViewer(url, human_readable_name, onHasBlob, onHasNoBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + human_readable_name;

    try {
        var x = new XMLHttpRequest();
        x.open('GET', url);
        x.responseType = 'blob';
        x.onerror = function() {
            onHasNoBlob('Network error for ' + url);
        };
        x.onload = function() {
            if (x.status >= 400) {
                onHasNoBlob('Failed to load ' + url + '. Server responded with ' + x.status + ' ' + x.statusText);
            } else if (x.response && x.response.size) {
                onHasBlob(x.response);
            } else {
                onHasNoBlob('No response received for ' + url);
            }
        };
        x.send();
    } catch (e) {
        onHasNoBlob('The browser refused to load ' + url + ', ' + e);
    }
}

function loadUrlInViewer(addon_url, onHasBlob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = false;
    progressDiv.textContent = 'Loading ' + addon_url;

    openAddonAsZip(addon_url, onHasBlob, function(error_message) {
        progressDiv.textContent = error_message;
        appendFileChooser();
    }, progressEventHandler);

    function progressEventHandler(xhrProgressEvent) {
        if (xhrProgressEvent.lengthComputable) {
            var loaded = xhrProgressEvent.loaded;
            var total = xhrProgressEvent.total;
            progressDiv.textContent = 'Loading ' + addon_url;
            var progress = document.createElement('progress');
            progress.max = total;
            progress.value = loaded;
            progressDiv.append(document.createElement('br'), document.createElement('br'),
                formatByteSize(loaded) + ' / ' + formatByteSize(total),
                document.createElement('br'), progress);
        } else {
            progressDiv.textContent = 'Loading ' + addon_url;
            progressDiv.append(document.createElement('br'), document.createElement('br'),
                'Loaded bytes: ' + formatByteSize(xhrProgressEvent.loaded) + ' (total size unknown)');
        }
    }
}

function handleBlob(zipname, blob) {
    var progressDiv = document.getElementById('initial-status');
    progressDiv.hidden = true;

    setBlobAsDownload(zipname, blob);
    textSearchEngine = new TextSearchEngine(blob);
    // Identifies the archive, e.g. to keep review notes per add-on file (main-view.js).
    ZenFiles.setArchiveBlob(blob);

    zip.createReader(new zip.BlobReader(blob), function(zipReader) {
        renderPanelResizer();
        zipReader.getEntries(function(entries) {
            archiveEntries = entries;
            addedEntries.clear();
            replacedEntries.clear();
            handleZipEntries(entries);
        });
    }, function(error) {
        progressDiv.textContent = 'Cannot open ' + (zipname || ' this file') + ' as a zip file: ' + error;
        appendFileChooser();
    });
}

if (typeof URL === 'undefined') window.URL = window.webkitURL;
function setViewerLink(addon_url) {
    var viewerUrl = 'viewer.html';

    if (addon_url) {
        viewerUrl += '?' + encodeQueryString({
            noview: 'on',
            url: addon_url,
        });
    }

    // Compare this add-on with another version (compare.html).
    var compareLink = document.getElementById('compare-link');
    compareLink.href = 'compare.html' + (addon_url ? '?' + encodeQueryString({old: addon_url}) : '');

    var link = document.getElementById('open-viewer');
    link.href = viewerUrl;
    link.title = 'View the source of another extension or zip file';

}
function setBlobAsDownload(zipname, blob) {
    var dl_link = document.getElementById('download-link');
    dl_link.href = URL.createObjectURL(blob);
    dl_link.download = zipname;
    dl_link.title = 'Download zip file as ' + zipname + ' (' + formatByteSize(blob.size) + ' bytes)';
}
