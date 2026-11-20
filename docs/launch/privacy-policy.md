# Keybar Privacy Policy

**Last updated: November 20, 2026**

Keybar is a keyboard-first command palette for Chrome. It reads and processes browser information locally to provide tab search, browser commands, and optional saved-page search. The extension does not send this information to its developer. It has no analytics or background network requests.

## Information used by the extension

- **Open tabs:** With the required `tabs` permission, Keybar reads tab IDs, titles, URLs, favicons, and window state to search, switch, and manage tabs.
- **Optional saved pages:** When the Command Bar opens, Keybar loads locally any bookmark or history source whose optional permission was previously granted. If access is missing, choosing **Search bookmarks and history** asks Chrome for both permissions together, requesting only those still missing. Bookmark entries are read locally. History search returns up to 500 history entries from the last 30 days.
- **Custom names and settings:** Custom tab names, their associated URLs and original page titles, and appearance preferences are stored in `chrome.storage.local` on your device and are not synced by Keybar. Keybar refreshes the saved URL and original page title when a tab navigates, then uses them to reattach a name after session restore on a unique URL/title match (with a unique URL-only fallback when the page title changed). When you rename a tab on a regular web page, Keybar may set the page’s `document.title` so Chrome’s tab strip shows the name, and may set it again when reattaching or reapplying that saved name after navigation, reload, or session restore. Scripts on that page can read the custom title. Keybar does not change favicons. You can clear the custom name to restore the page title. Closed-tab names expire after 90 days.
- **Temporary previews:** After you explicitly open Keybar or the Tab Switcher on a regular web page, Chrome may grant temporary access to the visible tab for a screenshot preview. The cache is limited to five tabs, stays in session storage, is cleared when Chrome reports a changed URL or the tab closes, and is never transmitted. A same-URL reload does not itself trigger the URL-change cleanup.
- **Queries and selections:** Text you type and commands you select are processed locally to find results and run the selected action. They are not recorded as analytics.

## Network requests and sharing

There are no background network requests. If you choose a provider search shortcut, or accept the offered Google web search, the query is added to the destination URL and sent to that provider by your browser. Current destinations are Google Search, YouTube, ChatGPT, Claude, Perplexity, X, and Yahoo; the selected provider's own privacy practices then apply. Chrome may also load favicon images from the URLs it reports for tabs. Keybar does not send tab data, bookmark data, history entries, custom names, previews, or usage events to its developer or other parties.

## Permissions

Required permissions are `activeTab`, `scripting`, `tabs`, `storage`, and HTTP(S) host access (`http://*/*`, `https://*/*`) so Keybar can set a renamed tab’s page title in Chrome’s tab strip. Optional `bookmarks`, `history`, `tabGroups`, `sessions`, and `clipboardWrite` access is requested only when you choose the feature that needs it. You can manage these grants in Chrome’s extension settings.

## Limited Use

The use of information received from Google APIs will adhere to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use), including the Limited Use requirements. Information is used only to provide Keybar's disclosed features. It is not sold, used for unrelated purposes, or used for personalized advertising, creditworthiness, or lending.

## Contact

For privacy questions, contact the maintainer through the [project issue tracker](https://github.com/pedrotmr/keybar/issues). Do not include private browsing information in a public issue.
