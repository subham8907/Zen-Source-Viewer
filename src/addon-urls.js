/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: renamed from cws_pattern.js; Firefox and
 * Thunderbird add-on sites (addons.mozilla.org, addons.thunderbird.net), and
 * the Chrome Web Store, Microsoft Edge Add-ons and Opera add-ons (CRX files).
 * can_view_addon_url only accepts add-on pages and .xpi/.crx addresses (for the toolbar popup).
 * Add-on sites come from store-domains.js: only sites the user turned on are recognized.
 * Sites added as "works like a Chrome store" are recognized by their .crx and update (.xml) files. */

/* globals location, navigator, XMLHttpRequest, console, ZenStoreDomains, chrome */
/* exported get_store_match_patterns, get_crx_store_match_patterns */
/* exported get_addon_download_url, get_listing_url, get_zip_name, get_amo_domain, get_amo_slug */
/* exported get_store_addon_name, is_crx_store_url */
/* exported parse_crx_store_url, get_crx_store_download_url, get_crx_store_listing_url, chromium_platform */
/* exported is_crx_update_url, secure_download_url, SECURE_ALTERNATIVE_HOSTS */
/* exported is_cors_enabled_download_url, can_view_addon_url, is_addon_download_url, is_listing_url */
/* exported getParam, encodeQueryString, getXpis */
'use strict';

// The add-on sites come from store-domains.js: only the sites the person has
// turned on (Settings > Add-on sites) are recognized. The patterns are built
// on every call, so a change in Settings applies immediately.
function escape_host(host) {
    return host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
function host_alternation(kind) {
    var hosts = ZenStoreDomains.enabledHosts(kind).map(escape_host);
    // (?!) never matches: no site of this kind is turned on.
    return hosts.length ? '(?:' + hosts.join('|') + ')' : '(?!)';
}
// Firefox-style sites (addons.mozilla.org and compatible stores).
function amo_pattern() {
    return new RegExp('^https?:\\/\\/((?:reviewers\\.)?' + host_alternation('firefox') + ')\\/.*?(?:addon|review)\\/([^/<>"\'?#]+)');
}
function amo_download_pattern() {
    return new RegExp('^https?:\\/\\/(' + host_alternation('firefox') + ')\\/[^?#]*\\/downloads\\/latest\\/([^/?#]+)');
}
function amo_domain_pattern() {
    return new RegExp('^https?:\\/\\/(' + host_alternation('firefox') + ')\\/');
}
// Thunderbird-style sites (addons.thunderbird.net and compatible stores).
function atn_pattern() {
    return new RegExp('^https?:\\/\\/(' + host_alternation('thunderbird') + ')\\/.*?\\/addon\\/([^/?#]+)');
}
function atn_download_pattern() {
    return new RegExp('^https?:\\/\\/(' + host_alternation('thunderbird') + ')\\/[^?#]*\\/downloads\\/latest\\/([^/?#]+)');
}

// Stores of Chromium-based browsers (CRX files). Each one has a fixed address,
// and its patterns only match while that store is turned on in Settings.
// (?!) never matches.
var NEVER_MATCHES = /(?!)/;
function store_pattern(kind, pattern) {
    return ZenStoreDomains.isKindOn(kind) ? pattern : NEVER_MATCHES;
}
// Chrome Web Store: [1] = extension ID.
function cws_pattern() {
    return store_pattern('chrome', /^https?:\/\/(?:chrome\.google\.com\/webstore|chromewebstore\.google\.com)\/.+?\/([a-z]{32})(?=[\/#?]|$)/);
}
function cws_download_pattern() {
    return store_pattern('chrome', /^https?:\/\/clients2\.google\.com\/service\/update2\/crx\b.*?%3D([a-z]{32})%26uc/);
}
// Microsoft Edge Add-ons: [1] = extension ID.
function mea_pattern() {
    return store_pattern('edge', /^https?:\/\/microsoftedge\.microsoft\.com\/addons\/.+?\/([a-z]{32})(?=[\/#?]|$)/);
}
function mea_download_pattern() {
    return store_pattern('edge', /^https?:\/\/edge\.microsoft\.com\/extensionwebstorebase\/v1\/crx\b.*?%3D([a-z]{32})%26/);
}
// Opera add-ons: [1] = slug. The download link redirects to addons-extensions.operacdn.com.
function ows_pattern() {
    return store_pattern('opera', /^https?:\/\/addons\.opera\.com\/.*?extensions\/(?:details|download)\/([^\/?#]+)/i);
}
function ows_download_pattern() {
    return store_pattern('opera', /^https?:\/\/addons\.opera\.com\/(?:[^\/?#]+\/)?extensions\/download\/([^\/?#]+)/);
}

// Whether |url| is a page or download link of a Chrome, Edge or Opera store
// that is turned on.
function is_crx_store_url(url) {
    return cws_pattern().test(url) || cws_download_pattern().test(url) ||
        mea_pattern().test(url) || mea_download_pattern().test(url) ||
        ows_pattern().test(url) || ows_download_pattern().test(url);
}

// Sites added in Settings that work like a Chrome store (kind 'crx'): their
// .crx files and Chrome update files (the update_url of an extension, an XML
// file that names the .crx file) can be opened.
function is_custom_crx_site_url(url) {
    var host = host_of(url);
    return !!host && ZenStoreDomains.enabledHosts('crx').indexOf(host) !== -1;
}

// Whether |url| is likely a Chrome update file (update manifest), whose
// <updatecheck codebase="..."> names the .crx file (open-addon.js follows it).
// Any address ending in .xml on a Chrome-store site counts.
function is_crx_update_url(url) {
    if (!is_custom_crx_site_url(url)) return false;
    try {
        return /\.xml$/i.test(new URL(url).pathname);
    } catch (e) {
        return false;
    }
}

// Downloads stay on https. Some servers redirect an https download to http://,
// which browsers block; the add-on then upgrades the address to https://.
// Hosts listed here have no working https themselves, but serve the same
// files over https from another host, which is used instead.
var SECURE_ALTERNATIVE_HOSTS = {
    // Microsoft Edge Add-ons: the update server redirects to the "f" host over
    // http, whose https certificate is not valid; the "sf" host serves the
    // same files over https.
    'msedgeextensions.f.tlu.dl.delivery.mp.microsoft.com': 'msedgeextensions.sf.tlu.dl.delivery.mp.microsoft.com',
};

// The https address to use instead of |url|, or '' if |url| needs no change:
// a host from SECURE_ALTERNATIVE_HOSTS is replaced by its alternative, and an
// http:// address is upgraded to https:// on the same host.
function secure_download_url(url) {
    var parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return '';
    }
    if (!/^https?:$/.test(parsed.protocol)) return '';
    var alternative = SECURE_ALTERNATIVE_HOSTS[parsed.hostname];
    if (!alternative && parsed.protocol === 'https:') return '';
    parsed.protocol = 'https:';
    if (alternative) parsed.hostname = alternative;
    return parsed.href;
}

// Match patterns for the context menu (bg-contextmenu.js), for the sites
// that are turned on.
function get_store_match_patterns() {
    var patterns = [];
    ZenStoreDomains.enabledHosts('firefox').forEach(function(host) {
        patterns.push('*://' + host + '/*addon/*', '*://*.' + host + '/*review/*');
    });
    ZenStoreDomains.enabledHosts('thunderbird').forEach(function(host) {
        patterns.push('*://' + host + '/*addon/*');
    });
    return patterns;
}

// Match patterns of the Chrome, Edge and Opera store pages, for the stores
// that are turned on (context menu, bg-contextmenu.js).
function get_crx_store_match_patterns() {
    var patterns = [];
    if (ZenStoreDomains.isKindOn('chrome')) {
        patterns.push('*://chromewebstore.google.com/detail/*', '*://chrome.google.com/webstore/detail/*');
    }
    if (ZenStoreDomains.isKindOn('edge')) {
        patterns.push('*://microsoftedge.microsoft.com/addons/detail/*');
    }
    if (ZenStoreDomains.isKindOn('opera')) {
        patterns.push('*://addons.opera.com/*extensions/details/*');
    }
    // Sites added in Settings that work like a Chrome store: their update files.
    ZenStoreDomains.enabledHosts('crx').forEach(function(host) {
        patterns.push('*://' + host + '/*.xml*');
    });
    return patterns;
}

// popup.js uses can_view_addon_url to determine whether the current page can
// be opened, which uses regexps that may be stricter than the match patterns.

function get_xpi_url(amoDomain, addonSlug) {
    // "https://addons.mozilla.org/firefox/downloads/latest/<slug>/" is suggested by TheOne:
    // https://discourse.mozilla-community.org/t/is-there-a-direct-download-link-for-the-latest-addon-version-on-amo/4788
    // This did not always work. I figured that some packages are platform-specific, so they need
    // extra juice, so add it in the mix!

    // https://github.com/mozilla/addons-server/blob/a5c045df049227b8a6e6ec0b9c86093aedda3d37/src/olympia/constants/platforms.py
    var platformId;
    var ua = navigator.userAgent;
    if (ua.includes('Mac')) {
        platformId = 3;
    } else if (ua.includes('Win')) {
        platformId = 5;
    } else if (ua.includes('Android')) {
        platformId = 7;
    } else { // Assume Linux.
        platformId = 2;
    }

    var url = 'https://' + amoDomain + '/firefox/downloads/latest/';
    url += addonSlug;
    url += '/platform:' + platformId;
    url += '/';
    // We can put anything here, but it is usually the desired file name for the XPI file.
    url += addonSlug + '.xpi';
    return url;
}

// The operating system and processor in the form that the update servers of
// the Chrome Web Store and Edge Add-ons expect (like chrome.runtime.PlatformOs
// and PlatformArch in Chrome). Some extensions have files for one platform only.
// Like chrome-platform-info.js of CRX Viewer: runtime.getPlatformInfo() is
// asked once when this file loads, and the user agent is used until it answers.
var chromium_platform_info = null;
if (typeof chrome === 'object' && chrome.runtime && chrome.runtime.getPlatformInfo) {
    try {
        chrome.runtime.getPlatformInfo(function(info) {
            if (!info || chrome.runtime.lastError) return;
            // Firefox names 64-bit ARM "aarch64"; Chrome names it "arm64".
            var arch = info.arch === 'aarch64' ? 'arm64' : info.arch;
            if (/^(win|mac|linux|android|cros|openbsd)$/.test(info.os) &&
                /^(arm|arm64|x86-32|x86-64|mips|mips64|riscv64)$/.test(arch)) {
                chromium_platform_info = {os: info.os, arch: arch};
            }
        });
    } catch (e) {}
}
function chromium_platform() {
    if (chromium_platform_info) {
        return {os: chromium_platform_info.os, arch: chromium_platform_info.arch};
    }
    var ua = navigator.userAgent;
    var os;
    if (ua.includes('Android')) {
        os = 'android';
    } else if (ua.includes('Mac')) {
        os = 'mac';
    } else if (ua.includes('Win')) {
        os = 'win';
    } else if (ua.includes('CrOS')) {
        os = 'cros';
    } else if (ua.includes('BSD')) {
        os = 'openbsd';
    } else {
        os = 'linux';
    }
    var arch;
    if (/aarch64|arm64/i.test(ua)) {
        arch = 'arm64';
    } else if (/\barm/i.test(ua)) {
        arch = 'arm';
    } else if (os === 'mac' || /x86_64|x64|Win64|WOW64|amd64/i.test(ua)) {
        arch = 'x86-64';
    } else {
        arch = 'x86-32';
    }
    return {os: os, arch: arch};
}

// The CRX file of an extension in the Chrome Web Store. |platform| is optional:
// {os, arch, prodversion}; missing values are those of this device.
function get_cws_crx_url(extensionId, platform) {
    var device = chromium_platform();
    platform = platform || {};
    var url = 'https://clients2.google.com/service/update2/crx?response=redirect';
    url += '&os=' + encodeURIComponent(platform.os || device.os);
    url += '&arch=' + encodeURIComponent(platform.arch || device.arch);
    url += '&prod=chromiumcrx';
    // Channel is "unknown" on some Chromium builds, which works for everyone.
    url += '&prodchannel=unknown';
    // The store refuses to serve old browser versions (it answers 204 to
    // Chrome versions before 88), and Firefox has no Chrome version, so ask
    // as a very recent one.
    url += '&prodversion=' + encodeURIComponent(platform.prodversion || '9999.0.9999.0');
    url += '&acceptformat=crx2,crx3';
    url += '&x=id%3D' + extensionId + '%26uc';
    return url;
}

// The CRX file of an extension in Microsoft Edge Add-ons.
function get_mea_crx_url(extensionId) {
    return 'https://edge.microsoft.com/extensionwebstorebase/v1/crx?response=redirect&x=id%3D' +
        extensionId + '%26installsource%3Dondemand%26uc';
}

// The CRX file of an extension in Opera add-ons.
function get_ows_crx_url(slug) {
    return 'https://addons.opera.com/extensions/download/' + slug + '/';
}

// For the store form on the viewer's Open page: what a Chrome Web Store, Edge
// Add-ons or Opera add-ons page or download link points to, as
// {kind: 'chrome'|'edge'|'opera', id, os, arch, prodversion}, or null. The
// platform values are only set for Chrome Web Store download links.
function parse_crx_store_url(url) {
    var match = cws_pattern().exec(url);
    if (match) return {kind: 'chrome', id: match[1]};
    match = cws_download_pattern().exec(url);
    if (match) {
        return {
            kind: 'chrome',
            id: match[1],
            os: getParam('os', url.replace(/^[^?]*/, '')) || '',
            arch: getParam('arch', url.replace(/^[^?]*/, '')) || '',
            prodversion: getParam('prodversion', url.replace(/^[^?]*/, '')) || '',
        };
    }
    match = mea_pattern().exec(url) || mea_download_pattern().exec(url);
    if (match) return {kind: 'edge', id: match[1]};
    match = ows_pattern().exec(url) || ows_download_pattern().exec(url);
    if (match) return {kind: 'opera', id: match[1]};
    return null;
}

// The CRX file of an extension in a store: |kind| is 'chrome', 'edge' or
// 'opera', |id| the extension ID (Chrome, Edge) or slug (Opera). |platform|
// ({os, arch, prodversion}) is only used for the Chrome Web Store.
function get_crx_store_download_url(kind, id, platform) {
    if (kind === 'chrome') return get_cws_crx_url(id, platform);
    if (kind === 'edge') return get_mea_crx_url(id);
    return get_ows_crx_url(encodeURIComponent(id));
}

// The store page of an extension (see get_crx_store_download_url).
function get_crx_store_listing_url(kind, id) {
    if (kind === 'chrome') return 'https://chromewebstore.google.com/detail/' + id;
    if (kind === 'edge') return 'https://microsoftedge.microsoft.com/addons/detail/' + id;
    return 'https://addons.opera.com/extensions/details/' + encodeURIComponent(id) + '/';
}

// The extension ID of a Chrome Web Store or Edge Add-ons page or download
// link, or ''.
function get_crx_store_id(url) {
    var match = cws_pattern().exec(url) || cws_download_pattern().exec(url) ||
        mea_pattern().exec(url) || mea_download_pattern().exec(url);
    return match ? match[1] : '';
}

// Returns the location of the add-on file for an add-on listing URL: the XPI
// file of addons.mozilla.org or addons.thunderbird.net, or the CRX file of the
// Chrome Web Store, Microsoft Edge Add-ons or Opera add-ons.
// Unrecognized values are returned as-is.
function get_addon_download_url(url) {
    var match = ows_pattern().exec(url);
    if (match) {
        return get_ows_crx_url(match[1]);
    }
    match = mea_pattern().exec(url) || mea_download_pattern().exec(url);
    if (match) {
        return get_mea_crx_url(match[1]);
    }
    match = cws_pattern().exec(url);
    if (match) {
        return get_cws_crx_url(match[1]);
    }
    match = amo_pattern().exec(url);
    if (match) {
        return get_xpi_url(match[1], match[2]);
    }
    match = atn_pattern().exec(url);
    if (match) {
        // Although /firefox/ works too, let's prefer /thunderbird/.
        return get_xpi_url(match[1], match[2]).replace('/firefox/', '/thunderbird/');
    }
    return url;
}

// Get location of the add-on listing for a given add-on URL.
function get_listing_url(url) {
    // Keep logic in sync with is_listing_url.
    var amo = get_amo_slug(url);
    if (amo) {
        return 'https://' + get_amo_domain(url) + '/firefox/addon/' + amo;
    }
    var atn = atn_pattern().exec(url) || atn_download_pattern().exec(url);
    if (atn) {
        return 'https://' + atn[1] + '/thunderbird/addon/' + atn[2];
    }
    var cws = cws_pattern().exec(url) || cws_download_pattern().exec(url);
    if (cws) {
        return 'https://chromewebstore.google.com/detail/' + cws[1];
    }
    var mea = mea_pattern().exec(url) || mea_download_pattern().exec(url);
    if (mea) {
        return 'https://microsoftedge.microsoft.com/addons/detail/' + mea[1];
    }
    var ows = ows_pattern().exec(url) || ows_download_pattern().exec(url);
    if (ows) {
        return 'https://addons.opera.com/extensions/details/' + ows[1] + '/';
    }
}

// A short name for the add-on at |url|, for display: the slug of an add-on
// site, or the extension ID in the Chrome Web Store or Edge Add-ons. '' if
// the URL is not an add-on page or download link.
function get_store_addon_name(url) {
    var atn = atn_pattern().exec(url) || atn_download_pattern().exec(url);
    var ows = ows_pattern().exec(url) || ows_download_pattern().exec(url);
    return get_amo_slug(url) || (atn && atn[2]) || (ows && ows[1]) || get_crx_store_id(url);
}

// Return the suggested name of the zip file.
function get_zip_name(url, /*optional*/filename) {
    if (!filename) {
        // The Chrome Web Store and Edge Add-ons: the extension ID.
        filename = get_crx_store_id(url);
    }
    if (!filename) {
        // AMO: Lots of different formats, but usually ending with .xpi?....
        // Opera: https://addons.opera.com/extensions/download/<slug>/
        url = url.split(/[?#]/, 1)[0];
        filename = /([^\/]+?)\/*$/.exec(url)[1];
    }
    return filename.replace(/\.(crx|jar|nex|xpi|zip|xml)$/i, '') + '.zip';
}

// The Firefox-style site of |url|, or the first one that is turned on, or ''
// if none is turned on.
function get_amo_domain(url) {
    var match = amo_domain_pattern().exec(url);
    return match ? match[1] : (ZenStoreDomains.enabledHosts('firefox')[0] || '');
}

function get_amo_slug(url) {
    var match = amo_pattern().exec(url) || amo_download_pattern().exec(url);
    if (match) {
        return match[2];
    }
}

function host_of(url) {
    try {
        return new URL(url).hostname;
    } catch (e) {
        return '';
    }
}

function is_cors_enabled_download_url(url) {
    // We're only interested in XPI files from AMO, which supports CORS as of March 2020:
    // https://github.com/mozilla/addons-server/issues/9118
    // The following matches the whole AMO domain, including non-CORS
    // endpoints. That's fine since we only care about XPI URLs.
    // The full redirect chain should also allow CORS, including the CDN:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1620084
    if (amo_domain_pattern().test(url)) return true;
    var site = ZenStoreDomains.siteForHost(host_of(url));
    return !!site && site.on && site.kind === 'firefox';
}

// Whether the page at this URL is an add-on that the popup can open: an add-on
// page or download link of an add-on site that is turned on, or a web address
// of an .xpi or .crx file. Other pages (also pages that merely mention ".xpi"
// in their address, e.g. a search) are not.
function can_view_addon_url(url) {
    if (!/^https?:\/\//i.test(url)) {
        return false;
    }
    if (ZenStoreDomains.blockedReason(url)) {
        return false;
    }
    if (is_listing_url(url) || amo_download_pattern().test(url) || atn_download_pattern().test(url) ||
        is_crx_store_url(url) || is_crx_update_url(url)) {
        return true;
    }
    try {
        return /\.(xpi|crx|nex)$/i.test(new URL(url).pathname);
    } catch (e) {
        return false;
    }
}

// Whether the given URL is from a URL that is expected to serve the add-on file.
function is_addon_download_url(url) {
    return amo_download_pattern().test(url) ||
        atn_download_pattern().test(url) ||
        cws_download_pattern().test(url) ||
        mea_download_pattern().test(url) ||
        ows_download_pattern().test(url) ||
        is_crx_update_url(url) ||
        /\.(crx|nex|xpi)\b/.test(url);
}

function is_listing_url(url) {
    // Keep logic in sync with get_listing_url.
    return amo_pattern().test(url) || atn_pattern().test(url) ||
        cws_pattern().test(url) || mea_pattern().test(url) || ows_pattern().test(url);
}

// Calls callback(description, Array<{url:String, version:String, platform:String}>)
// If there are more results: The callback will include a third parameter with a non-zero page number to use.
// If called repeatedly: Will only call the callback of the last call.
function getXpis(amodomain, slugorid, page, callback) {
    var blocked = amodomain ? ZenStoreDomains.blockedReason('https://' + amodomain + '/') :
        'No Firefox add-on site is turned on. You can turn one on under "Add-on sites" in Settings.';
    if (blocked) {
        callback(blocked, []);
        return;
    }
    var apiUrl = 'https://' + amodomain + '/api/v4/addons/addon/' + slugorid + '/versions/';
    // Have smaller response bodies by only including one language.
    apiUrl += '?lang=en-US';
    if (page) {
        apiUrl += '&page=' + page;
    } else {
        // When the page parameter is omitted, it defaults to 1.
        page = 1;
    }
    var x = new XMLHttpRequest();
    x.open('GET', apiUrl);
    x.onloadend = function() {
        if (getXpis._pendingXhr === x) {
            getXpis._pendingXhr = null;
        }

        if (x.status === 401 || x.status === 403) {
            callback('The results are not publicly available for: ' + slugorid, []);
            return;
        }
        if (x.status !== 200) {
            callback('No results found for: ' + slugorid, []);
            return;
        }
        var nextPage = 0;
        var totalVersions = 0;
        var results = [];
        try {
            var response = JSON.parse(x.responseText);
            response.results.forEach(function(res) {
                res.files.forEach(function(file) {
                    results.push({
                        url: file.url.replace(/\.xpi\?.*$/, '.xpi'),
                        version: res.version,
                        platform: file.platform,
                        createdDate: new Date(file.created),
                    });
                });
            });
            if (response.next) {
                nextPage = page + 1;
            }
            totalVersions = response.count;
        } catch (e) {
            console.error('Failed to parse response', e);
            callback('Unexpected response from add-ons server (' + e + ').', results);
            return;
        }
        if (nextPage) {
            callback('Found ' + totalVersions + ' results', results, nextPage);
            return;
        }
        callback('Found ' + results.length + ' recent results.', results);
    };
    if (getXpis._pendingXhr) {
        getXpis._pendingXhr.abort();
    }
    x.send();
    getXpis._pendingXhr = x;
}

// |name| should not contain special RegExp characters, except possibly maybe a '[]' at the end.
// If |name| ends with a '[]', then the return value is an array. Otherwise the first match is
// returned.
function getParam(name, querystring) { // Assume name contains no RegEx-specific char
    var haystack = querystring || location.search || location.hash;
    var pattern, needle, match;
    if (name.slice(-2, name.length) === '[]') {
        pattern = new RegExp('[&?#]' + name.slice(0, -2) + '\\[\\]=([^&]*)', 'g');
        var needles = [];
        while ((match = pattern.exec(haystack)) !== null) {
            needles.push(decodeURIComponent(match[1]));
        }
        return needles;
    }
    pattern = new RegExp('[&?#]' + name + '=([^&]*)');
    needle = pattern.exec(haystack);
    return needle && decodeURIComponent(needle[1]);
}

function encodeQueryString(params) {
    var parts = [];
    Object.keys(params).forEach(function(key) {
        var value = params[key];
        if (Array.isArray(value)) {
            value.forEach(function(value2) {
                parts.push(encodeQueryStringPart(key + '[]', value2));
            });
        } else if (value !== void 0) {
            parts.push(encodeQueryStringPart(key, value));
        }
    });
    return parts.join('&');
    function encodeQueryStringPart(key, value) {
        value = encodeURIComponent(value);
        return key + '=' + value;
    }
}
