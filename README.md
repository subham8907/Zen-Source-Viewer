# Zen Source Viewer

**Inspect, review and compare Firefox and Thunderbird add-ons, before you install them.**

Zen Source Viewer opens any add-on (`.xpi`), Chrome, Edge or Opera extension
(`.crx`) or zip file in a fast, clean code
viewer in your browser. Read its source, see exactly what it is allowed to do,
check its code for risky patterns, compare two versions, and review its
translations: without installing it, and without sending anything anywhere.

It is a Firefox add-on, built on Rob Wu's open-source
[Extension source viewer (CRX Viewer)](https://github.com/Rob--W/crxviewer).

📖 **[User Guide](docs/USER_GUIDE.md)**: how to use every feature, with screenshots.

---

## Who it is for

- **Users** who want to know what an add-on does before trusting it with their browser.
- **Add-on reviewers** checking permissions, remote code and obfuscation, and what
  changed in a new version.
- **Developers** reading other add-ons, debugging their own builds, or preparing patches.
- **Translators** finding missing, outdated and untranslated messages.

## Features

### Open any add-on
- One click on an add-on page of addons.mozilla.org or addons.thunderbird.net,
  or of the Chrome Web Store, Microsoft Edge Add-ons or Opera add-ons:
  **View source** or **Download zip**. Every add-on site is off until you turn it
  on in Settings, where you can also add your own sites, including Chrome-style
  ones whose Chrome update files (`update_url`) are followed to the `.crx`.
- Open any `.xpi`, `.crx` or `.zip` from a URL, a link (right-click menu), or your computer
  (upload or drag and drop). Find and open any older version on addons.mozilla.org.
- Embedded zip files can be opened too.

### Read the code
- A folder tree with file-type filters, and file search by name (regular
  expressions) or by content (`name!text`).
- A CodeMirror 6 editor with syntax highlighting, code folding, search and
  replace, and **Beautify** for minified code.
- **Quick open** (Ctrl/⌘+P), **go to symbol**, go to line, and **tabs** for
  recently opened files.
- Image preview, file hashes (MD5 to SHA-512), and shareable links to a file and search.

### Review an add-on
- **Review report**: every permission with what it allows and how much it
  matters, site access, content scripts and content security policy; risky code
  (`eval`, `new Function`, HTML from variables, remote scripts, code injection,
  WebAssembly, minified or obfuscated files), each linked to its line; every web
  address in the code; and message keys the code uses but never defines.
- **APIs**: the WebExtension APIs the add-on uses, with short offline
  descriptions, and `!api:tabs.query`-style search.
- **Review notes** on any line, exported as `.txt` or Markdown.

### Compare versions
- Compare two versions (from URLs, addons.mozilla.org, files or local folders): added,
  modified and removed files with split or unified diffs.
- **Permission changes**: what the new version asks for that the old one did not.
- **Outdated translations**: messages whose source text changed while a
  translation stayed the same.

### Check translations
- **Locale coverage** for every `_locales/*/messages.json`, against the default
  locale or any other.
- A side-by-side **locale diff**, aligned by key, that tells **missing** keys
  (users see the default text) apart from text that is the **same as the
  reference**, flags changed placeholders, and lets you edit messages or add
  missing keys in place.
- **Auto-fix placeholders** (`$1` written as `%1`, `: 1` or `＄1`, renamed
  `$NAME$`), with every fix reviewed before it is written.
- **Export** the keys that need translating to JSON and **import** the
  translations back, for one language or all of them at once.
- **All languages**: every language's problems by category in one table.
- **In code**: the message keys the JS, HTML, CSS and manifest actually use,
  including keys built at run time (`'help_line' + i` → `help_line*`), checked
  against `messages.json`: keys missing from it, keys built at run time that
  match nothing, invalid names, and messages nothing uses.

### Edit and patch
- Edit any file, create, rename and delete files and folders, and review every
  change in a **Changes panel** with inline or side-by-side diffs.
- Download the edited add-on as a zip, or your changes as a **Git-style patch**.
- **Apply patches** from `git diff` (including binary patches); patches made
  here work with `git apply`.
- **Work on a local folder**: open your add-on's source folder, edit it here,
  and **Save to folder** with a temporary patch file and a ready-to-copy
  terminal command (`git apply`), since Firefox does not let add-ons write
  into folders. **Reload folder** reads it from disk again and checks that
  every change arrived.

## Getting started

1. Install Zen Source Viewer in Firefox (115 or later), or [build it](#building) yourself.
2. Open an add-on page on [addons.mozilla.org](https://addons.mozilla.org/) and click
   the **Zen Source Viewer** button in the toolbar, then **View source**.
3. Or click the button on any page to upload an `.xpi`, `.crx` or `.zip` file, or to paste a URL.

The [User Guide](docs/USER_GUIDE.md) walks through every feature step by step.

## Privacy

Zen Source Viewer does not collect any data: no analytics, no tracking, no servers
of its own. It connects to a website only when you ask it to fetch an add-on or
file, and files and folders you open never leave your computer. Review notes are
kept only until you close the tab, and temporary patch files are deleted again.
See the [privacy policy](PRIVACY.md).

The add-on asks you to agree to the privacy policy and the
[End User License Agreement](EULA.md) before it does anything, and asks again
whenever either changes. You can withdraw your consent in **Settings**.

---

## Development

### Building

Requires [Node.js](https://nodejs.org/) (22 or later).

```bash
npm install
node make.js firefox
```

The add-on is written to `dist/firefox/` (load it from `about:debugging`) and
packaged as `dist/zen-source-viewer.zip`.

### Privacy policy and consent

- `PRIVACY.md` is the privacy policy. The **Privacy Policy** page
  (`privacy.html`) is generated from it on every build by
  `external/privacy/generate.js`. Do not edit `privacy.html`; run
  `node make.js privacy` to write it to `src/` when testing without a build.
- `src/privacy-policy.json` holds the policy `version`. **Raise it when the
  policy changes in a way users must agree to again**: everyone is then asked to
  agree again, and the add-on does nothing until they do.
- `src/consent-gate.js` must be the first script in every page of the add-on
  (except `consent.html`, `privacy.html` and `license.html`). Without consent to
  the current version it stops the page before any other script runs and opens
  `consent.html`, which returns to the page after the user agrees. The
  background script ignores requests until then.

### Third-party libraries

All libraries come from npm and are bundled into `src/lib/` with esbuild, **not
minified**, so that they can be reviewed. The bundles are defined in
`external/bundles.js`:

| Library | Bundle | Used for |
|---|---|---|
| CodeMirror 6 | `src/lib/codemirror/zen-editor.js` | Code editor, diffs |
| zip.js (`@zip.js/zip.js`) | `src/lib/zip.js/zip.js` | Reading and writing zip files ([1.x API layer](external/zipjs/zip-compat.js)) |
| js-beautify | `src/lib/beautify/` | Formatting minified code |
| strip-json-comments | `src/lib/strip-json-comments.js` | Reading manifests with comments |
| jsdiff, fflate, `@noble/hashes` | `src/lib/jsdiff.js` | Creating and applying patches |
| `@noble/hashes` | `src/lib/noble-md5.js` | MD5 hashes |

After updating a package, rebuild the bundles with `node make.js bundles`.

### Project layout

| Path | Contents |
|---|---|
| `src/viewer.html`, `viewer.js`, `viewer.less` | The viewer |
| `src/theme.less`, `viewer-dark.less` | Shared light and dark theme for all pages |
| `src/theme.js` | Saved appearance and live theme updates across pages |
| `src/locale-diff.js` | Locale diff: Messages, File diff, All languages and In code views |
| `src/i18n-usage.js` | Finds the message keys used in the code (In code view) |
| `src/local-folder.js` | Opening a local folder (viewer and Compare); saving changes with a temporary patch and a terminal command |
| `src/review-report.js`, `review-notes.js` | Review report, review notes |
| `src/navigator.js`, `file-ops.js`, `main-view.js` | Quick open and tabs, file operations, shared views |
| `src/compare.html`, `compare.js` | Compare page |
| `src/popup.html`, `popup.js`, `background.js` | Toolbar button and popup |
| `src/options.html`, `license.html` | Settings, License & Credits |
| `src/consent.html`, `consent.js`, `consent-gate.js`, `consent-state.js`, `privacy-policy.json` | Privacy consent (see above) |
| `external/` | Bundle sources, license and privacy page generation |
| `docs/` | User guide and screenshots |

### Releasing

Releases are made by the **Release** GitHub Actions workflow
(`.github/workflows/release-build.yml`): open **Actions → Release → Run workflow**.
It needs no input. It:

1. checks that `src/lib` matches `package-lock.json`;
2. bumps the version (last number + 1, e.g. `2.0.5` → `2.0.6`);
3. builds the add-on and runs `web-ext lint`;
4. submits it to the public listing on addons.mozilla.org with its source code
   (`web-ext sign --channel listed --upload-source-code`);
5. pushes the `Version x.y.z` commit and the `vx.y.z` tag, and publishes a GitHub
   release with the package and the source code.

Nothing is pushed if the submission fails. Signing uses two repository secrets
(**Settings → Secrets and variables → Actions**) with
[addons.mozilla.org API credentials](https://addons.mozilla.org/developers/addon/api/key/):
`WEB_EXT_API_KEY` (JWT issuer) and `WEB_EXT_API_SECRET` (JWT secret). The first
listed version of a new add-on must be submitted on the addons.mozilla.org website.

---

## Credits and license

**Original work:** © 2013–2026 [Rob Wu](https://robwu.nl/) <rob@robwu.nl>, with
contributions from Peter Wu, xnumad, Ng Yik Phang, utkarshspat, Patrick Kettner,
cyrozap, Snazzah and Damien.

**Zen Source Viewer:** © 2026 Subham Mahesh. A Firefox-only redesign and extension
of the original: new interface, editor, review, comparison, translation and patch
tools. Every modified source file carries a "Modified by Subham Mahesh" notice.

**Licenses.** The license of each source file is stated at the top of that file.

- **[Mozilla Public License 2.0](LICENSE)** (MPL-2.0): the original work and every
  file of it that was modified, for example `src/viewer.js`, `viewer.html`,
  `viewer.less`, `popup.*`, `options.*`, `background.js`, `addon-urls.js` and `make.js`.
- **[File-Level Permissive License 1.0](LICENSE.txt)** (FLPL-1.0): files written
  entirely by Subham Mahesh, who is their sole copyright owner. These are the
  files whose header says so (for example `src/compare.*`, `review-*.js`,
  `locale-diff.js`, `i18n-usage.js`, `local-folder.js`, `navigator.js`, `file-ops.js`, `main-view.js`, the `consent*`
  files, `license.*`, `privacy.js`, the bundle entry points and generators in
  `external/`, and the release workflow), and these files that cannot carry a
  header: `PRIVACY.md`, `EULA.md`, `src/privacy-policy.json`, `docs/` (user guide and
  screenshots), and the add-on icons in `src/icons/` and `firefox-stuff/icon64.png`.

<a href="docs/FLPL.html"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/logo/flpl-logo-dark.svg">
  <img src="docs/logo/flpl-logo.svg" alt="FLPL: File-Level Permissive License" width="320">
</picture></a>

[NOTICE.txt](NOTICE.txt) lists every FLPL file and is shipped with the add-on.

**End User License Agreement.** The packaged add-on (Object form) is also offered
under an [End User License Agreement](EULA.md): use for any lawful purpose,
no unlawful use, no warranty. It does not limit or alter anyone's rights in the
source code: MPL-2.0 (section 3.2) allows separate terms for the Object form
only on that condition, and under FLPL-1.0 (section 4(e)) such terms are always
a sublicense that remains governed by the FLPL, never replaces it, and does not
affect copies received other than under it. The source code of
every release is on the [releases page](https://github.com/subham8907/Zen-Source-Viewer/releases).
The FLPL applies one file at a time, like the MPL, so the two licenses sit side by
side in the same add-on.

Third-party components (CodeMirror 6 and its dependencies, zip.js, js-beautify,
strip-json-comments, jsdiff, fflate and `@noble/hashes`, plus code they include
from zlib, Acorn and Esprima) remain under their own licenses (MIT, BSD-3-Clause,
BSD-2-Clause, Zlib). The full list with every license text is generated at build
time by `external/licenses/generate.js` and shown on the add-on's **License &
Credits** page.
