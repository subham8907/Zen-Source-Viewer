#!/usr/bin/env node
/**
 * (c) 2013 Rob Wu <rob@robwu.nl>
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Modified by Subham Mahesh (2026): build reduced to a Firefox-only target;
 * added the bundle targets (CodeMirror, MD5); removed CRX helper files; generates
 * the third-party license list for license.html; generates privacy.html from
 * PRIVACY.md, and eula.html (and EULA.txt) from EULA.md; ships docs/FLPL.html
 * unchanged as flpl.html. */

// Build tool, adapted from PDF.js
/* jshint node:true */
/* globals cd, cp, echo, exec, find, grep, mkdir, rm, target, test, which */

'use strict';
require('shelljs/make');
var builder = require('./external/builder');


var ROOT_DIR = __dirname + '/';
var BUILD_DIR = ROOT_DIR + 'dist/';
var SRC_DIR = ROOT_DIR + 'src/';
var FIREFOX_BUILD_DIR = BUILD_DIR + 'firefox/';
var ALLOWED_FILES = [
    'manifest.json',
    'privacy-policy.json',
    '.css',
    '.html',
    '.js',
    '.png',
    '.txt',
];

function getVersionString() {
    cd(ROOT_DIR);
    var gitHash = exec('git log --format=%H -n1', {silent: true}).stdout.trim();
    return gitHash || '(unknown version)';
}

function getBuildConfig(options) {
    var dest_dir = options.build_dir;
    var setup = {
        defines: {
            VERSION: getVersionString(),
        },
        mkdirs: [
            dest_dir + 'icons',
            dest_dir + 'images',
        ],
        copy: [
            [SRC_DIR + 'lib', dest_dir],
            [SRC_DIR + 'icons/*.png', dest_dir + 'icons'],
            [SRC_DIR + 'manifest.json', dest_dir],
            [SRC_DIR + 'privacy-policy.json', dest_dir],
            [ROOT_DIR + 'LICENSE', dest_dir + 'LICENSE.txt'],
            [ROOT_DIR + 'LICENSE.txt', dest_dir + 'LICENSE-FLPL.txt'],
            [ROOT_DIR + 'NOTICE.txt', dest_dir + 'NOTICE.txt'],
            [ROOT_DIR + 'EULA.md', dest_dir + 'EULA.txt'],
            // The license logo, shown on license.html (light and dark versions).
            [ROOT_DIR + 'docs/logo/flpl-logo.png', dest_dir + 'images'],
            [ROOT_DIR + 'docs/logo/flpl-logo-dark.png', dest_dir + 'images'],
            [ROOT_DIR + 'docs/logo/NOTICE.txt', dest_dir + 'images/NOTICE.txt'],
        ],
        preprocess: [
            [SRC_DIR + '*.html', dest_dir],
            [SRC_DIR + '*.js', dest_dir],
        ]
    };
    if (options.defines)
        for (var key in options.defines)
            setup.defines[key] = options.defines[key];
    if (options.copy) [].push.apply(setup.copy, options.copy);
    if (options.preprocess) [].push.apply(setup.preprocess, options.preprocess);

    return setup;
}
function cleanDirectory(dir) {
    if (test('-d', dir))
        rm('-rf', dir + '*'); // Append wildcard to preserve the directory
    else
        mkdir('-p', dir);
}

function build(setup, output_root_dir) {
    cleanDirectory(output_root_dir);
    builder.build(setup);
    // Licenses of all third-party code, shown on license.html.
    require('./external/licenses/generate').generate(output_root_dir + 'third-party-licenses.js');
    // The Privacy Policy page, from PRIVACY.md and the version in privacy-policy.json.
    require('./external/privacy/generate').generate(output_root_dir + 'privacy.html');
    // The End User License Agreement page, from EULA.md.
    require('./external/privacy/generate').generateEula(output_root_dir + 'eula.html');
    // The File-Level Permissive License page: docs/FLPL.html, unchanged.
    copyFlplPage(output_root_dir + 'flpl.html');
    exec(ROOT_DIR + '/node_modules/.bin/lessc --strict-math=on "' + SRC_DIR + 'viewer.less" "' + output_root_dir + 'viewer.css"');
    exec(ROOT_DIR + '/node_modules/.bin/lessc --strict-math=on "' + SRC_DIR + 'theme.less" "' + output_root_dir + 'theme.css"');
}

// Copies docs/FLPL.html, byte for byte, to outputFile. Fails if docs/FLPL.html
// is not exactly the page generated from the current LICENSE.txt (run
// "node external/licenses/flpl-html.js" to update it), or if the copy differs.
function copyFlplPage(outputFile) {
    var fs = require('fs');
    var docsPage = fs.readFileSync(ROOT_DIR + 'docs/FLPL.html');
    var expected = Buffer.from(require('./external/licenses/flpl-html').html(), 'utf8');
    if (!docsPage.equals(expected)) {
        throw new Error('docs/FLPL.html is out of date with LICENSE.txt. ' +
            'Run "node external/licenses/flpl-html.js" first.');
    }
    fs.writeFileSync(outputFile, docsPage);
    if (!fs.readFileSync(outputFile).equals(docsPage)) {
        throw new Error('flpl.html is not an exact copy of docs/FLPL.html.');
    }
}

function removeTestFiles() {
    rm('test-asn1.html');
}

function lintDir(dest_dir) {
    var warningCount = 0;
    find(dest_dir).forEach(function(filepath) {
        if (/\/\.[^\/]*$/.test(filepath)) {
            echo('WARNING: Found dot file: ' + filepath);
            ++warningCount;
            return;
        }
        if (test('-d', filepath)) {
            return;
        }
        var unprocessed = grep('//#', filepath).trim();
        if (unprocessed) {
            echo('WARNING: unprocessed text in' + filepath);
            echo(unprocessed);
            ++warningCount;
        }
        if (!ALLOWED_FILES.some(function(p) {
            return p.test ? p.test(filepath) : filepath.endsWith(p);
        })) {
            echo('WARNING: Unrecognized file: ' + filepath);
            ++warningCount;
        }
    });
    if (warningCount) {
        process.nextTick(function() {
            echo('WARNING: ' + warningCount + ' warnings in ' + dest_dir);
        });
    }
}

function zipDirectory(zipPath) {
    rm('-f', zipPath);
    // Prefer 7z when available, fall back to the standard zip utility.
    var hasSevenZip = !!which('7z');
    if (hasSevenZip) {
        exec('7z a "' + zipPath + '" * -tzip');
    } else {
        exec('zip -qr "' + zipPath + '" .');
    }
}

// Writes third-party-licenses.js to src/ for testing license.html without a build.
target.licenses = function() {
    echo();
    echo('Generating third-party-licenses.js...');
    require('./external/licenses/generate').generate(SRC_DIR + 'third-party-licenses.js');
};

// Writes privacy.html to src/ (from PRIVACY.md) for testing without a build.
target.privacy = function() {
    echo();
    echo('Generating privacy.html...');
    require('./external/privacy/generate').generate(SRC_DIR + 'privacy.html');
};

// Writes eula.html to src/ (from EULA.md) for testing without a build.
target.eula = function() {
    echo();
    echo('Generating eula.html...');
    require('./external/privacy/generate').generateEula(SRC_DIR + 'eula.html');
};

// Copies docs/FLPL.html to src/flpl.html for testing without a build.
target.flpl = function() {
    echo();
    echo('Copying flpl.html...');
    copyFlplPage(SRC_DIR + 'flpl.html');
};

target.all = function() {
    target.bundles();
    target.firefox();
};

// Builds the JavaScript bundles from npm packages (see external/bundles.js):
// CodeMirror 6 into src/lib/codemirror/zen-editor.js and the MD5 hash of
// @noble/hashes into src/lib/noble-md5.js.
target.bundles = function() {
    var bundles = require('./external/bundles');
    bundles.BUNDLES.forEach(function(bundle) {
        echo();
        echo('Bundling ' + bundle.id + '...');
        bundles.buildBundle(bundle);
    });
};
// Kept for convenience: `node make.js codemirror` rebuilds all bundles.
target.codemirror = function() {
    target.bundles();
};

target.firefox = function() {
    echo();
    echo('Building Firefox addon...');
    var setup = getBuildConfig({
        build_dir: FIREFOX_BUILD_DIR,
    });
    build(setup, FIREFOX_BUILD_DIR);

    cd(FIREFOX_BUILD_DIR);
    removeTestFiles();
    zipDirectory('../zen-source-viewer.zip');
    lintDir(FIREFOX_BUILD_DIR);
};
