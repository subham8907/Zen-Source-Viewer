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
 * Privacy consent page (consent.html). Shows the privacy policy and saves the
 * user's agreement to the current policy version, then reopens the page that
 * sent the user here (?return=...). */

/* jshint browser:true, esversion:6 */
/* globals chrome, ZenConsent */
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
    if (/^\/(consent|privacy)\.html$/.test(url.pathname)) return null;
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
    ['loading', 'consent-form', 'declined', 'done'].forEach(function(other) {
        document.getElementById(other).hidden = other !== id;
    });
}

function formatDate(isoString) {
    var date = new Date(isoString);
    return isNaN(date) ? '' : date.toLocaleDateString(undefined, {year: 'numeric', month: 'long', day: 'numeric'});
}

function showDone(consent) {
    show('done');
    var text = 'You agreed to version ' + consent.version + ' of the privacy policy';
    var date = formatDate(consent.acceptedAt);
    document.getElementById('done-text').textContent = text + (date ? ' on ' + date : '') + '. ' +
        'You can withdraw your consent in Settings.';
}

function continueToPage() {
    if (returnUrl) {
        location.replace(returnUrl);
    }
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
        // Already agreed (e.g. a new private window): go straight back.
        if (returnUrl) {
            continueToPage();
        } else {
            showDone(result.consent);
        }
        return;
    }
    document.getElementById('policy-version').textContent = 'Policy version ' + requiredVersion;
    [].forEach.call(document.querySelectorAll('.policy-version-number'), function(elem) {
        elem.textContent = requiredVersion;
    });
    if (result.consent) {
        // Agreed to an older version.
        document.getElementById('consent-title').textContent = 'The privacy policy has changed';
        document.getElementById('consent-intro').textContent =
            'You agreed to version ' + result.consent.version + ' of the privacy policy. ' +
            'Please read version ' + requiredVersion + ' and agree to it to keep using Zen Source Viewer. ' +
            'The add-on stays turned off until you agree.';
    }
    show('consent-form');
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
        if (returnUrl) {
            continueToPage();
        } else {
            showDone(consent);
        }
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
