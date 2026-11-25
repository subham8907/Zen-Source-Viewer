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
 * Generates privacy.html (the Privacy Policy page) from PRIVACY.md, and
 * eula.html (the End User License Agreement) from EULA.md, both with the
 * version from src/privacy-policy.json (agreeing on the consent page covers
 * both). Run by `node make.js firefox`, `node make.js privacy` and
 * `node make.js eula`; do not edit privacy.html or eula.html by hand.
 */
/* jshint node:true, esversion:8 */
'use strict';

var fs = require('fs');
var path = require('path');
var marked = require('marked').marked;

var ROOT_DIR = path.join(__dirname, '..', '..') + '/';

function read(file) {
    return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function escapeHTML(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Returns the policy version, and fails the build if it is missing.
function readPolicyVersion() {
    var config = JSON.parse(read(ROOT_DIR + 'src/privacy-policy.json'));
    var version = config.version;
    if ((typeof version !== 'number' && typeof version !== 'string') || String(version).trim() === '') {
        throw new Error('src/privacy-policy.json must have a "version" (a number or string).');
    }
    return String(version);
}

function renderPolicy(markdown, defaultTitle) {
    var html = marked.parse(markdown, {gfm: true, breaks: false});
    // The page has its own heading: take the title from the first "# ...".
    var title = defaultTitle || 'Privacy Policy';
    html = html.replace(/^\s*<h1[^>]*>([\s\S]*?)<\/h1>\s*/, function(_, text) {
        title = text.replace(/<[^>]+>/g, '').trim() || title;
        return '';
    });
    // Web links open in a new tab (the page is also shown inside the consent page).
    html = html.replace(/<a href="(https?:[^"]*)"/g, '<a href="$1" target="_blank" rel="noopener noreferrer"');
    // Wide tables scroll on their own instead of widening the page.
    html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
    return {title: title, html: html};
}

function generateDocument(sourceName, defaultTitle, badgeLabel, outputFile) {
    var version = readPolicyVersion();
    var doc = renderPolicy(read(ROOT_DIR + sourceName), defaultTitle);
    var template = read(path.join(__dirname, 'template.html'));
    var page = template
        .replace(/\{\{TITLE\}\}/g, function() { return escapeHTML(doc.title); })
        .replace(/\{\{BADGE\}\}/g, function() { return escapeHTML(badgeLabel + ' ' + version); })
        .replace(/\{\{SOURCE\}\}/g, function() { return escapeHTML(sourceName); })
        .replace('{{CONTENT}}', function() { return doc.html.trim(); });
    fs.writeFileSync(outputFile, page);
}

// privacy.html, from PRIVACY.md.
function generate(outputFile) {
    generateDocument('PRIVACY.md', 'Privacy Policy', 'Policy version', outputFile);
}

// eula.html, from EULA.md.
function generateEula(outputFile) {
    generateDocument('EULA.md', 'End User License Agreement', 'Agreement version', outputFile);
}

exports.generate = generate;
exports.generateEula = generateEula;
exports.readPolicyVersion = readPolicyVersion;

if (require.main === module) {
    generate(process.argv[2] || ROOT_DIR + 'src/privacy.html');
    generateEula(process.argv[3] || ROOT_DIR + 'src/eula.html');
}
