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
 * Entry point for js-beautify (MIT license), used by lib/beautify/worker-beautify.js.
 * Bundled by `node make.js bundles` into src/lib/beautify/beautifier.js, which
 * exposes the global `beautifier` with the functions js, css and html.
 * Only the beautifier core is bundled, not the command-line tool.
 */

import jsBeautify from 'js-beautify/js/src/index.js';

self.beautifier = {
    js: jsBeautify.js,
    css: jsBeautify.css,
    html: jsBeautify.html,
};
