/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code,
 * and Chrome Web Store, Edge and Opera add-on sites); replaced the address bar button (page action),
 * which was only shown on add-on sites, with a toolbar button that works on every page; added
 * opening of files chosen in the popup; requests are handled only with privacy consent, and the consent page opens on install. */

/* jshint esversion:6 */
/* globals chrome, encodeQueryString, ZenConsent */

'use strict';

// Privacy consent: without consent to the current policy version
// (privacy-policy.json) the add-on does nothing. Pages are blocked by
// consent-gate.js; here, messages are ignored and the consent page is opened.
chrome.runtime.onInstalled.addListener(() => {
    // On install, and on updates that raise the policy version.
    ZenConsent.hasConsent().then((ok) => {
        if (!ok) chrome.tabs.create({url: ZenConsent.consentPageUrl()});
    });
});

chrome.runtime.onMessage.addListener((msg, sender) => {
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
 * Opens a file (an .xpi or .zip chosen in the popup) in a new viewer tab.
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
