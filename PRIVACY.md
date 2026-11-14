# Privacy Policy

**Zen Source Viewer** for Firefox\
Add-on ID: `zen-source-viewer-official@subhammahesh`

**Last updated:** 11 November 2026\
**Applies to:** version 2.0.11 and later

---

## Summary

Zen Source Viewer lets you inspect, review and compare Firefox and Thunderbird
add-ons without installing them. It is built so that your data stays with you.

| | |
|---|---|
| **Personal data collected** | None |
| **Analytics, tracking, advertising** | None |
| **Servers operated by the developer** | None |
| **Network requests** | Only when you ask the add-on to fetch an add-on or file, and only for that |
| **Files you open, upload or edit** | Stay in your browser tab; never uploaded |
| **Review notes** | Kept only until you close the tab |
| **Data sold or shared** | None |

---

## 1. Information we collect

**We do not collect any information.** The developer of Zen Source Viewer
receives no data from the add-on: no personal information, browsing history,
usage statistics, crash reports, device identifiers or anything else.

The add-on contains no analytics, telemetry or advertising code, and it does
not load or run code from the internet. All of its code, including third-party
libraries, is part of the add-on package and can be reviewed (see the
[source code](https://github.com/subham8907/Zen-Source-Viewer)).

## 2. When the add-on connects to the internet

The add-on makes a network request **only when you ask it to**, and it requests
**only what you asked for**:

| What you do | What is requested, and from where |
|---|---|
| Click **View source** or **Download zip** in the toolbar popup on an add-on page of addons.mozilla.org or addons.thunderbird.net | That add-on's file (XPI), from that website |
| Choose **View linked extension source** in the context menu of a link | The file the link points to |
| Enter or drop a URL in the popup or the viewer, or open a viewer link that contains a URL | The file at that URL |
| Search for an add-on's versions (viewer's **Open** page, **Compare** page) | The list of versions, from the addons.mozilla.org API, then the version(s) you choose |
| Compare two versions by URL or from addons.mozilla.org | The two files you chose, from their websites |

These requests go **directly from your browser to the website**. They do not
pass through any server of the developer. As with any request your browser
makes, the website receives the usual technical information (such as your IP
address and browser version), and Firefox may send that website's cookies, just
as when you visit it yourself. The add-on does not read, store or change cookies.

The websites you fetch from are subject to their own privacy policies:

- **addons.mozilla.org**: [Mozilla Privacy Policy](https://www.mozilla.org/privacy/) and
  [Mozilla Websites Privacy Notice](https://www.mozilla.org/privacy/websites/)
- **addons.thunderbird.net**: [Thunderbird Privacy Policy](https://www.thunderbird.net/privacy/)
- **Any other address you enter or open**: the privacy policy of that website

**Everything else works offline.** Viewing, searching, editing, comparing, the
locale diff, the API descriptions, the review report and review notes all run
on your device. Links in the add-on (for example to API documentation on MDN or
to an add-on's listing) are ordinary links: a website is contacted only if you
click one.

**Pages you visit.** The toolbar popup looks at the address of the current tab
only while it is open, and only to check, on your device, whether it is an
add-on page or an `.xpi` link. The context menu item appears only on links to
add-on files and add-on pages (plus any URL patterns you add in Settings).
The add-on does not read the content of web pages, and does not record or
send which pages you visit.

## 3. Information stored on your device

The add-on stores only what it needs to work, and only on your device:

| What | Where | How long |
|---|---|---|
| **Settings**: the context menu option and your URL patterns, what the toolbar button does on add-on pages, which file types the viewer shows | Firefox's add-on storage (`storage.sync`) | Until you change them or remove the add-on |
| **Display preferences**: the layout and filter of the locale diff | The add-on's local storage | Until you remove the add-on |
| **Privacy consent**: the version of this policy you agreed to, and when | The add-on's storage (`storage.local`) and local storage | Until you withdraw your consent in Settings or remove the add-on |
| **Review notes**: your notes, with the file name, line number and the text of that line | The tab's session storage | Until you close the tab |
| **Opened add-ons and files, your edits, uploads, searches** | The tab's memory | Until you close the tab |

If you use **Firefox Sync**, Firefox may sync the settings in `storage.sync`
between your devices through your Mozilla account. This is done by Firefox and
is subject to the [Firefox Privacy Notice](https://www.mozilla.org/privacy/firefox/) and the
[Mozilla Accounts Privacy Notice](https://www.mozilla.org/privacy/mozilla-accounts/).
The developer has no access to it. Review notes, display preferences and files
are never synced.

**Uploading** a file (in the popup, the viewer or the Compare page) or choosing
a patch file with **Apply patch** only reads the file from your computer; it is
not sent anywhere. Patches, reports and exported notes are created on your
device, and files are saved to your computer only when you click a download or
export button.

## 4. Permissions

Firefox asks you to allow these permissions when you install the add-on. This is
why each one is needed:

| Permission | Why it is needed |
|---|---|
| **Access your data for all websites** (`*://*/*`) | To download an add-on or zip file from the address you choose. It is not used to read or change web pages. |
| **Access browser tabs** (`tabs`) | To check, while the popup is open, whether the current tab is an add-on page, and to open the viewer in a tab next to it. |
| **Storage** (`storage`) | To remember your settings (section 3). |
| **Context menus** (`contextMenus`) | To add **View linked extension source** and the toolbar button's menu. |
| **Downloads** (`downloads`) | To save a file when you click a download button. |
| **Containers** (`cookies`) | To open the viewer in the same container as the page you came from. The add-on does not read or change cookies. |
| **Web requests** (`webRequest`, `webRequestBlocking`) | Only for the add-on's own downloads from addons.mozilla.org, which Firefox otherwise restricts for add-ons. It does not see or change any other requests. |

## 5. Your choices

- **Review notes**: export them (as `.txt` or Markdown) to keep them, or delete
  them in the **Notes** view. They are deleted when you close the tab.
- **Privacy consent**: the add-on does nothing until you agree to this policy,
  and asks again when the policy changes. You can withdraw your consent in
  **Settings**; the add-on then stops working until you agree again.
- **Context menu**: turn it off, or change where it appears, in **Settings**.
- **Remove everything**: removing the add-on in Firefox (`about:addons`) deletes
  its settings and stored preferences from your device.

## 6. Children

The add-on does not collect information from anyone, including children.

## 7. Changes to this policy

Changes to this policy are published in this file
([PRIVACY.md](https://github.com/subham8907/Zen-Source-Viewer/blob/master/PRIVACY.md)) with
a new "Last updated" date, and noted in the release notes. The add-on will not
start collecting data without asking for your consent first.

## 8. Contact

For questions about this policy or about privacy in Zen Source Viewer, please
[open an issue](https://github.com/subham8907/Zen-Source-Viewer/issues) on GitHub.

---

Zen Source Viewer is developed by Subham Mahesh, based on Rob Wu's open-source
Extension source viewer, and distributed under the Mozilla Public License 2.0.
