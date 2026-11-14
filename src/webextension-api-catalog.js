/*
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
 */
/**
 * Added by Subham Mahesh, 2026: offline API descriptions for the API report.
 * Short, offline descriptions of common Firefox WebExtension APIs.
 * Summaries are paraphrased from Mozilla's MDN API index:
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API
 * Member descriptions link to each API's live MDN reference for full details.
 */
'use strict';

var WEBEXTENSION_API_CATALOG = {
    action: {
        title: 'Toolbar action',
        summary: 'Controls the extension button in the browser toolbar and reacts to clicks.',
        members: {
            onClicked: 'Runs when the user clicks the extension button.',
            setBadgeText: 'Sets short text displayed on the extension button.',
            setIcon: 'Changes the extension button icon.',
            setPopup: 'Sets the popup opened from the extension button.',
        },
    },
    alarms: {
        title: 'Alarms',
        summary: 'Schedules extension work to run later or at repeated intervals.',
        members: {
            create: 'Schedules a one-time or repeating alarm.',
            clear: 'Cancels a scheduled alarm.',
            onAlarm: 'Runs when a scheduled alarm fires.',
        },
    },
    bookmarks: {
        title: 'Bookmarks',
        summary: 'Reads, creates, edits, removes, and organizes browser bookmarks.',
        members: {
            search: 'Finds bookmarks by title or URL.',
            create: 'Creates a bookmark or folder.',
            remove: 'Removes a bookmark or folder.',
            getTree: 'Reads the bookmark tree.',
        },
    },
    browserAction: {
        title: 'Browser action (legacy)',
        summary: 'Controls the legacy Manifest V2 toolbar button.',
        members: {
            onClicked: 'Runs when the user clicks the extension button.',
            setBadgeText: 'Sets short text displayed on the extension button.',
            setIcon: 'Changes the extension button icon.',
            setPopup: 'Sets the popup opened from the extension button.',
        },
    },
    browserSettings: {
        title: 'Browser settings',
        summary: 'Reads or changes supported browser-wide settings.',
    },
    browsingData: {
        title: 'Browsing data',
        summary: 'Removes selected browsing data, such as cache, cookies, or history.',
        members: { remove: 'Removes selected categories of browsing data.' },
    },
    clipboard: {
        title: 'Clipboard',
        summary: 'Copies supported image data to the system clipboard.',
    },
    commands: {
        title: 'Commands',
        summary: 'Handles keyboard shortcuts declared by the extension.',
        members: { onCommand: 'Runs when the user invokes an extension command.' },
    },
    contentScripts: {
        title: 'Content scripts',
        summary: 'Registers scripts and styles to run on pages matching chosen URL patterns.',
        members: { register: 'Registers content scripts at runtime.' },
    },
    contextualIdentities: {
        title: 'Container tabs',
        summary: 'Lists and manages Firefox contextual identities, also known as containers.',
    },
    cookies: {
        title: 'Cookies',
        summary: 'Reads, creates, updates, and removes cookies for permitted sites.',
        members: {
            get: 'Reads a cookie matching a URL and name.',
            getAll: 'Lists cookies matching supplied criteria.',
            set: 'Creates or updates a cookie.',
            remove: 'Removes a cookie.',
            onChanged: 'Runs when a cookie is added, removed, or changed.',
        },
    },
    declarativeNetRequest: {
        title: 'Declarative network requests',
        summary: 'Applies declared rules to network requests without handling each request in extension code.',
        members: {
            updateDynamicRules: 'Adds or removes persistent request rules.',
            updateSessionRules: 'Adds or removes temporary request rules.',
        },
    },
    devtools: {
        title: 'Developer tools',
        summary: 'Adds extension pages and integrations to the browser developer tools.',
    },
    downloads: {
        title: 'Downloads',
        summary: 'Starts, searches, pauses, resumes, and manages browser downloads.',
        members: {
            download: 'Starts a browser-managed download.',
            search: 'Finds downloads matching supplied criteria.',
            pause: 'Pauses an active download.',
            cancel: 'Cancels a download.',
        },
    },
    extension: {
        title: 'Extension utilities (legacy)',
        summary: 'Provides older utilities for extension pages and resources.',
    },
    find: {
        title: 'Find in page',
        summary: 'Finds text in a page and can highlight matching text.',
        members: { find: 'Searches a page for text.' },
    },
    history: {
        title: 'History',
        summary: 'Searches, adds, and removes entries in browser history.',
        members: {
            search: 'Searches history entries by text and time.',
            deleteUrl: 'Removes history entries for a URL.',
            deleteAll: 'Clears browser history.',
        },
    },
    i18n: {
        title: 'Internationalization',
        summary: 'Reads localized messages and information about the browser language.',
        members: { getMessage: 'Looks up a localized message from the extension locale files.' },
    },
    identity: {
        title: 'Identity and OAuth',
        summary: 'Obtains authorization tokens for services that support OAuth.',
        members: { launchWebAuthFlow: 'Opens an authentication flow and returns its response URL.' },
    },
    idle: {
        title: 'Idle detection',
        summary: 'Checks whether the user’s system is active, idle, or locked.',
        members: { queryState: 'Reads the current idle state.' },
    },
    management: {
        title: 'Extension management',
        summary: 'Gets information about installed extensions and manages supported add-on actions.',
        members: { getAll: 'Lists installed extensions and apps.' },
    },
    menus: {
        title: 'Context menus',
        summary: 'Adds items to browser menus, including the right-click context menu.',
        members: {
            create: 'Adds a menu item.',
            remove: 'Removes a menu item.',
            onClicked: 'Runs when the user selects an extension menu item.',
        },
    },
    contextMenus: {
        title: 'Context menus',
        summary: 'Adds items to browser menus, including the right-click context menu.',
        members: {
            create: 'Adds a menu item.',
            remove: 'Removes a menu item.',
            onClicked: 'Runs when the user selects an extension menu item.',
        },
    },
    notifications: {
        title: 'Notifications',
        summary: 'Displays notifications using the operating system’s notification system.',
        members: {
            create: 'Displays a notification.',
            clear: 'Closes a notification.',
            onClicked: 'Runs when the user clicks a notification.',
        },
    },
    omnibox: {
        title: 'Address bar keywords',
        summary: 'Implements extension features activated by a keyword in the address bar.',
    },
    pageAction: {
        title: 'Page action (legacy)',
        summary: 'Controls the legacy Manifest V2 button associated with a particular page.',
    },
    permissions: {
        title: 'Runtime permissions',
        summary: 'Checks, requests, and observes optional permissions while the extension is running.',
        members: {
            contains: 'Checks whether requested permissions are currently granted.',
            request: 'Asks the user to grant optional permissions.',
            getAll: 'Lists permissions currently granted to the extension.',
            remove: 'Gives up permissions the extension no longer needs.',
        },
    },
    privacy: {
        title: 'Privacy settings',
        summary: 'Reads and changes supported browser privacy settings.',
    },
    proxy: {
        title: 'Proxy',
        summary: 'Configures proxy behavior and can respond to proxy requests.',
    },
    runtime: {
        title: 'Extension runtime',
        summary: 'Provides extension identity and lifecycle information, messaging, and native app connections.',
        members: {
            sendMessage: 'Sends a one-off message to this extension or another extension.',
            connect: 'Opens a longer-lived message connection to another extension context.',
            connectNative: 'Opens a message connection to a native application.',
            sendNativeMessage: 'Sends a one-off message to a native application.',
            getURL: 'Builds a URL for a file packaged with the extension.',
            getManifest: 'Returns the parsed extension manifest.',
            onMessage: 'Receives messages from another extension context.',
        },
    },
    scripting: {
        title: 'Script injection',
        summary: 'Injects JavaScript or CSS into pages when the extension has the required access.',
        members: {
            executeScript: 'Runs JavaScript in selected frames or tabs.',
            insertCSS: 'Adds CSS to selected frames or tabs.',
            removeCSS: 'Removes CSS previously inserted by the extension.',
        },
    },
    search: {
        title: 'Search engines',
        summary: 'Lists browser search engines and runs a search with a selected engine.',
    },
    sessions: {
        title: 'Recently closed tabs',
        summary: 'Lists and restores recently closed tabs and windows.',
        members: {
            getRecentlyClosed: 'Lists recently closed tabs and windows.',
            restore: 'Restores a recently closed tab or window.',
        },
    },
    sidebarAction: {
        title: 'Sidebar',
        summary: 'Configures and opens the extension’s browser sidebar.',
    },
    storage: {
        title: 'Extension storage',
        summary: 'Stores extension data locally, in memory, synced, or managed by an administrator.',
        members: {
            'local.get': 'Reads values from storage on this device.',
            'local.set': 'Writes values to storage on this device.',
            'local.remove': 'Removes values from storage on this device.',
            'sync.get': 'Reads values from browser-synced extension storage.',
            'sync.set': 'Writes values to browser-synced extension storage.',
            'session.get': 'Reads temporary storage kept in memory for the browser session.',
            'session.set': 'Writes temporary storage kept in memory for the browser session.',
            onChanged: 'Runs when values in an extension storage area change.',
        },
    },
    tabGroups: {
        title: 'Tab groups',
        summary: 'Creates, reads, updates, and manages tab groups.',
    },
    tabs: {
        title: 'Tabs',
        summary: 'Finds and manages tabs: create, update, move, reload, or close them.',
        members: {
            query: 'Finds tabs matching properties such as active state or current window.',
            create: 'Opens a new tab.',
            update: 'Navigates a tab or changes its properties.',
            remove: 'Closes one or more tabs.',
            move: 'Moves tabs within or between windows.',
            reload: 'Reloads a tab.',
            sendMessage: 'Sends a message to content scripts in a tab.',
            executeScript: 'Injects JavaScript into a tab in Manifest V2.',
            insertCSS: 'Injects CSS into a tab in Manifest V2.',
        },
    },
    theme: {
        title: 'Browser theme',
        summary: 'Reads browser theme information and applies supported theme updates.',
    },
    topSites: {
        title: 'Frequently visited sites',
        summary: 'Lists pages the user visits frequently.',
    },
    userScripts: {
        title: 'User scripts',
        summary: 'Registers user scripts that run on pages matching configured URL patterns.',
    },
    webNavigation: {
        title: 'Navigation events',
        summary: 'Observes stages of page and frame navigation.',
        members: { onCommitted: 'Runs when a navigation is committed.' },
    },
    webRequest: {
        title: 'Network request events',
        summary: 'Observes network requests and, where supported and permitted, modifies or cancels them.',
        members: {
            onBeforeRequest: 'Runs before a network request is sent.',
            onHeadersReceived: 'Runs when response headers arrive.',
            onCompleted: 'Runs when a request completes.',
        },
    },
    windows: {
        title: 'Windows',
        summary: 'Lists, creates, updates, and closes browser windows.',
        members: {
            getAll: 'Lists browser windows.',
            create: 'Opens a new browser window.',
            update: 'Changes a browser window’s state or properties.',
            remove: 'Closes a browser window.',
        },
    },
};
