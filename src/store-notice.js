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
 * The "which add-on site" picker and the non-endorsement notice shown next to
 * the forms of the viewer and the compare page that contact a web site.
 * Depends on store-domains.js. The picker can also list the Chrome, Edge and
 * Opera stores (the store form on the viewer's Open page).
 */

/* jshint browser:true, esversion:6 */
/* globals ZenStoreDomains */
/* exported ZenStoreNotice */
'use strict';

var ZenStoreNotice = (function() {
    var SETTINGS_URL = 'options.html#store-sites';

    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }

    function settingsLink(text) {
        var a = el('a', '', text);
        a.href = SETTINGS_URL;
        a.target = '_blank';
        return a;
    }

    // The disclaimer for forms that fetch a file from an address the person
    // enters (any web site, not only add-on sites).
    function urlNotice(container) {
        var p = el('p', 'store-notice-inline');
        p.appendChild(document.createTextNode(
            'The file is downloaded directly from the address you enter. We do not ' +
            'endorse any site; it receives your request, including your IP address, ' +
            'under its own privacy policy. Add-on sites you do not want contacted can ' +
            'be turned off in '));
        p.appendChild(settingsLink('Settings'));
        p.appendChild(document.createTextNode('.'));
        container.appendChild(p);
    }

    // A <select> of the add-on sites that are turned on, with the disclaimer.
    // |kinds| lists the kinds of sites to offer (store-domains.js); by default
    // the Firefox-style sites, whose version history can be searched.
    // Returns {host(), kind(), setHost(host), setKind(kind)}; host() is '' if
    // no such site is turned on.
    function sitePicker(container, idPrefix, kinds) {
        kinds = kinds || ['firefox'];
        var wrap = el('div', 'store-picker');
        var label = el('label', 'input-label', kinds.indexOf('firefox') !== -1 ? 'Add-on site' : 'Store');
        var select = el('select', 'store-picker-select');
        select.id = idPrefix + '-store-site';
        label.htmlFor = select.id;
        var note = el('p', 'store-notice-inline');
        wrap.appendChild(label);
        wrap.appendChild(select);
        wrap.appendChild(note);
        container.appendChild(wrap);

        function render() {
            var previous = select.value;
            var sites = ZenStoreDomains.sites().filter(function(site) {
                return site.on && kinds.indexOf(site.kind) !== -1;
            });
            select.textContent = '';
            sites.forEach(function(site) {
                var option = el('option', '', site.group === 'chromium' ? site.name :
                    site.builtin ? site.host + ' (' + site.operator + ')' : site.host + ' (added by you)');
                option.value = site.host;
                option.dataset.kind = site.kind;
                select.appendChild(option);
            });
            select.disabled = !sites.length;
            if (sites.some(function(site) { return site.host === previous; })) {
                select.value = previous;
            }
            note.textContent = '';
            if (!sites.length) {
                note.appendChild(document.createTextNode(kinds.indexOf('firefox') !== -1 ?
                    'No add-on site is turned on. Turn one on in ' :
                    'No Chrome, Edge, Opera or Whale store is turned on. Turn one on in '));
                note.appendChild(settingsLink('Settings'));
                note.appendChild(document.createTextNode(kinds.indexOf('firefox') !== -1 ?
                    ' to look up versions.' : ' to open extensions from it.'));
                return;
            }
            note.appendChild(document.createTextNode(
                'You choose which site to contact. We are an independent project and do not ' +
                'endorse it; the site receives your request, including your IP address, under ' +
                'its own privacy policy. Add, remove or turn off sites in '));
            note.appendChild(settingsLink('Settings'));
            note.appendChild(document.createTextNode('.'));
        }

        ZenStoreDomains.onChange(function() {
            render();
            select.dispatchEvent(new Event('change'));
        });
        render();
        return {
            select: select,
            host: function() {
                return select.disabled ? '' : select.value;
            },
            // The kind of the chosen site, e.g. 'chrome', or ''.
            kind: function() {
                var option = select.disabled ? null : select.selectedOptions[0];
                return option ? option.dataset.kind : '';
            },
            // Selects the first site of |kind| if one is turned on.
            setKind: function(kind) {
                var option = Array.prototype.filter.call(select.options, function(o) { return o.dataset.kind === kind; })[0];
                if (option) select.value = option.value;
            },
            // Selects |host| if it is one of the sites turned on.
            setHost: function(host) {
                if (Array.prototype.some.call(select.options, function(o) { return o.value === host; })) {
                    select.value = host;
                }
            },
        };
    }

    return {
        urlNotice: urlNotice,
        sitePicker: sitePicker,
    };
})();
