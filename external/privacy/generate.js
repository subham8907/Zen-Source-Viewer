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
 * Generates privacy.html (the Privacy Policy page) from PRIVACY.md, with the
 * policy version from src/privacy-policy.json. Run by `node make.js firefox`
 * and `node make.js privacy`; do not edit privacy.html by hand.
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

function renderPolicy(markdown) {
    var html = marked.parse(markdown, {gfm: true, breaks: false});
    // The page has its own heading: take the title from the first "# ...".
    var title = 'Privacy Policy';
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

function generate(outputFile) {
    var version = readPolicyVersion();
    var policy = renderPolicy(read(ROOT_DIR + 'PRIVACY.md'));
    var template = read(path.join(__dirname, 'template.html'));
    var page = template
        .replace(/\{\{TITLE\}\}/g, function() { return escapeHTML(policy.title); })
        .replace(/\{\{VERSION\}\}/g, function() { return escapeHTML(version); })
        .replace('{{CONTENT}}', function() { return policy.html.trim(); });
    fs.writeFileSync(outputFile, page);
}

exports.generate = generate;
exports.readPolicyVersion = readPolicyVersion;

if (require.main === module) {
    generate(process.argv[2] || ROOT_DIR + 'src/privacy.html');
}
