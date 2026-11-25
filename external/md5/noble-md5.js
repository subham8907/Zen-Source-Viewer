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
 * Entry point for the MD5 implementation used by lib/modern-crypto.js.
 * Bundled by `node make.js bundles` into src/lib/noble-md5.js, which exposes
 * the global `NobleMD5`. Browsers do not offer MD5 in crypto.subtle, so it
 * comes from @noble/hashes (MIT license); the SHA hashes use crypto.subtle.
 */

import {md5} from '@noble/hashes/legacy.js';
import {bytesToHex} from '@noble/hashes/utils.js';

window.NobleMD5 = {
    // Returns the MD5 hash of a Uint8Array as a lowercase hex string.
    hex(uint8Array) {
        return bytesToHex(md5(uint8Array));
    },
};
