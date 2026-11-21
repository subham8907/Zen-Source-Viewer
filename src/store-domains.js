/**
 * Copyright 2026 Subham Mahesh
 *
 * Licensed under the File-Level Permissive License (FLPL), Version 1.0
 * (the "License"). You may copy and distribute this file, with or
 * without changes, only in compliance with the License. You may obtain
 * a copy of the License in the LICENSE.txt file accompanying this work.
 *
 * Unless required by applicable law or agreed to in writing, this file
 * is distributed under the License on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See
 * the License for the specific language governing permissions and
 * limitations under the License.
 *
 * The add-on sites (stores) that Zen Source Viewer may contact, and the
 * person's choice of which ones are turned on. Every site is off until the
 * person turns it on: they are asked right after agreeing to the privacy
 * policy (consent.html), and can change it in Settings. A site that is off is
 * never contacted: its pages are not recognized, its API is not called and
 * addresses on it (including its download servers) are refused.
 *
 * The choice is kept in storage.local (it never leaves the device) and copied
 * to localStorage so that pages can read it synchronously.
 *
 * Besides the Mozilla sites, the Chrome Web Store, Microsoft Edge Add-ons and
 * Opera add-ons are listed (group "chromium"), so extensions for Chromium-based
 * browsers (CRX files) can be opened from them too. They are off by default
 * like every other site.
 *
 * Sites the person adds can work like addons.mozilla.org ('firefox'), like
 * addons.thunderbird.net ('thunderbird'), or like a Chrome store ('crx'): a
 * site that serves CRX files and Chrome update files (update_url).
 *
 * Any site, built-in or added, can be removed from the list and restored later.
 * A removed built-in site stays known and off: it is still never contacted.
 * A removed added site is remembered only so that it can be restored.
 */

/* jshint browser:true, esversion:6 */
/* globals chrome */
/* exported ZenStoreDomains */
'use strict';

var ZenStoreDomains = (function() {
    var STORAGE_KEY = 'storeDomains';
    var CACHE_KEY = 'zen-store-domains';

    // The groups in which the built-in sites are shown (Settings, consent page).
    var GROUPS = [
        {id: 'mozilla', title: 'Mozilla sites'},
        {id: 'chromium', title: 'Chrome, Edge and Opera stores'},
    ];

    // Built-in sites: those run by Mozilla (and Thunderbird, a Mozilla
    // subsidiary), and the stores of Chromium-based browsers. "kind" tells how
    // the site works: 'firefox' and 'thunderbird' sites serve XPI files, the
    // 'chrome', 'edge' and 'opera' stores serve CRX files. "related" lists other
    // hosts the same site uses to serve files or API requests; they are allowed
    // only while the site is turned on.
    var BUILTIN = [
        {
            host: 'addons.mozilla.org',
            kind: 'firefox',
            name: 'Firefox Add-ons',
            operator: 'Mozilla',
            group: 'mozilla',
            defaultOn: false,
            related: ['services.addons.mozilla.org', 'addons.cdn.mozilla.net'],
        },
        {
            host: 'addons.thunderbird.net',
            kind: 'thunderbird',
            name: 'Thunderbird Add-ons',
            operator: 'Thunderbird (MZLA Technologies, a Mozilla subsidiary)',
            group: 'mozilla',
            defaultOn: false,
            related: [],
        },
        {
            host: 'addons.allizom.org',
            kind: 'firefox',
            name: 'Firefox Add-ons (staging, for testing)',
            operator: 'Mozilla',
            group: 'mozilla',
            defaultOn: false,
            related: [],
        },
        {
            host: 'addons-dev.allizom.org',
            kind: 'firefox',
            name: 'Firefox Add-ons (development, for testing)',
            operator: 'Mozilla',
            group: 'mozilla',
            defaultOn: false,
            related: ['addons-dev-cdn.allizom.org'],
        },
        {
            host: 'addons-stage.thunderbird.net',
            kind: 'thunderbird',
            name: 'Thunderbird Add-ons (staging, for testing)',
            operator: 'Thunderbird (MZLA Technologies, a Mozilla subsidiary)',
            group: 'mozilla',
            defaultOn: false,
            related: [],
        },
        {
            host: 'chromewebstore.google.com',
            kind: 'chrome',
            name: 'Chrome Web Store',
            operator: 'Google',
            group: 'chromium',
            defaultOn: false,
            // The old store address, the update server that serves the CRX
            // file, and the server it redirects to.
            related: ['chrome.google.com', 'clients2.google.com', 'clients2.googleusercontent.com'],
        },
        {
            host: 'microsoftedge.microsoft.com',
            kind: 'edge',
            name: 'Microsoft Edge Add-ons',
            operator: 'Microsoft',
            group: 'chromium',
            defaultOn: false,
            // The update server that serves the CRX file, and its file servers.
            related: ['edge.microsoft.com', 'msedgeextensions.sf.tlu.dl.delivery.mp.microsoft.com',
                'msedgeextensions.f.tlu.dl.delivery.mp.microsoft.com'],
        },
        {
            host: 'addons.opera.com',
            kind: 'opera',
            name: 'Opera add-ons',
            operator: 'Opera',
            group: 'chromium',
            defaultOn: false,
            // The download link redirects to Opera's file server.
            related: ['addons-extensions.operacdn.com'],
        },
    ];

    // {on: {host: Boolean}, custom: [{host, kind, on}], chosen: Boolean,
    //  removed: [host], removedCustom: [{host, kind}]}
    // "chosen" is true once the person has made a choice (after consent or in
    // Settings). "removed" lists built-in sites removed from the list;
    // "removedCustom" lists added sites that were removed, so they can be
    // restored.
    var state = emptyState();
    var listeners = [];
    var readyResolve;
    var readyPromise = new Promise(function(resolve) { readyResolve = resolve; });

    // The kinds of site a person can add.
    var CUSTOM_KINDS = ['firefox', 'thunderbird', 'crx'];
    function customKind(kind) {
        return CUSTOM_KINDS.indexOf(kind) !== -1 ? kind : 'firefox';
    }

    function emptyState() {
        return {on: {}, custom: [], chosen: false, removed: [], removedCustom: []};
    }

    function sanitize(value) {
        var result = emptyState();
        if (!value || typeof value !== 'object') return result;
        result.chosen = value.chosen === true;
        if (value.on && typeof value.on === 'object') {
            BUILTIN.forEach(function(site) {
                if (typeof value.on[site.host] === 'boolean') {
                    result.on[site.host] = value.on[site.host];
                }
            });
        }
        if (Array.isArray(value.custom)) {
            value.custom.forEach(function(entry) {
                var host = entry && normalizeHost(entry.host);
                if (!host || isBuiltinHost(host) || result.custom.some(function(c) { return c.host === host; })) {
                    return;
                }
                result.custom.push({
                    host: host,
                    kind: customKind(entry.kind),
                    on: entry.on !== false,
                });
            });
        }
        if (Array.isArray(value.removed)) {
            BUILTIN.forEach(function(site) {
                if (value.removed.indexOf(site.host) !== -1) result.removed.push(site.host);
            });
        }
        if (Array.isArray(value.removedCustom)) {
            value.removedCustom.forEach(function(entry) {
                var host = entry && normalizeHost(entry.host);
                if (!host || isBuiltinHost(host) ||
                    result.custom.some(function(c) { return c.host === host; }) ||
                    result.removedCustom.some(function(c) { return c.host === host; })) {
                    return;
                }
                result.removedCustom.push({host: host, kind: customKind(entry.kind)});
            });
        }
        return result;
    }

    function readCache() {
        try {
            var cached = localStorage.getItem(CACHE_KEY);
            if (cached) state = sanitize(JSON.parse(cached));
        } catch (e) {}
    }

    function writeCache() {
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(state));
        } catch (e) {}
    }

    function apply(value) {
        state = sanitize(value);
        writeCache();
        listeners.forEach(function(listener) {
            try { listener(); } catch (e) { console.error(e); }
        });
    }

    // Returns a lower-case host name, or '' if |input| is not a valid one.
    // Accepts "example.com" or a full URL such as "https://example.com/path".
    function normalizeHost(input) {
        if (typeof input !== 'string') return '';
        var value = input.trim().toLowerCase();
        if (!value) return '';
        if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = 'https://' + value;
        var host;
        try {
            host = new URL(value).hostname;
        } catch (e) {
            return '';
        }
        // A public host name: at least two labels, letters, digits and hyphens.
        if (!/^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(host)) {
            return '';
        }
        return host;
    }

    function isBuiltinHost(host) {
        return BUILTIN.some(function(site) { return site.host === host; });
    }

    function isRemoved(host) {
        return state.removed.indexOf(host) !== -1;
    }

    function builtinIsOn(site) {
        if (isRemoved(site.host)) return false;
        return typeof state.on[site.host] === 'boolean' ? state.on[site.host] : site.defaultOn;
    }

    // The sites in the list, built-in sites first:
    // [{host, kind, name, operator, group, builtin, removed, on}].
    function sites() {
        return allSites().filter(function(site) { return !site.removed; });
    }

    // The sites removed from the list, built-in sites first, so that they can
    // be restored. They are all off.
    function removedSites() {
        return allSites().filter(function(site) { return site.removed; }).concat(
            state.removedCustom.map(function(entry) {
                return {
                    host: entry.host,
                    kind: entry.kind,
                    name: entry.host,
                    operator: '',
                    group: '',
                    builtin: false,
                    removed: true,
                    on: false,
                };
            }));
    }

    // Every known site, including removed built-in sites (which stay off).
    function allSites() {
        return BUILTIN.map(function(site) {
            return {
                host: site.host,
                kind: site.kind,
                name: site.name,
                operator: site.operator,
                group: site.group,
                builtin: true,
                defaultOn: site.defaultOn,
                removed: isRemoved(site.host),
                on: builtinIsOn(site),
            };
        }).concat(state.custom.map(function(entry) {
            return {
                host: entry.host,
                kind: entry.kind,
                name: entry.host,
                operator: '',
                group: '',
                builtin: false,
                removed: false,
                on: entry.on,
            };
        }));
    }

    // Host names of the sites that are turned on, optionally only one kind.
    function enabledHosts(kind) {
        return sites().filter(function(site) {
            return site.on && (!kind || site.kind === kind);
        }).map(function(site) { return site.host; });
    }

    // Whether at least one site of this kind is turned on.
    function isKindOn(kind) {
        return enabledHosts(kind).length > 0;
    }

    // Every host that belongs to a known site (on or off), including the
    // reviewers.* subdomain of addons.mozilla.org-style sites and the related
    // download/API hosts.
    function hostsOf(site) {
        var builtin = BUILTIN.filter(function(b) { return b.host === site.host; })[0];
        var hosts = [site.host];
        if (site.kind === 'firefox' || site.kind === 'thunderbird') hosts.push('reviewers.' + site.host);
        return hosts.concat(builtin ? builtin.related : []);
    }

    // Match patterns for every host of every known site (on or off), e.g. to
    // watch requests to them.
    function knownHostPatterns() {
        var patterns = [];
        allSites().forEach(function(site) {
            hostsOf(site).forEach(function(host) {
                patterns.push('*://' + host + '/*');
            });
        });
        return patterns;
    }

    function siteForHost(host) {
        host = (host || '').toLowerCase();
        return allSites().filter(function(site) {
            return hostsOf(site).indexOf(host) !== -1;
        })[0] || null;
    }

    // Whether a request to |url| must be refused because it goes to a known
    // add-on site that is turned off. Returns the reason, or '' if allowed.
    // Addresses on other web sites (e.g. a pasted .xpi link) are not affected.
    function blockedReason(url) {
        var host;
        try {
            host = new URL(url, location.href).hostname;
        } catch (e) {
            return '';
        }
        var site = siteForHost(host);
        if (site && site.removed) {
            return site.host + ' was removed from your add-on sites. You can restore it under "Add-on sites" in Settings.';
        }
        if (site && !site.on) {
            return site.host + ' is turned off. You can turn it on under "Add-on sites" in Settings.';
        }
        return '';
    }

    // Saves |newState|. Unless |keepChosen|, also records that the person has
    // chosen their sites.
    function save(newState, callback, keepChosen) {
        var value = sanitize(newState);
        if (!keepChosen) value.chosen = true;
        apply(value);
        var items = {};
        items[STORAGE_KEY] = value;
        chrome.storage.local.set(items, function() {
            if (callback) callback(chrome.runtime.lastError);
        });
    }

    function setOn(host, on, callback) {
        var next = sanitize(state);
        if (isRemoved(host)) {
            if (callback) callback();
            return;
        }
        if (isBuiltinHost(host)) {
            next.on[host] = !!on;
        } else {
            next.custom.forEach(function(entry) {
                if (entry.host === host) entry.on = !!on;
            });
        }
        save(next, callback);
    }

    // Adds a site. Returns '' on success or a message explaining the problem.
    function addCustom(input, kind, callback) {
        var host = normalizeHost(input);
        if (!host) return 'Enter a valid domain, for example addons.example.org.';
        var known = siteForHost(host);
        if (known && known.removed) {
            return (known.host === host ? host : host + ' belongs to ' + known.host + ', which') +
                ' is a built-in site you removed. Restore it with "Show removed sites".';
        }
        if (known && known.host !== host) return host + ' belongs to ' + known.host + ', which is already in the list.';
        if (known) return host + ' is already in the list.';
        var next = sanitize(state);
        next.removedCustom = next.removedCustom.filter(function(entry) { return entry.host !== host; });
        next.custom.push({host: host, kind: customKind(kind), on: true});
        save(next, callback);
        return '';
    }

    // Removes a site from the list. A built-in site stays known and off; an
    // added site is remembered so that it can be restored. Does not change
    // whether the person has chosen their sites.
    function removeSite(host, callback) {
        var next = sanitize(state);
        if (isBuiltinHost(host)) {
            if (next.removed.indexOf(host) === -1) next.removed.push(host);
            delete next.on[host];
        } else {
            next.custom.forEach(function(entry) {
                if (entry.host === host) next.removedCustom.push({host: entry.host, kind: entry.kind});
            });
            next.custom = next.custom.filter(function(entry) { return entry.host !== host; });
        }
        save(next, callback, true);
    }

    // Puts a removed site back in the list, turned off.
    function restoreSite(host, callback) {
        var next = sanitize(state);
        if (isBuiltinHost(host)) {
            next.removed = next.removed.filter(function(h) { return h !== host; });
            next.on[host] = false;
        } else {
            next.removedCustom.forEach(function(entry) {
                if (entry.host === host) next.custom.push({host: entry.host, kind: entry.kind, on: false});
            });
            next.removedCustom = next.removedCustom.filter(function(entry) { return entry.host !== host; });
        }
        save(next, callback, true);
    }

    // Puts every removed site back in the list, turned off.
    function restoreAll(callback) {
        var next = sanitize(state);
        next.removed.forEach(function(host) { next.on[host] = false; });
        next.removed = [];
        next.removedCustom.forEach(function(entry) {
            next.custom.push({host: entry.host, kind: entry.kind, on: false});
        });
        next.removedCustom = [];
        save(next, callback, true);
    }

    function resetToDefaults(callback) {
        var next = sanitize(state);
        next.on = {};
        save(next, callback);
    }

    function onChange(listener) {
        listeners.push(listener);
    }

    // Whether the person has chosen their add-on sites yet.
    function hasChosen() {
        return state.chosen;
    }

    // Turns on exactly the given built-in sites (all others off) and records
    // that the person has chosen. Used by the step after consent.
    function chooseBuiltin(hosts, callback) {
        var next = sanitize(state);
        BUILTIN.forEach(function(site) {
            next.on[site.host] = !isRemoved(site.host) && hosts.indexOf(site.host) !== -1;
        });
        save(next, callback);
    }

    readCache();
    if (!(typeof chrome === 'object' && chrome.storage && chrome.storage.local)) {
        readyResolve();
    } else {
        chrome.storage.local.get(STORAGE_KEY, function(items) {
            if (items && items[STORAGE_KEY]) apply(items[STORAGE_KEY]);
            else apply(emptyState());
            readyResolve();
        });
        chrome.storage.onChanged.addListener(function(changes, areaName) {
            if (areaName === 'local' && changes[STORAGE_KEY]) {
                apply(changes[STORAGE_KEY].newValue);
            }
        });
    }

    return {
        groups: function() { return GROUPS.slice(); },
        sites: sites,
        removedSites: removedSites,
        enabledHosts: enabledHosts,
        isKindOn: isKindOn,
        siteForHost: siteForHost,
        knownHostPatterns: knownHostPatterns,
        blockedReason: blockedReason,
        normalizeHost: normalizeHost,
        setOn: setOn,
        addCustom: addCustom,
        removeSite: removeSite,
        restoreSite: restoreSite,
        restoreAll: restoreAll,
        resetToDefaults: resetToDefaults,
        onChange: onChange,
        hasChosen: hasChosen,
        chooseBuiltin: chooseBuiltin,
        // Resolves once the saved choice has been read from storage.
        ready: function() { return readyPromise; },
    };
})();
