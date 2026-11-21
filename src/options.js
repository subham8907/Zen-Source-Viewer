/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh, 2026: reduced to Firefox only (removed Chrome, Opera and web-demo code); error text uses the theme color;
 * removed the address bar button setting (replaced by a toolbar button); added the Privacy section (withdraw privacy consent) and the Add-on sites section
 * (choose which add-on sites may be contacted; add your own; remove and restore any site); the built-in sites are shown by group
 * (Mozilla sites; Chrome, Edge and Opera stores); sites you add can work like a Chrome store (CRX).
 * The right-click menu settings are part of the same section: its switch is at the top, and the link patterns
 * (contextmenuPatterns) are listed and added like the sites you added. */

/* jshint browser:true, devel:true */
/* globals chrome, ZenConsent, ZenStoreDomains */
'use strict'; 


// The right-click menu (bg-contextmenu.js) is set in the "Add-on sites and
// right-click menu" section below, together with the add-on sites.
var storageArea = chrome.storage.sync;

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
        summary.textContent = 'You agreed to version ' + result.consent.version + ' of the privacy policy and the End User License Agreement' +
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

// Add-on sites and right-click menu: which sites the add-on may contact
// (store-domains.js), and where the right-click menu item appears
// (showContextMenu and contextmenuPatterns, read by bg-contextmenu.js).
(function() {
    var card = document.getElementById('store-sites');
    var menuToggle = document.getElementById('contextmenu');
    var patterns = [];
    var builtinList = document.getElementById('store-builtin');
    var customList = document.getElementById('store-custom');
    var removedList = document.getElementById('store-removed');
    var status = document.getElementById('store-status');

    function setStatus(text, isError) {
        status.textContent = text || '';
        status.classList.toggle('error', !!isError);
    }
    // The list is drawn again after every change, which would drop keyboard
    // focus. Controls carry a data-focus-key; focus moves back to the same
    // control after a redraw, or to |pendingFocus| when the action removes
    // the control that had focus.
    var pendingFocus = null;
    function focusKeyNow() {
        var active = document.activeElement;
        var key = pendingFocus || (active && card.contains(active) && active.dataset.focusKey) || null;
        pendingFocus = null;
        return key;
    }
    function restoreFocus(key) {
        if (!key) return;
        var target = [].filter.call(card.querySelectorAll('[data-focus-key]'), function(node) {
            return node.dataset.focusKey === key;
        })[0];
        if (target) target.focus();
    }
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) node.className = className;
        if (text) node.textContent = text;
        return node;
    }
    function siteRow(site) {
        var row = el('label', 'setting');
        var toggle = el('input');
        toggle.type = 'checkbox';
        toggle.checked = site.on;
        toggle.setAttribute('aria-label', 'Allow ' + site.host);
        toggle.dataset.focusKey = 'on:' + site.host;
        toggle.onchange = function() {
            ZenStoreDomains.setOn(site.host, toggle.checked, function(error) {
                setStatus(error ? 'Could not save: ' + error.message :
                    site.host + (toggle.checked ? ' turned on.' : ' turned off. It will not be contacted.'), !!error);
            });
        };
        var text = el('span', 'setting-text');
        text.appendChild(el('span', 'setting-title', site.name));
        text.appendChild(el('span', 'store-host', site.host));
        var desc = site.builtin ?
            'Run by ' + site.operator + '.' :
            site.kind === 'crx' ? 'Added by you. Works like a Chrome store: its .crx files and Chrome update files (update_url) can be opened.' :
            'Added by you. Works like ' + (site.kind === 'thunderbird' ? 'addons.thunderbird.net' : 'addons.mozilla.org') + '.';
        text.appendChild(el('span', 'setting-desc', desc));
        row.appendChild(toggle);
        row.appendChild(text);
        var remove = el('button', 'withdraw-button store-remove', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + site.host);
        remove.dataset.focusKey = 'remove:' + site.host;
        remove.onclick = function(event) {
            event.preventDefault();
            pendingFocus = 'removed-toggle';
            ZenStoreDomains.removeSite(site.host, function(error) {
                setStatus(error ? 'Could not save: ' + error.message :
                    site.host + ' removed' + (site.builtin ? ' and turned off. It will not be contacted.' : '.') +
                    ' To restore it, use "Show removed sites".', !!error);
            });
        };
        row.appendChild(remove);
        return row;
    }
    // A removed site, with a button that puts it back in the list (off).
    function removedRow(site) {
        var row = el('div', 'setting store-removed-row');
        var text = el('span', 'setting-text');
        text.appendChild(el('span', 'setting-title', site.name));
        text.appendChild(el('span', 'store-host', site.host));
        text.appendChild(el('span', 'setting-desc', site.builtin ?
            'Built-in site, run by ' + site.operator + '. Removed and off: it is never contacted.' :
            'Added by you. Removed.'));
        row.appendChild(text);
        var restore = el('button', 'store-reset store-restore', 'Restore');
        restore.type = 'button';
        restore.setAttribute('aria-label', 'Restore ' + site.host);
        restore.dataset.focusKey = 'restore:' + site.host;
        restore.onclick = function() {
            pendingFocus = 'on:' + site.host;
            ZenStoreDomains.restoreSite(site.host, function(error) {
                setStatus(error ? 'Could not save: ' + error.message :
                    site.host + ' restored. It is off until you turn it on.', !!error);
            });
        };
        row.appendChild(restore);
        return row;
    }
    // A link pattern of the right-click menu, shown like a site you added.
    function patternRow(pattern) {
        var row = el('div', 'setting store-pattern-row');
        row.appendChild(el('span', 'store-pattern-icon', 'LINK'));
        var text = el('span', 'setting-text');
        text.appendChild(el('span', 'setting-title', 'Links matching'));
        text.appendChild(el('span', 'store-host', pattern));
        text.appendChild(el('span', 'setting-desc', 'Right-click menu only. Nothing is contacted until you open such a link.'));
        row.appendChild(text);
        var remove = el('button', 'withdraw-button store-remove', 'Remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', 'Remove ' + pattern);
        remove.onclick = function() {
            pendingFocus = 'add-host';
            savePatterns(patterns.filter(function(p) { return p !== pattern; }), pattern + ' removed.');
        };
        row.appendChild(remove);
        return row;
    }
    // Returns '' if |line| is a valid match pattern for links, else why not.
    function patternProblem(line) {
        if (!/^(\*|https?|ftp|file|data):\/\/\*?[^/*]*\//.test(line)) {
            return 'Enter a domain, or a link pattern such as https://example.com/*.crx. ' +
                'A pattern may contain at most one * (wildcard) as a subdomain, and any number of * in the path.';
        }
        return '';
    }
    function savePatterns(next, message) {
        storageArea.set({contextmenuPatterns: next}, function() {
            var error = chrome.runtime.lastError;
            setStatus(error ? 'Could not save: ' + error.message : message, !!error);
        });
    }

    function render() {
        var focusKey = focusKeyNow();
        card.classList.toggle('menu-off', !menuToggle.checked);
        builtinList.textContent = '';
        customList.textContent = '';
        var sites = ZenStoreDomains.sites();
        // Built-in sites, by group: Mozilla sites, then Chrome, Edge and Opera.
        ZenStoreDomains.groups().forEach(function(group) {
            var inGroup = sites.filter(function(site) { return site.builtin && site.group === group.id; });
            if (!inGroup.length) return;
            builtinList.appendChild(el('h3', 'store-group', group.title));
            inGroup.forEach(function(site) {
                builtinList.appendChild(siteRow(site));
            });
        });
        var custom = sites.filter(function(site) { return !site.builtin; });
        if (!custom.length && !patterns.length) {
            customList.appendChild(el('p', 'store-empty',
                'None yet. Add the domain of an add-on site, or a link pattern for the right-click menu, below.'));
        }
        custom.forEach(function(site) {
            customList.appendChild(siteRow(site));
        });
        patterns.forEach(function(pattern) {
            customList.appendChild(patternRow(pattern));
        });
        renderRemoved();
        restoreFocus(focusKey);
    }

    // Removed sites are hidden behind their own button.
    var showRemoved = false;
    function renderRemoved() {
        removedList.textContent = '';
        var removed = ZenStoreDomains.removedSites();
        removedList.hidden = !removed.length;
        if (!removed.length) {
            showRemoved = false;
            return;
        }
        var heading = el('div', 'store-removed-head');
        var toggle = el('button', 'store-reset',
            showRemoved ? 'Hide removed sites' : 'Show removed sites (' + removed.length + ')');
        toggle.type = 'button';
        toggle.setAttribute('aria-expanded', String(showRemoved));
        toggle.setAttribute('aria-controls', 'store-removed-list');
        toggle.dataset.focusKey = 'removed-toggle';
        toggle.onclick = function() {
            showRemoved = !showRemoved;
            renderRemoved();
            restoreFocus('removed-toggle');
        };
        heading.appendChild(toggle);
        if (showRemoved) {
            var restoreAll = el('button', 'store-reset', 'Restore all');
            restoreAll.type = 'button';
            restoreAll.onclick = function() {
                pendingFocus = 'on:' + removed[0].host;
                ZenStoreDomains.restoreAll(function(error) {
                    setStatus(error ? 'Could not save: ' + error.message :
                        'All removed sites restored. They are off until you turn them on.', !!error);
                });
            };
            heading.appendChild(restoreAll);
        }
        removedList.appendChild(heading);
        var rows = el('div');
        rows.id = 'store-removed-list';
        rows.hidden = !showRemoved;
        removed.forEach(function(site) {
            rows.appendChild(removedRow(site));
        });
        removedList.appendChild(rows);
    }

    document.getElementById('store-add-form').onsubmit = function(event) {
        event.preventDefault();
        var input = document.getElementById('store-add-host');
        var kind = document.getElementById('store-add-kind').value;
        if (kind === 'pattern') {
            var pattern = input.value.trim();
            var problem2 = patternProblem(pattern);
            if (problem2) {
                setStatus(problem2, true);
                return;
            }
            if (patterns.indexOf(pattern) !== -1) {
                setStatus(pattern + ' is already in the list.', true);
                return;
            }
            savePatterns(patterns.concat([pattern]), pattern + ' added to the right-click menu.' +
                (menuToggle.checked ? '' : ' Turn on the right-click menu above to use it.'));
            input.value = '';
            return;
        }
        var host = ZenStoreDomains.normalizeHost(input.value);
        var problem = ZenStoreDomains.addCustom(input.value, kind, function(error) {
            setStatus(error ? 'Could not save: ' + error.message :
                host + ' added. We do not endorse this site; it receives your requests when you open add-ons from it.', !!error);
        });
        if (problem) {
            setStatus(problem, true);
            return;
        }
        input.value = '';
    };
    document.getElementById('store-reset').onclick = function() {
        ZenStoreDomains.resetToDefaults(function(error) {
            setStatus(error ? 'Could not save: ' + error.message : 'All built-in sites turned off.', !!error);
        });
    };

    document.getElementById('store-add-host').dataset.focusKey = 'add-host';

    // The placeholder follows the chosen type: a domain or a link pattern.
    var kindSelect = document.getElementById('store-add-kind');
    kindSelect.onchange = function() {
        document.getElementById('store-add-host').placeholder =
            kindSelect.value === 'pattern' ? 'https://example.com/*.crx' : 'addons.example.org';
        document.querySelector('#store-add-form button').textContent =
            kindSelect.value === 'pattern' ? 'Add link pattern' : 'Add site';
    };

    menuToggle.onchange = function() {
        storageArea.set({showContextMenu: menuToggle.checked});
        setStatus(menuToggle.checked ? 'Right-click menu turned on.' : 'Right-click menu turned off.');
        render();
    };
    storageArea.get({
        showContextMenu: true,
        contextmenuPatterns: [],
    }, function(items) {
        menuToggle.checked = items.showContextMenu;
        patterns = Array.isArray(items.contextmenuPatterns) ? items.contextmenuPatterns : [];
        render();
    });
    chrome.storage.onChanged.addListener(function(changes, areaName) {
        if (areaName !== 'sync') return;
        if (changes.contextmenuPatterns) {
            patterns = changes.contextmenuPatterns.newValue || [];
            render();
        }
        if (changes.showContextMenu) {
            menuToggle.checked = !!changes.showContextMenu.newValue;
            render();
        }
    });

    ZenStoreDomains.onChange(render);
    render();
})();
