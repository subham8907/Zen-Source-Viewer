/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: renamed from cws_pattern.js; only Firefox
 * and Thunderbird add-on sites (addons.mozilla.org, addons.thunderbird.net)
 * are supported. Chrome Web Store, Edge and Opera (CRX) support was removed.
 * can_view_addon_url only accepts add-on pages and .xpi addresses (for the toolbar popup). */

/* globals location, navigator, XMLHttpRequest, console */
/* exported amo_match_patterns, atn_match_patterns, amo_pattern, atn_pattern */
/* exported get_addon_download_url, get_listing_url, get_zip_name, get_amo_domain, get_amo_slug */
/* exported is_cors_enabled_download_url, can_view_addon_url, is_addon_download_url, is_listing_url */
/* exported getParam, encodeQueryString, getXpis */
'use strict';

// Firefox add-on gallery (addons.mozilla.org and its staging servers)
var amo_pattern = /^https?:\/\/((?:reviewers\.)?(?:addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org))\/.*?(?:addon|review)\/([^/<>"'?#]+)/;
var amo_download_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org)\/[^?#]*\/downloads\/latest\/([^/?#]+)/;
var amo_domain_pattern = /^https?:\/\/(addons\.mozilla\.org|addons(?:-dev)?\.allizom\.org)\//;
var amo_match_patterns = [
    '*://addons.mozilla.org/*addon/*',
    '*://*.addons.mozilla.org/*review/*',
    '*://addons.allizom.org/*addon/*',
    '*://*.addons.allizom.org/*review/*',
    '*://addons-dev.allizom.org/*addon/*',
    '*://*.addons-dev.allizom.org/*review/*',
];
// Depends on: https://bugzilla.mozilla.org/show_bug.cgi?id=1620084
var amo_xpi_cdn_pattern = /^https?:\/\/(?:addons\.cdn\.mozilla\.net|addons-dev-cdn\.allizom\.org)\/user-media\/addons\//;

// Thunderbird add-on gallery
var atn_pattern = /^https?:\/\/((?:addons|addons-stage)\.thunderbird\.net)\/.*?\/addon\/([^/?#]+)/;
var atn_download_pattern = /^https?:\/\/((?:addons|addons-stage)\.thunderbird\.net)\/[^?#]*\/downloads\/latest\/([^/?#]+)/;
var atn_match_patterns = [
    '*://addons.thunderbird.net/*addon/*',
    '*://addons-stage.thunderbird.net/*addon/*',
];

// bg-contextmenu.js uses amo_match_patterns and atn_match_patterns. popup.js
// uses can_view_addon_url to determine whether the current page can be
// opened, which uses regexps that may be stricter than the match patterns.

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

// Returns the location of the XPI file for an add-on listing URL on
// addons.mozilla.org or addons.thunderbird.net.
// Unrecognized values are returned as-is.
function get_addon_download_url(url) {
    var match = amo_pattern.exec(url);
    if (match) {
        return get_xpi_url(match[1], match[2]);
    }
    match = atn_pattern.exec(url);
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
    var atn = atn_pattern.exec(url) || atn_download_pattern.exec(url);
    if (atn) {
        return 'https://' + atn[1] + '/thunderbird/addon/' + atn[2];
    }
}

// Return the suggested name of the zip file.
function get_zip_name(url, /*optional*/filename) {
    if (!filename) {
        // AMO: Lots of different formats, but usually ending with .xpi?....
        url = url.split(/[?#]/, 1)[0];
        filename = /([^\/]+?)\/*$/.exec(url)[1];
    }
    return filename.replace(/\.(jar|xpi|zip)$/i, '') + '.zip';
}

function get_amo_domain(url) {
    var match = amo_domain_pattern.exec(url);
    return match ? match[1] : 'addons.mozilla.org';
}

function get_amo_slug(url) {
    var match = amo_pattern.exec(url) || amo_download_pattern.exec(url);
    if (match) {
        return match[2];
    }
}

function is_cors_enabled_download_url(url) {
    // We're only interested in XPI files from AMO, which supports CORS as of March 2020:
    // https://github.com/mozilla/addons-server/issues/9118
    // The following matches the whole AMO domain, including non-CORS
    // endpoints. That's fine since we only care about XPI URLs.
    // The full redirect chain should also allow CORS, including the CDN:
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1620084
    return amo_domain_pattern.test(url) || amo_xpi_cdn_pattern.test(url);
}

// Whether the page at this URL is an add-on that the popup can open: an add-on
// page or download link of addons.mozilla.org or addons.thunderbird.net, or a
// web address of an .xpi file. Other pages (also pages that merely mention
// ".xpi" in their address, e.g. a search) are not.
function can_view_addon_url(url) {
    if (!/^https?:\/\//i.test(url)) {
        return false;
    }
    if (is_listing_url(url) || amo_download_pattern.test(url) || atn_download_pattern.test(url)) {
        return true;
    }
    try {
        return /\.xpi$/i.test(new URL(url).pathname);
    } catch (e) {
        return false;
    }
}

// Whether the given URL is from a URL that is expected to serve the add-on file.
function is_addon_download_url(url) {
    return amo_download_pattern.test(url) ||
        atn_download_pattern.test(url) ||
        /\.xpi\b/.test(url);
}

function is_listing_url(url) {
    // Keep logic in sync with get_listing_url.
    return amo_pattern.test(url) || atn_pattern.test(url);
}

// Calls callback(description, Array<{url:String, version:String, platform:String}>)
// If there are more results: The callback will include a third parameter with a non-zero page number to use.
// If called repeatedly: Will only call the callback of the last call.
function getXpis(amodomain, slugorid, page, callback) {
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
