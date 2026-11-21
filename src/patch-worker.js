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
 * Creates patches in the background (see ZenPatch.createGitPatchAsync).
 */
/* globals ZenPatch */
'use strict';
importScripts('lib/jsdiff.js');

self.onmessage = function(event) {
    var lastReport = 0;
    try {
        var patch = ZenPatch.createGitPatch(event.data.files, function(done, total) {
            var now = Date.now();
            if (now - lastReport > 100) {
                lastReport = now;
                self.postMessage({progress: done, total: total});
            }
        });
        self.postMessage({patch: patch});
    } catch (e) {
        self.postMessage({error: String(e && e.message || e)});
    }
};
