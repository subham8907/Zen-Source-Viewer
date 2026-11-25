/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and Chrome Web Store, Edge and Opera add-on sites); replaced the address bar button (page action),
 * which was only shown on add-on sites, with a toolbar button that works on every page; added
 * opening of files chosen in the popup; requests are handled only with privacy consent, and the consent page opens on install.
 * Blocks the add-on's own requests to add-on sites the user turned off.
 * Files chosen in the popup may also be CRX files.
 * Keeps the add-on's downloads on https (insecure http redirects are upgraded, e.g. for Edge Add-ons). */

/* jshint esversion:6 */
/* globals chrome, encodeQueryString, ZenConsent, ZenStoreDomains, secure_download_url, SECURE_ALTERNATIVE_HOSTS */

'use strict';

// Resolve automatic appearance in one context so popup windows, tabs and
// embedded extension pages agree even when their own media queries differ.
var systemAppearance = window.matchMedia('(prefers-color-scheme: dark)');
function currentSystemAppearance() {
    return systemAppearance.matches ? 'dark' : 'light';
}
function publishSystemAppearance() {
    chrome.storage.local.set({appearanceSystemTheme: currentSystemAppearance()});
}
systemAppearance.addEventListener('change', publishSystemAppearance);
publishSystemAppearance();

// Privacy consent: without consent to the current policy version
// (privacy-policy.json) the add-on does nothing. Pages are blocked by
// consent-gate.js; here, messages are ignored and the consent page is opened.
chrome.runtime.onInstalled.addListener(() => {
    // On install, and on updates that raise the policy version.
    ZenConsent.hasConsent().then((ok) => {
        if (!ok) chrome.tabs.create({url: ZenConsent.consentPageUrl()});
    });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    // Presentation remains available on consent and privacy pages.
    if (msg && msg.action === 'getAppearanceSystemTheme') {
        sendResponse({theme: currentSystemAppearance()});
        return;
    }
    ZenConsent.hasConsent().then((ok) => {
        if (ok) {
            handleMessage(msg, sender);
        } else {
            chrome.tabs.create({url: ZenConsent.consentPageUrl()});
        }
    });
});

function handleMessage(msg, sender) {
    if (msg && msg.action === "downloadBlob") {
        chrome.downloads.download({
            url: URL.createObjectURL(msg.blob),
            filename: msg.filename,
            incognito: msg.incognito,
        });
    } else if (msg && msg.action === "openFileInViewer") {
        openFileInViewer(msg);
    }
}

/**
 * Opens a file (an .xpi, .crx or .zip chosen in the popup) in a new viewer tab.
 *
 * The popup closes when the new tab opens, so the file is kept here as a
 * blob: URL, which the viewer loads (see `blob` in viewer.js). The file stays
 * on the device: blob: URLs only exist in this browser.
 */
function openFileInViewer(msg) {
    var blobUrl = URL.createObjectURL(msg.blob);
    chrome.tabs.create({
        url: chrome.runtime.getURL('viewer.html') + '?' + encodeQueryString({
            blob: blobUrl,
            zipname: msg.name,
        }),
        active: true,
        windowId: msg.windowId,
        index: msg.index,
        cookieStoreId: msg.cookieStoreId,
    });
    // The viewer reads the file right after it opens.
    setTimeout(function() {
        URL.revokeObjectURL(blobUrl);
    }, 60000);
}

// Add-on sites turned off in Settings are never contacted: cancel any request
// that this add-on makes to them, including redirects (e.g. from a download
// link to a site's file server). Requests made by web pages are not affected.
var storeRequestListener = null;
function blockTurnedOffStores() {
    if (storeRequestListener) {
        chrome.webRequest.onBeforeRequest.removeListener(storeRequestListener);
    }
    storeRequestListener = function(details) {
        var origin = details.originUrl || details.documentUrl || '';
        if (!origin.startsWith(location.origin + '/')) return;
        if (ZenStoreDomains.blockedReason(details.url)) return {cancel: true};
    };
    chrome.webRequest.onBeforeRequest.addListener(storeRequestListener,
        {urls: ZenStoreDomains.knownHostPatterns()}, ['blocking']);
}
blockTurnedOffStores();
ZenStoreDomains.onChange(blockTurnedOffStores);

// Downloads stay on https, for every store and site: when the add-on's own
// download is redirected from https:// to http://, which browsers block, the
// redirect is upgraded to https:// (or to a known secure alternative host,
// see SECURE_ALTERNATIVE_HOSTS in addon-urls.js, e.g. for Microsoft Edge
// Add-ons). Requests made by web pages are not affected.
function isOwnRequest(details) {
    var origin = details.originUrl || details.documentUrl || '';
    return origin.startsWith(location.origin + '/');
}
chrome.webRequest.onHeadersReceived.addListener(function(details) {
    if (!isOwnRequest(details) || details.statusCode < 300 || details.statusCode > 399) return;
    var fromHttps = /^https:/i.test(details.url);
    var changed = false;
    details.responseHeaders.forEach(function(header) {
        if (header.name.toLowerCase() !== 'location') return;
        var target;
        try {
            target = new URL(header.value, details.url).href;
        } catch (e) {
            return;
        }
        var secure = secure_download_url(target);
        // Upgrade a downgrade from https, and always use a secure alternative host.
        if (secure && (fromHttps || SECURE_ALTERNATIVE_HOSTS[new URL(target).hostname])) {
            header.value = secure;
            changed = true;
        }
    });
    if (changed) return {responseHeaders: details.responseHeaders};
}, {urls: ['<all_urls>'], types: ['xmlhttprequest']}, ['blocking', 'responseHeaders']);
// An address on a host without working https, entered or linked directly.
chrome.webRequest.onBeforeRequest.addListener(function(details) {
    if (!isOwnRequest(details)) return;
    var secure = secure_download_url(details.url);
    if (secure) return {redirectUrl: secure};
}, {urls: Object.keys(SECURE_ALTERNATIVE_HOSTS).map(function(host) { return '*://' + host + '/*'; }),
    types: ['xmlhttprequest']}, ['blocking']);
