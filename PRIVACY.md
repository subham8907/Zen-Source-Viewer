# Privacy Policy

**Zen Source Viewer** for Firefox\
Add-on ID: `zen-source-viewer-official@subhammahesh`

**Last updated:** 15 November 2026\
**Applies to:** version 3.0.33 and later (policy version 5)\
**Related:** [End User License Agreement](https://github.com/subham8907/Zen-Source-Viewer/blob/main/EULA.md)

---

## Summary

Zen Source Viewer lets you inspect, review and compare Firefox and Thunderbird
add-ons, and Chrome, Edge and Opera extensions, without installing them. It is
built so that your data stays with you.

**What changed in policy version 5 (add-on version 3.0.32):** you can open a
folder of your computer in the viewer and on the Compare page. Its files are
read on your device and never uploaded. To bring your changes back into the
folder, the add-on saves a temporary patch file in your Downloads folder and
deletes it again (section 3). It also remembers, on your device, the folder
paths you type for the terminal command and which temporary patch files are
still to be deleted. The scan of message keys used in an add-on's code runs on
your device too. The add-on still collects no data.

| | |
|---|---|
| **Personal data collected** | None |
| **Analytics, tracking, advertising** | None |
| **Servers operated by the developer** | None |
| **Network requests** | Only when you ask the add-on to fetch an add-on or file, and only for that |
| **Files and folders you open, upload or edit** | Stay in your browser tab; never uploaded |
| **Temporary patch files** | Saved in your Downloads folder only when you ask, and deleted again (section 3) |
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
| Click **View source** or **Download zip** in the toolbar popup on an add-on page of an add-on site you turned on (such as addons.mozilla.org, addons.thunderbird.net, the Chrome Web Store, Microsoft Edge Add-ons or Opera add-ons) | That add-on's file (XPI or CRX), from that site's download addresses (see the table of add-on sites below) |
| Choose **View linked extension source** or **View extension source** in the right-click menu | The file the link or page points to |
| Use **Chrome, Edge or Opera extension** on the viewer's **Open** page | That extension's CRX file, from the store you choose (only stores you turned on). For the Chrome Web Store, the request names the operating system, processor and Chrome version shown in the form (by default, those of your device), because the store serves files per platform |
| Open a **Chrome update file** (the `update_url` of an extension, an XML file), or click **Open the version it offers now** in the review report | The update file, then the CRX file it names, which may be on another website |
| Enter or drop a URL in the popup or the viewer, or open a viewer link that contains a URL | The file at that URL |
| Search for an add-on's versions (viewer's **Open** page, **Compare** page) | The list of versions, from the API of the add-on site you choose (only sites you turned on), then the version(s) you choose |
| Compare two versions by URL or from addons.mozilla.org | The two files you chose, from their websites |

**Add-on sites and the addresses they use.** A built-in site that is turned
on may be contacted at these addresses, and only when you open an add-on from
it. While a site is turned off, the add-on blocks its own requests to all of
them:

| Add-on site | Addresses | Run by |
|---|---|---|
| Firefox Add-ons | addons.mozilla.org, reviewers.addons.mozilla.org, services.addons.mozilla.org, addons.cdn.mozilla.net | Mozilla |
| Thunderbird Add-ons | addons.thunderbird.net | Thunderbird (MZLA Technologies) |
| Test and staging sites | addons.allizom.org, addons-dev.allizom.org, addons-dev-cdn.allizom.org, addons-stage.thunderbird.net | Mozilla, Thunderbird |
| Chrome Web Store | chromewebstore.google.com, chrome.google.com (pages); clients2.google.com and clients2.googleusercontent.com (files) | Google |
| Microsoft Edge Add-ons | microsoftedge.microsoft.com (pages); edge.microsoft.com, msedgeextensions.sf.tlu.dl.delivery.mp.microsoft.com and msedgeextensions.f.tlu.dl.delivery.mp.microsoft.com (files) | Microsoft |
| Opera add-ons | addons.opera.com (pages and downloads); addons-extensions.operacdn.com (files) | Opera |
| A site you add | The domain you enter | Whoever runs it |

Pages of the Chrome Web Store, Edge Add-ons and Opera add-ons are only
recognized from their address; the add-on does not load them. A Chrome
update file can name a file on any website; that website is contacted only
when you open the update file, and not at all if it is an add-on site you
turned off.

These requests go **directly from your browser to the website**. They do not
pass through any server of the developer. As with any request your browser
makes, the website receives the usual technical information (such as your IP
address and browser version), and Firefox may send that website's cookies, just
as when you visit it yourself. The add-on does not read, store or change cookies.

The websites you fetch from are subject to their own privacy policies:

- **addons.mozilla.org**: [Mozilla Privacy Policy](https://www.mozilla.org/privacy/) and
  [Mozilla Websites Privacy Notice](https://www.mozilla.org/privacy/websites/)
- **addons.thunderbird.net**: [Thunderbird Privacy Policy](https://www.thunderbird.net/privacy/)
- **Chrome Web Store** (chromewebstore.google.com, clients2.google.com): [Google Privacy Policy](https://policies.google.com/privacy)
- **Microsoft Edge Add-ons** (microsoftedge.microsoft.com, edge.microsoft.com): [Microsoft Privacy Statement](https://privacy.microsoft.com/privacystatement)
- **Opera add-ons** (addons.opera.com): [Opera Privacy Statement](https://legal.opera.com/privacy/)
- **A site you add yourself in Settings** (working like addons.mozilla.org, addons.thunderbird.net or a Chrome store): the privacy policy of that site
- **Any other address you enter or open**: the privacy policy of that website

**You choose which add-on sites it may contact.** Every site is **off by
default**. Right after you agree to this policy, the add-on asks which sites to
turn on (none are selected); you can change this at any time in **Settings > Add-on sites and right-click menu**, where each site is listed with a switch. Until you turn a site
on, it is never contacted. A site that is turned off is never contacted: its pages are not
recognized and the add-on blocks its own requests to it, including redirects to
the site's download servers. You can also add the domain of another add-on site
and remove it again. Zen Source Viewer is an independent project and is not
made, endorsed or sponsored by Mozilla, Thunderbird, Google, Microsoft, Opera or any listed site; listing
a site, including one you add, does not mean we endorse it.

**Everything else works offline.** Viewing, searching, editing, comparing, the
locale diff, the API descriptions, the review report and review notes all run
on your device. Links in the add-on (for example to API documentation on MDN or
to an add-on's listing) are ordinary links: a website is contacted only if you
click one.

**Pages you visit.** The toolbar popup looks at the address of the current tab
only while it is open, and only to check, on your device, whether it is an
add-on page, an `.xpi` or `.crx` link, or a Chrome update file of a site you
added. The context menu item appears only on links to
add-on files and add-on pages (plus any link patterns you add in Settings > Add-on sites and right-click menu).
The add-on does not read the content of web pages, and does not record or
send which pages you visit.

## 3. Information stored on your device

The add-on stores only what it needs to work, and only on your device:

| What | Where | How long |
|---|---|---|
| **Settings**: your color theme, the right-click menu option and your link patterns, what the toolbar button does on add-on pages, which file types the viewer shows | Firefox's add-on storage (`storage.sync`) | Until you change them or remove the add-on |
| **Display preferences**: the layout and filter of the locale diff, and a local cache of the color theme | The add-on's local storage | Until you remove the add-on |
| **Add-on sites**: which sites are turned on, and the domains you added and how each works | The add-on's storage (`storage.local`) and local storage, on this device only (not synced) | Until you change them or remove the add-on |
| **Privacy consent**: the version of this policy and of the End User License Agreement you agreed to, and when | The add-on's storage (`storage.local`) and local storage | Until you withdraw your consent in Settings or remove the add-on |
| **Review notes**: your notes, with the file name, line number and the text of that line | The tab's session storage | Until you close the tab |
| **Folder paths** you type in the **Folder path** field of the terminal dialog (optional), by folder name, to fill in the `cd` command | The add-on's local storage, on this device only | Until you clear the field or remove the add-on |
| **Temporary patch files**: the patch with your changes, saved when you choose **Save to folder**, **Apply in terminal** or **Terminal** | Your Downloads folder (`zen-source-viewer-<name>-changes.patch`) | With **Temporary** ticked (the default): until you close the dialog, at most 10 minutes; if the tab was closed first, until the add-on's viewer next opens. Untick **Temporary** to keep the file |
| **The list of temporary patch files still to delete**: their download numbers and when they were saved | The add-on's local storage | Until each file is deleted |
| **Opened add-ons and files, your edits, uploads, searches** | The tab's memory | Until you close the tab |

If you use **Firefox Sync**, Firefox may sync the settings in `storage.sync`
between your devices through your Mozilla account. This is done by Firefox and
is subject to the [Firefox Privacy Notice](https://www.mozilla.org/privacy/firefox/) and the
[Mozilla Accounts Privacy Notice](https://www.mozilla.org/privacy/mozilla-accounts/).
The developer has no access to it. Review notes, display preferences and files
are never synced.

**Uploading** a file (in the popup, the viewer or the Compare page), **opening
a folder** (in the viewer or the Compare page) or choosing a patch file with
**Apply patch** only reads the files from your computer; they are not sent
anywhere. In a folder, the `.git` and `node_modules` folders are not read.
**Reload folder** reads the same folder again, only when you click it. The
add-on never writes into your folders: changes reach them only through a
command you run yourself in a terminal. Patches, reports and exported notes are created on your
device, and files are saved to your computer only when you click a download or
export button.

## 4. Permissions

Firefox asks you to allow these permissions when you install the add-on. This is
why each one is needed:

| Permission | Why it is needed |
|---|---|
| **Access your data for all websites** (`*://*/*`) | To download an add-on (XPI or CRX), a Chrome update file or a zip file from the address you choose. It is not used to read or change web pages. |
| **Access browser tabs** (`tabs`) | To check, while the popup is open, whether the current tab is an add-on page (including a page of the Chrome Web Store, Edge Add-ons or Opera add-ons, if turned on), and to open the viewer in a tab next to it. |
| **Storage** (`storage`) | To remember your settings (section 3). |
| **Context menus** (`contextMenus`) | To add **View linked extension source** and the toolbar button's menu. |
| **Downloads** (`downloads`) | To save a file when you click a download button, and to save the temporary patch file of **Save to folder** and delete it again (also from Firefox's list of downloads). The add-on deletes only patch files it saved itself. |
| **Containers** (`cookies`) | To open the viewer in the same container as the page you came from. The add-on does not read or change cookies. |
| **Web requests** (`webRequest`, `webRequestBlocking`) | For the add-on's own requests only: to download from addons.mozilla.org, which Firefox otherwise restricts for add-ons, and to block requests to add-on sites you turned off. It does not see or change any other requests. |

## 5. Your choices

- **Review notes**: export them (as `.txt` or Markdown) to keep them, or delete
  them in the **Notes** view. They are deleted when you close the tab.
- **Privacy consent**: the add-on does nothing until you agree to this policy
  and the End User License Agreement, and asks again when either changes. You can withdraw your consent in
  **Settings**; the add-on then stops working until you agree again.
- **Temporary patch files**: untick **Temporary** in the terminal dialog to
  keep the patch file; otherwise it is deleted as described in section 3.
  Clear the **Folder path** field to forget the path of a folder.
- **Right-click menu**: turn it off, or add link patterns where it appears, in
  **Settings > Add-on sites and right-click menu**.
- **Add-on sites**: turn any site off (including the Chrome, Edge and Opera
  stores), add your own, or remove them, in
  **Settings > Add-on sites and right-click menu**.
- **Remove everything**: removing the add-on in Firefox (`about:addons`) deletes
  its settings and stored preferences from your device.

## 6. Children

The add-on does not collect information from anyone, including children.

## 7. Changes to this policy

Changes to this policy are published in this file
([PRIVACY.md](https://github.com/subham8907/Zen-Source-Viewer/blob/main/PRIVACY.md)) with
a new "Last updated" date, and noted in the release notes. When a change needs
your consent, the policy version goes up and the add-on asks you again.

| Policy version | Add-on versions | Change |
|---|---|---|
| 5 | 3.0.2 and later | Choice of add-on sites, all off by default; Chrome, Edge and Opera stores and CRX files; Chrome update files; sites that work like a Chrome store; local folders in the viewer and on the Compare page, read on your device; temporary patch files in the Downloads folder, deleted again; folder paths and the list of temporary patch files kept in local storage; End User License Agreement, which ends only the rights it grants, not your rights under the open-source licenses, and the add-on can also be redistributed under those licenses alone; no warranty that patches, fixes, imports and commands the add-on prepares are correct, and you are responsible for changes you write to your own files |

The add-on will not start collecting data without asking for your consent first.

## 8. Contact

For questions about this policy or about privacy in Zen Source Viewer, please
[open an issue](https://github.com/subham8907/Zen-Source-Viewer/issues) on GitHub.

---

Zen Source Viewer is developed by Subham Mahesh, based on Rob Wu's open-source
Extension source viewer, and distributed under the Mozilla Public License 2.0
and the File-Level Permissive License 1.0. Use of the packaged add-on is also
subject to the [End User License Agreement](https://github.com/subham8907/Zen-Source-Viewer/blob/main/EULA.md),
which does not limit your rights in the
[source code](https://github.com/subham8907/Zen-Source-Viewer).
