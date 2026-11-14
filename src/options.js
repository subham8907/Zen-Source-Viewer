/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code); error text uses the theme color;
 * removed the address bar button setting (replaced by a toolbar button); added the Privacy section (withdraw privacy consent). */

/* jshint browser:true, devel:true */
/* globals chrome, ZenConsent */
'use strict'; 


var storageArea = chrome.storage.sync;
var contextmenuPatternsInput = document.getElementById('contextmenuPatterns');
document.getElementById('contextmenu').onchange = function() {
    storageArea.set({showContextMenu: this.checked});
    contextmenuPatternsInput.disabled = !this.checked;
};

contextmenuPatternsInput.oninput = function() {
    var patterns = [];
    var errorMsg = '';
    this.value.split('\n').every(function(line, i) {
        line = line.trim();
        if (!line) {
            return;
        }
        if (!/^(\*|https?|ftp|file|data):\/\/\*?[^/*]*\//.test(line)) {
            errorMsg = 'Invalid URL pattern at line ' + (i + 1) + ': ' + line;
            errorMsg += '\nPatterns must look like a URL and may contain at most one * (wildcard) as a subdomain, and any number of * in the path.';
            return;
        }
        patterns.push(line);
        return true;
    });

    var contextmenuPatternsOutput = document.getElementById('contextmenuPatternsOutput');
    contextmenuPatternsOutput.style.color = 'var(--danger)';
    if (errorMsg) {
        contextmenuPatternsOutput.textContent = 'URL patterns not applied; ' + errorMsg;
        return;
    }
    storageArea.set({contextmenuPatterns: patterns}, function() {
        if (chrome.runtime.lastError) {
            contextmenuPatternsOutput.textContent =
                'Failed to save URL patterns due to error: ' + chrome.runtime.lastError.message;
        } else {
            contextmenuPatternsOutput.style.color = '';
            contextmenuPatternsOutput.textContent =
                'Applied ' + patterns.length + ' URL patterns.';
        }
    });
};

storageArea.get({
    showContextMenu: true,
    contextmenuPatterns: [],
}, function(items) {
    document.getElementById('contextmenu').checked = items.showContextMenu;
    contextmenuPatternsInput.disabled = !items.showContextMenu;
    contextmenuPatternsInput.value = items.contextmenuPatterns.join('\n');
});

if (location.hash !== '#optionsV2') {
    // A normal options page, open links in the same tab.
    document.querySelector('base').remove();
}

// Privacy consent (see consent-state.js).
(function() {
    var summary = document.getElementById('consent-summary');
    var withdrawButton = document.getElementById('withdraw-consent');
    ZenConsent.check().then(function(result) {
        if (!result.ok) return; // consent-gate.js opens the consent page.
        var date = new Date(result.consent.acceptedAt);
        summary.textContent = 'You agreed to version ' + result.consent.version + ' of the privacy policy' +
            (isNaN(date) ? '' : ' on ' + date.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'})) +
            '. Withdrawing turns the add-on off until you agree again.';
    });
    withdrawButton.onclick = function() {
        if (!window.confirm('Withdraw your consent to the privacy policy? Zen Source Viewer stops working until you agree again.')) {
            return;
        }
        // consent-gate.js notices the change and opens the consent page.
        ZenConsent.withdraw();
    };
})();
