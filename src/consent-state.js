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
 * Privacy consent: which policy version the user agreed to.
 *
 * The required version is "version" in privacy-policy.json. Raise it when
 * PRIVACY.md changes in a way users must agree to again: everyone is then asked
 * again, and the add-on does nothing until they agree (see consent-gate.js).
 *
 * The consent is stored in storage.local (the record) and copied to
 * localStorage, which consent-gate.js can read synchronously. */

/* jshint browser:true, esversion:6 */
/* globals chrome */
/* exported ZenConsent */
'use strict';

var ZenConsent = (function() {
    var STORAGE_KEY = 'privacyConsent';
    var CACHE_KEY = 'privacyConsentVersion';

    // Resolves to the required policy version (a string).
    function getRequiredVersion() {
        return fetch(chrome.runtime.getURL('privacy-policy.json'))
            .then(function(response) { return response.json(); })
            .then(function(config) {
                if (config.version === undefined || config.version === null || String(config.version) === '') {
                    throw new Error('privacy-policy.json has no version');
                }
                return String(config.version);
            });
    }

    // Resolves to the stored consent ({version, acceptedAt}) or null.
    function getConsent() {
        return new Promise(function(resolve) {
            chrome.storage.local.get(STORAGE_KEY, function(items) {
                resolve(items && items[STORAGE_KEY] || null);
            });
        });
    }

    // Resolves to {required, consent, ok}. ok is false on any error.
    function check() {
        return Promise.all([getRequiredVersion(), getConsent()]).then(function(results) {
            var required = results[0], consent = results[1];
            var ok = !!consent && String(consent.version) === required;
            setCache(ok ? required : null);
            return {required: required, consent: consent, ok: ok};
        }, function(error) {
            console.error('Privacy consent check failed', error);
            setCache(null);
            return {required: null, consent: null, ok: false};
        });
    }

    function hasConsent() {
        return check().then(function(result) { return result.ok; });
    }

    function setCache(version) {
        try {
            if (version) localStorage.setItem(CACHE_KEY, version);
            else localStorage.removeItem(CACHE_KEY);
        } catch (e) {
            // localStorage is not available (e.g. disabled); the gate then
            // sends every page through consent.html, which still works.
        }
    }

    function accept(version) {
        var consent = {version: String(version), acceptedAt: new Date().toISOString()};
        return new Promise(function(resolve, reject) {
            chrome.storage.local.set({[STORAGE_KEY]: consent}, function() {
                if (chrome.runtime.lastError) {
                    reject(new Error(chrome.runtime.lastError.message));
                    return;
                }
                setCache(consent.version);
                resolve(consent);
            });
        });
    }

    function withdraw() {
        setCache(null);
        return new Promise(function(resolve) {
            chrome.storage.local.remove(STORAGE_KEY, resolve);
        });
    }

    // URL of the consent page; returnUrl is reopened after agreeing.
    function consentPageUrl(returnUrl) {
        var url = chrome.runtime.getURL('consent.html');
        if (returnUrl) url += '?' + new URLSearchParams({return: returnUrl});
        return url;
    }

    return {
        STORAGE_KEY: STORAGE_KEY,
        CACHE_KEY: CACHE_KEY,
        getRequiredVersion: getRequiredVersion,
        check: check,
        hasConsent: hasConsent,
        accept: accept,
        withdraw: withdraw,
        consentPageUrl: consentPageUrl,
    };
})();
