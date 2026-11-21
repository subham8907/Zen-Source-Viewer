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
 * Privacy consent page (consent.html). Shows the privacy policy and the End
 * User License Agreement (EULA.md, eula.html; same version number) and saves
 * the user's agreement to the current version, then asks which add-on sites
 * to turn on (all are off by default; store-domains.js), then reopens the page
 * that sent the user here (?return=...). The sites are shown by group: Mozilla
 * sites, and the Chrome, Edge and Opera stores (CRX files). Any site can be
 * removed from the list and restored. */

/* jshint browser:true, esversion:6 */
/* globals chrome, ZenConsent, ZenStoreDomains */
'use strict';

var EXTENSION_ORIGIN = chrome.runtime.getURL('');

// Only pages of this add-on may be reopened (never consent.html itself).
function getReturnUrl() {
    var value = new URLSearchParams(location.search).get('return');
    if (!value) return null;
    var url;
    try {
        url = new URL(value, EXTENSION_ORIGIN);
    } catch (e) {
        return null;
    }
    if (url.href.indexOf(EXTENSION_ORIGIN) !== 0) return null;
    if (/^\/(consent|privacy|eula)\.html$/.test(url.pathname)) return null;
    return url.href;
}

var returnUrl = getReturnUrl();
var isPopup = !!returnUrl && new URL(returnUrl).pathname === '/popup.html';
if (isPopup) {
    document.documentElement.classList.add('in-popup');
}

var form = document.getElementById('consent-form');
var checkbox = document.getElementById('agree-checkbox');
var agreeButton = document.getElementById('agree-button');
var statusElem = document.getElementById('status');
var requiredVersion = null;

function show(id) {
    ['loading', 'consent-form', 'sites', 'declined', 'done'].forEach(function(other) {
        document.getElementById(other).hidden = other !== id;
    });
}

function formatDate(isoString) {
    var date = new Date(isoString);
    return isNaN(date) ? '' : date.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'});
}

function showDone(consent) {
    show('done');
    var text = 'You agreed to version ' + consent.version + ' of the privacy policy and the End User License Agreement';
    var date = formatDate(consent.acceptedAt);
    document.getElementById('done-text').textContent = text + (date ? ' on ' + date : '') + '. ' +
        'You can withdraw your consent in Settings.';
}

function continueToPage() {
    if (returnUrl) {
        location.replace(returnUrl);
    }
}

// After consent: ask which add-on sites to turn on, unless already chosen.
function finish(consent) {
    ZenStoreDomains.ready().then(function() {
        if (!ZenStoreDomains.hasChosen()) {
            showSiteChoice(consent);
        } else if (returnUrl) {
            continueToPage();
        } else {
            showDone(consent);
        }
    });
}

var siteChoiceListening = false;
var renderSiteChoice = function() {};

function showSiteChoice(consent) {
    var list = document.getElementById('site-choices');
    var removedList = document.getElementById('site-removed');
    // The sites ticked so far, kept when the list is drawn again after a site
    // is removed or restored.
    var ticked = {};
    // The list is drawn again after every change, which would drop keyboard
    // focus. Controls carry a data-focus-key; focus moves back to the same
    // control, or to |pendingFocus| when the action removes the control.
    var siteStep = document.getElementById('sites');
    var pendingFocus = null;
    function focusKeyNow() {
        var active = document.activeElement;
        var key = pendingFocus || (active && siteStep.contains(active) && active.dataset.focusKey) || null;
        pendingFocus = null;
        return key;
    }
    function restoreFocus(key) {
        if (!key) return;
        var target = [].filter.call(siteStep.querySelectorAll('[data-focus-key]'), function(node) {
            return node.dataset.focusKey === key;
        })[0];
        if (target) target.focus();
    }
    function render() {
        var focusKey = focusKeyNow();
        list.textContent = '';
        var builtin = ZenStoreDomains.sites().filter(function(site) { return site.builtin; });
        ZenStoreDomains.groups().forEach(function(group) {
            var inGroup = builtin.filter(function(site) { return site.group === group.id; });
            if (!inGroup.length) return;
            var heading = document.createElement('p');
            heading.className = 'site-group';
            heading.textContent = group.title;
            list.appendChild(heading);
            inGroup.forEach(addChoice);
        });
        if (!builtin.length) {
            var empty = document.createElement('p');
            empty.className = 'site-empty';
            empty.textContent = 'All sites are removed. Restore them below, or continue with none.';
            list.appendChild(empty);
        }
        renderRemoved();
        restoreFocus(focusKey);
    }
    // Removed sites are hidden behind their own button. When shown, each has
    // a button that puts it back (unticked).
    var showRemoved = false;
    function renderRemoved() {
        removedList.textContent = '';
        var removed = ZenStoreDomains.removedSites().filter(function(site) { return site.builtin; });
        removedList.hidden = !removed.length;
        if (!removed.length) {
            showRemoved = false;
            return;
        }
        var head = document.createElement('div');
        head.className = 'site-removed-head';
        var label = showRemoved ? 'Hide removed sites' : 'Show removed sites (' + removed.length + ')';
        var toggle = smallButton(label, label, function() {
            showRemoved = !showRemoved;
            renderRemoved();
            restoreFocus('removed-toggle');
        });
        toggle.dataset.focusKey = 'removed-toggle';
        toggle.setAttribute('aria-expanded', String(showRemoved));
        toggle.setAttribute('aria-controls', 'site-removed-list');
        head.appendChild(toggle);
        if (showRemoved) {
            head.appendChild(smallButton('Restore all', 'Restore all removed sites', function() {
                pendingFocus = 'tick:' + removed[0].host;
                ZenStoreDomains.restoreAll(saved);
            }));
        }
        removedList.appendChild(head);
        var rows = document.createElement('div');
        rows.id = 'site-removed-list';
        rows.hidden = !showRemoved;
        removedList.appendChild(rows);
        removed.forEach(function(site) {
            var row = document.createElement('div');
            row.className = 'site-choice site-removed';
            var text = document.createElement('span');
            var name = document.createElement('strong');
            name.textContent = site.name;
            var detail = document.createElement('small');
            var code = document.createElement('code');
            code.textContent = site.host;
            detail.appendChild(code);
            detail.appendChild(document.createTextNode(' · removed, never contacted'));
            text.appendChild(name);
            text.appendChild(detail);
            row.appendChild(text);
            var restore = smallButton('Restore', 'Restore ' + site.host, function() {
                pendingFocus = 'tick:' + site.host;
                ZenStoreDomains.restoreSite(site.host, saved);
            });
            restore.dataset.focusKey = 'restore:' + site.host;
            row.appendChild(restore);
            rows.appendChild(row);
        });
    }
    function smallButton(label, ariaLabel, onclick) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'site-button';
        button.textContent = label;
        button.setAttribute('aria-label', ariaLabel);
        button.onclick = function(event) {
            event.preventDefault();
            onclick();
        };
        return button;
    }
    function saved(error) {
        var status = document.getElementById('sites-status');
        status.classList.toggle('error', !!error);
        status.textContent = error ? 'Could not save: ' + error.message : '';
    }
    function addChoice(site) {
        var label = document.createElement('label');
        label.className = 'site-choice';
        var input = document.createElement('input');
        input.type = 'checkbox';
        input.value = site.host;
        input.checked = !!ticked[site.host];
        input.dataset.focusKey = 'tick:' + site.host;
        input.onchange = function() { ticked[site.host] = input.checked; };
        var text = document.createElement('span');
        var name = document.createElement('strong');
        name.textContent = site.name;
        var detail = document.createElement('small');
        var code = document.createElement('code');
        code.textContent = site.host;
        detail.appendChild(code);
        detail.appendChild(document.createTextNode(' · run by ' + site.operator.split(' (')[0]));
        text.appendChild(name);
        text.appendChild(detail);
        label.appendChild(input);
        label.appendChild(text);
        var remove = smallButton('Remove', 'Remove ' + site.host, function() {
            delete ticked[site.host];
            pendingFocus = 'removed-toggle';
            ZenStoreDomains.removeSite(site.host, saved);
        });
        remove.dataset.focusKey = 'remove:' + site.host;
        label.appendChild(remove);
        list.appendChild(label);
    }
    render();
    // Redraw when sites are removed or restored (here or in another page).
    // Registered once, however often this step is shown.
    renderSiteChoice = render;
    if (!siteChoiceListening) {
        siteChoiceListening = true;
        ZenStoreDomains.onChange(function() { renderSiteChoice(); });
    }
    var sitesForm = document.getElementById('sites');
    sitesForm.onsubmit = function(event) {
        event.preventDefault();
        var hosts = [].filter.call(list.querySelectorAll('input'), function(input) {
            return input.checked;
        }).map(function(input) { return input.value; });
        document.getElementById('sites-continue').disabled = true;
        ZenStoreDomains.chooseBuiltin(hosts, function(error) {
            if (error) {
                document.getElementById('sites-continue').disabled = false;
                var status = document.getElementById('sites-status');
                status.classList.add('error');
                status.textContent = 'Could not save your choice: ' + error.message;
                return;
            }
            if (returnUrl) {
                continueToPage();
            } else {
                showDone(consent);
            }
        });
    };
    show('sites');
}

ZenConsent.check().then(function(result) {
    if (!result.required) {
        show('consent-form');
        form.querySelector('.agree').hidden = true;
        agreeButton.hidden = true;
        statusElem.classList.add('error');
        statusElem.textContent = 'The privacy policy version could not be read, so the add-on stays turned off. ' +
            'Please reinstall or update the add-on.';
        return;
    }
    requiredVersion = result.required;
    if (result.ok) {
        // Already agreed (e.g. a new private window): go straight back, after
        // asking which add-on sites to turn on if that was never chosen.
        finish(result.consent);
        return;
    }
    document.getElementById('policy-version').textContent = 'Version ' + requiredVersion;
    [].forEach.call(document.querySelectorAll('.policy-version-number'), function(elem) {
        elem.textContent = requiredVersion;
    });
    if (result.consent) {
        // Agreed to an older version.
        document.getElementById('consent-title').textContent = 'The privacy policy and license agreement have changed';
        document.getElementById('consent-intro').textContent =
            'You agreed to version ' + result.consent.version + ' of the privacy policy. ' +
            'Please read version ' + requiredVersion + ' of the privacy policy and the End User License Agreement, ' +
            'and agree to them to keep using Zen Source Viewer. The add-on stays turned off until you agree.';
    }
    show('consent-form');
});

// Switches the document shown in the frame: Privacy Policy or EULA.
[].forEach.call(document.querySelectorAll('.doc-tab'), function(tab) {
    tab.onclick = function() {
        [].forEach.call(document.querySelectorAll('.doc-tab'), function(other) {
            other.setAttribute('aria-selected', String(other === tab));
        });
        var frame = document.getElementById('policy-frame');
        frame.src = tab.dataset.doc + '?embed';
        frame.title = tab.textContent;
    };
});

checkbox.onchange = function() {
    agreeButton.disabled = !checkbox.checked;
};

form.onsubmit = function(event) {
    event.preventDefault();
    if (!checkbox.checked || !requiredVersion) return;
    agreeButton.disabled = true;
    statusElem.classList.remove('error');
    statusElem.textContent = 'Saving…';
    ZenConsent.accept(requiredVersion).then(function(consent) {
        statusElem.textContent = '';
        finish(consent);
    }, function(error) {
        agreeButton.disabled = false;
        statusElem.classList.add('error');
        statusElem.textContent = 'Could not save your consent: ' + error.message;
    });
};

document.getElementById('decline-button').onclick = function() {
    ZenConsent.withdraw().then(function() {
        show('declined');
    });
};

document.getElementById('review-again').onclick = function() {
    checkbox.checked = false;
    agreeButton.disabled = true;
    show('consent-form');
};

document.getElementById('uninstall-button').onclick = function() {
    if (chrome.management && chrome.management.uninstallSelf) {
        chrome.management.uninstallSelf({showConfirmDialog: true});
    } else {
        document.getElementById('declined-status').textContent = 'Remove the add-on in about:addons.';
    }
};
