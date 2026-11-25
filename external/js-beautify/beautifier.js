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
