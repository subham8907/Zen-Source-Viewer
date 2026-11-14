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
 * Privacy consent gate. Must be the FIRST script in the <head> of every page
 * of the add-on (except consent.html, privacy.html and license.html).
 *
 * It runs before anything else on the page. Without consent to the current
 * policy version (privacy-policy.json), it stops loading the page, so none of
 * the page's other scripts run, and opens consent.html instead. After the user
 * agrees, consent.html reopens the page.
 *
 * Keep the keys in sync with consent-state.js. */

/* jshint browser:true */
/* globals chrome */
'use strict';

(function() {
    var STORAGE_KEY = 'privacyConsent';
    var CACHE_KEY = 'privacyConsentVersion';

    // Synchronous on purpose: the page must not continue before we know.
    function readRequiredVersion() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', chrome.runtime.getURL('privacy-policy.json'), false);
            xhr.overrideMimeType('application/json');
            xhr.send();
            var version = JSON.parse(xhr.responseText).version;
            if (version === undefined || version === null || String(version) === '') return null;
            return String(version);
        } catch (e) {
            return null;
        }
    }

    function readCachedVersion() {
        try {
            return localStorage.getItem(CACHE_KEY);
        } catch (e) {
            return null;
        }
    }

    var blocked = false;
    function block() {
        if (blocked) return;
        blocked = true;
        // Stop parsing the page: scripts after this one never run.
        window.stop();
        document.documentElement.style.display = 'none';
        location.replace(chrome.runtime.getURL('consent.html') + '?' +
            new URLSearchParams({return: location.href}));
    }

    var required = readRequiredVersion();
    // Fail closed: no policy version or no consent = blocked.
    if (!required || readCachedVersion() !== required) {
        block();
        return;
    }

    // localStorage is only a fast copy; storage.local is the record. Check it
    // too, and close the page if consent was withdrawn (now or later).
    function isValid(consent) {
        return !!consent && String(consent.version) === required;
    }
    chrome.storage.local.get(STORAGE_KEY, function(items) {
        if (!isValid(items && items[STORAGE_KEY])) {
            try { localStorage.removeItem(CACHE_KEY); } catch (e) {}
            block();
        }
    });
    chrome.storage.onChanged.addListener(function(changes, areaName) {
        if (areaName === 'local' && changes[STORAGE_KEY] && !isValid(changes[STORAGE_KEY].newValue)) {
            block();
        }
    });
})();
