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
 * privacy.html (generated from PRIVACY.md): compact layout when the page is
 * shown inside the consent page (privacy.html?embed). */

/* jshint browser:true */
'use strict';

if (/[?&]embed\b/.test(location.search)) {
    document.documentElement.classList.add('embed');
}
