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
 * Shared appearance preference for every extension page. The cached choice
 * is applied in the head before paint; storage.sync keeps open pages and
 * future popups in sync. The background page resolves System mode once for
 * all contexts, including popup windows and embedded policy frames.
 */

/* jshint browser:true, esversion:6 */
/* globals chrome */
'use strict';

(function() {
    var STORAGE_KEY = 'appearanceTheme';
    var CACHE_KEY = 'zen-appearance-theme';
    var SYSTEM_KEY = 'appearanceSystemTheme';
    var SYSTEM_CACHE_KEY = 'zen-appearance-system';
    var systemTheme = window.matchMedia('(prefers-color-scheme: dark)');
    var preference = 'system';
    var resolvedSystem = systemTheme.matches ? 'dark' : 'light';
    try {
        var cachedSystem = localStorage.getItem(SYSTEM_CACHE_KEY);
        if (cachedSystem === 'light' || cachedSystem === 'dark') resolvedSystem = cachedSystem;
    } catch (e) {}
    var revision = 0;

    function normalize(value) {
        return value === 'light' || value === 'dark' ? value : 'system';
    }

    function updateControls() {
        document.querySelectorAll('[data-theme-option]').forEach(function(button) {
            button.setAttribute('aria-pressed', String(button.dataset.themeOption === preference));
        });
        document.querySelectorAll('[data-theme-select]').forEach(function(select) {
            select.value = preference;
        });
    }

    function apply(value) {
        preference = normalize(value);
        document.documentElement.dataset.themePreference = preference;
        document.documentElement.dataset.theme = preference === 'system' ?
            resolvedSystem : preference;
        try { localStorage.setItem(CACHE_KEY, preference); } catch (e) {}
        updateControls();
    }

    function applySystem(value) {
        if (value !== 'light' && value !== 'dark') return;
        resolvedSystem = value;
        try { localStorage.setItem(SYSTEM_CACHE_KEY, value); } catch (e) {}
        if (preference === 'system') apply(preference);
    }

    function refreshSystem() {
        chrome.runtime.sendMessage({action: 'getAppearanceSystemTheme'}, function(result) {
            // A background page is the common authority: Firefox can report
            // different media-query values in popups, tabs and nested frames.
            if (!chrome.runtime.lastError && result) applySystem(result.theme);
        });
    }

    function showStatus(message) {
        document.querySelectorAll('[data-theme-status]').forEach(function(status) {
            status.textContent = message;
        });
    }

    function choose(value) {
        var previous = preference;
        var choiceRevision = ++revision;
        apply(value);
        showStatus('');
        chrome.storage.sync.set({[STORAGE_KEY]: preference}, function() {
            if (chrome.runtime.lastError && revision === choiceRevision) {
                apply(previous);
                showStatus('Could not save appearance. Please try again.');
            }
        });
    }

    // Read the cache synchronously so opening a dark popup never flashes light.
    try { preference = normalize(localStorage.getItem(CACHE_KEY)); } catch (e) {}
    apply(preference);

    var initialRevision = revision;
    chrome.storage.sync.get({[STORAGE_KEY]: 'system'}, function(items) {
        if (!chrome.runtime.lastError && revision === initialRevision) {
            apply(items && items[STORAGE_KEY]);
        }
    });
    chrome.storage.onChanged.addListener(function(changes, area) {
        if (area === 'local' && changes[SYSTEM_KEY]) applySystem(changes[SYSTEM_KEY].newValue);
        if (area === 'sync' && changes[STORAGE_KEY]) {
            revision++;
            apply(changes[STORAGE_KEY].newValue);
            showStatus('');
        }
    });
    window.addEventListener('storage', function(event) {
        if (event.key === SYSTEM_CACHE_KEY) applySystem(event.newValue);
        if (event.key === CACHE_KEY) {
            revision++;
            apply(event.newValue);
        }
    });
    systemTheme.addEventListener('change', refreshSystem);
    refreshSystem();

    function bindControls() {
        document.querySelectorAll('[data-theme-option]').forEach(function(button) {
            button.addEventListener('click', function() { choose(button.dataset.themeOption); });
        });
        document.querySelectorAll('[data-theme-select]').forEach(function(select) {
            select.addEventListener('change', function() { choose(select.value); });
        });
        updateControls();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindControls);
    else bindControls();
})();
