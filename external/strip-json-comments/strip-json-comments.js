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
 * Entry point for strip-json-comments (MIT license), which makes it possible
 * to parse manifest.json files that contain comments or trailing commas.
 * Bundled by `node make.js bundles` into src/lib/strip-json-comments.js, which
 * exposes the global `stripJsonComments` (in pages and in workers).
 */

import stripJsonComments from 'strip-json-comments';

self.stripJsonComments = stripJsonComments;
