/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and Chrome/Edge/Opera CRX support); popup of a toolbar button that works on every page: shows the
 * add-on actions only on add-on pages, and can open a dropped .xpi/.zip file or a URL; "Upload" opens a viewer
 * tab to choose the file, because Firefox closes popups when a file dialog opens. */

/* jshint browser:true, devel:true */
/* globals chrome, get_addon_download_url, get_zip_name, can_view_addon_url, openAddonAsZip */
/* globals encodeQueryString, get_amo_slug */
'use strict';
var page_url;
var addon_url;
var filename;

// See bg-contextmenu for potential values, at MENU_ID_ACTION_MENU.
var gActionClickAction = 'popup';

initialize();

function initialize() {
    var storageIsReady = false;

    initOpenSection();

    // Is the current tab an add-on page (or add-on file)? Then show its actions.
    chrome.tabs.query({
        active: true,
        currentWindow: true
    }, function(tabs) {
        page_url = tabs[0] && tabs[0].url || '';
        if (!can_view_addon_url(page_url)) {
            document.getElementById('no-addon-hint').hidden = false;
            return;
        }
        addon_url = get_addon_download_url(page_url);
        filename = get_zip_name(addon_url);
        document.getElementById('this-page').hidden = false;
        var name = document.getElementById('page-name');
        name.textContent = get_amo_slug(page_url) || pageFileName(page_url) || filename;
        name.title = page_url;
        ready();
        if (storageIsReady) {
            ready2();
        }
    });
    chrome.storage.sync.get({
        actionClickAction: gActionClickAction,
    }, function(items) {
        gActionClickAction = items && items.actionClickAction || gActionClickAction;
        storageIsReady = true;
        if (addon_url) {
            ready2();
        }
    });
}

// The file name at the end of a URL, e.g. "foo.xpi".
function pageFileName(url) {
    try {
        return decodeURIComponent(new URL(url).pathname.split('/').pop());
    } catch (e) {
        return '';
    }
}

// ---- Open a file, a URL, or one of the add-on's pages

// Opens a page of this add-on in a new tab next to the current one.
function openTab(url) {
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        var tab = tabs && tabs[0];
        chrome.tabs.create({
            url: url,
            active: true,
            windowId: tab ? tab.windowId : undefined,
            index: tab ? tab.index + 1 : undefined,
            cookieStoreId: tab && tab.cookieStoreId,
        }, function() {
            window.close();
        });
    });
}

function showOpenError(message) {
    document.getElementById('open-error').textContent = message;
}

// Opens a file chosen or dropped in the popup in the viewer. The file is
// passed to the background page, because the popup closes when the viewer
// opens (see openFileInViewer in background.js).
function openFile(file) {
    if (!file) return;
    if (!/\.(xpi|zip|jar)$/i.test(file.name)) {
        showOpenError('\u201c' + file.name + '\u201d is not an .xpi or .zip file.');
        return;
    }
    showOpenError('');
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        var tab = tabs && tabs[0];
        chrome.runtime.sendMessage({
            action: 'openFileInViewer',
            blob: file,
            name: file.name,
            windowId: tab ? tab.windowId : undefined,
            index: tab ? tab.index + 1 : undefined,
            cookieStoreId: tab && tab.cookieStoreId,
        }, function() {
            void chrome.runtime.lastError;
            window.close();
        });
    });
}

function initOpenSection() {
    var drop = document.getElementById('drop');
    // Firefox closes the popup as soon as a file dialog opens, which would
    // lose the chosen file. So the file is chosen in a viewer tab instead.
    drop.onclick = function() {
        openTab(chrome.runtime.getURL('viewer.html') + '?upload=1');
    };
    // Files can be dropped anywhere on the popup.
    var dragDepth = 0;
    document.addEventListener('dragenter', function(e) {
        e.preventDefault();
        dragDepth++;
        drop.classList.add('dragover');
    });
    document.addEventListener('dragleave', function() {
        if (--dragDepth <= 0) {
            dragDepth = 0;
            drop.classList.remove('dragover');
        }
    });
    document.addEventListener('dragover', function(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
    });
    document.addEventListener('drop', function(e) {
        e.preventDefault();
        dragDepth = 0;
        drop.classList.remove('dragover');
        var files = e.dataTransfer.files;
        if (files && files.length) {
            openFile(files[0]);
            return;
        }
        // A dropped link, e.g. to an add-on page.
        var url = e.dataTransfer.getData('text/uri-list').split('\n')[0] || e.dataTransfer.getData('text/plain');
        if (url) openUrl(url.trim());
    });

    document.getElementById('url-form').onsubmit = function(e) {
        e.preventDefault();
        openUrl(this.url.value.trim());
    };

    Array.prototype.forEach.call(document.querySelectorAll('nav a[data-page]'), function(link) {
        link.onclick = function(e) {
            e.preventDefault();
            openTab(chrome.runtime.getURL(link.dataset.page));
        };
    });
}

function openUrl(url) {
    if (!/^https?:\/\//i.test(url)) {
        showOpenError('Enter a web address that starts with https:// or http://');
        return;
    }
    var downloadUrl = get_addon_download_url(url);
    openTab(chrome.runtime.getURL('viewer.html') + '?' + encodeQueryString({
        url: downloadUrl,
        zipname: get_zip_name(downloadUrl),
    }));
}

function ready() {
    document.getElementById('download').onclick = doDownload;
    document.getElementById('view-source').onclick = doViewSource;
    // When the settings have been read, ready2 will run to finish.
}
function ready2() {
    if (gActionClickAction == 'popup') {
        // Default action is keeping this popup open.
        // Nothing else left to do.
    } else if (gActionClickAction == 'download') {
        doDownload();
    } else if (gActionClickAction == 'view-source') {
        doViewSource();
        return;
    }
    showPermissionPromptIfMissingHostPermission();
}
function showPermissionPromptIfMissingHostPermission() {
    if (!addon_url.startsWith('http')) {
        return; // Permissions only needed and available for http(s).
    }
    var hostPermission = new URL(addon_url).origin + '/*';
    chrome.permissions.contains({ origins: [hostPermission] }, function(ok) {
        // The API will report OK if the user accepted the full permission
        // request, or manually specified a subset.
        if (!ok) {
            showPermissionPrompt();
        }
    });
}
function showPermissionPrompt() {
    var form = document.getElementById('permission_missing_form');
    form.hidden = false;
    form.onsubmit = function(e) {
        e.preventDefault();
        var permission = {
            origins: ['*://*/*']
        };
        chrome.permissions.request(permission, function(hasAccess) {
            if (hasAccess) {
                form.hidden = true;
            }
        });
    };
    form.onreset = function(e) {
        form.hidden = true;
    };
}
function alert(msg) {
    var dialog = document.createElement('dialog');
    dialog.style.whiteSpace = 'pre-wrap';
    dialog.style.wordBreak = 'break-all';
    dialog.textContent = msg;
    dialog.onclose = function() {
        dialog.remove();
    };
    var closeButton = document.createElement('button');
    closeButton.onclick = function() {
        dialog.close();
    };
    closeButton.textContent = 'OK';
    dialog.append(closeButton);
    document.body.append(dialog);
    dialog.showModal();
    showPermissionPromptIfMissingHostPermission();
}
var hasDownloadedOnce = false;
function doDownload() {
    if (hasDownloadedOnce) {
        console.log('Download is pending.');
        return;
    }
    openAddonAsZip(addon_url, function(blob) {
        tryTriggerDownload(blob, filename);
    }, function(errorMessage) {
        hasDownloadedOnce = false;
        document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
        console.error(errorMessage);
        alert('Error in Zen Source Viewer:\n\n' + errorMessage);
    }, onXHRprogress.bind(null, document.getElementById('download')));
    hasDownloadedOnce = true;
    document.getElementById('download').classList.toggle('downloading', hasDownloadedOnce);
}
function doViewSource() {
    chrome.tabs.query({
        active: true,
        lastFocusedWindow: true,
    }, function(tabs) {
        var tab = tabs && tabs[0];
        chrome.tabs.create({
            url: chrome.runtime.getURL('viewer.html') +
                '?' + encodeQueryString({url: addon_url, zipname: filename}),
            active: true,
            windowId: tab ? tab.windowId : undefined,
            index: tab ? tab.index + 1 : undefined,
            cookieStoreId: tab && tab.cookieStoreId,
        }, function() {
            window.close();
        });
    });
}
function onXHRprogress(progressContainer, xhrProgressEvent) {
    var progressBar = progressContainer.querySelector('progress');
    if (!progressBar) {
        progressBar = document.createElement('progress');
        progressContainer.appendChild(progressBar);
    }
    if (xhrProgressEvent.lengthComputable) {
        progressBar.max = xhrProgressEvent.total;
        progressBar.value = xhrProgressEvent.loaded;
    } else {
        progressBar.removeAttribute('value');
    }
}

function tryTriggerDownload(blob, filename) {
    // Use background to trigger download to avoid blob:-URL invalidation when
    // the popup is closed, see https://bugzil.la/2005952
    chrome.runtime.sendMessage({
        action: "downloadBlob",
        blob,
        incognito: chrome.extension.inIncognitoContext,
        filename: filename,
    }, function() {
        // The popup should have closed already, but if not, do it now.
        window.close();
    });
}
