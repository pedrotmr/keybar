# Chrome Web Store launch kit

**Product name:** Keybar

**Kit updated:** November 3, 2026

**Live listing check:** November 2, 2026

## Product name and icon

Use **Keybar** as the Store title. The packaged icon assets are `public/icons/keybar-16.png`, `public/icons/keybar-48.png`, and `public/icons/keybar-128.png`; the high-resolution artwork and editable source are `assets/branding/Keybar.png` and `assets/branding/Keybar.icon/`.

The repository's [name check](name-check.md) records a pending exact U.S. KEYBAR application in class 9 as of November 2, 2026 and says that screen is not trademark clearance. Recheck the [official TSDR record](https://tsdr.uspto.gov/#caseNumber=99289761&caseSearchType=US_APPLICATION&caseType=DEFAULT&searchType=statusSearch) before filing or launch.

## Closest live listings

The Store's user counts, ratings, and update dates below were read from each live listing on November 2, 2026. Ratings can change daily, as the Store notes on the pages.

| Listing                                                                                                                                              |  Users |               Rating | Last updated   | Short description                                          | Screenshots and privacy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | -----: | -------------------: | -------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Omni — Bookmark, History, & Tab Manager](https://chromewebstore.google.com/detail/omni-bookmark-history-tab/mapjgeachilmcbbokkgcbgpbakaaeehi?hl=en) | 10,000 | 4.4 / 5 (67 ratings) | March 22, 2022 | “Supercharge Chrome with commands, shortcuts, and more”    | One static screenshot: a dark, angled collage of the command interface, tab/history results, and actions; the listing also has a demo video. [Store screenshot](https://lh3.googleusercontent.com/P4tnISAD7L4I1ePDn5_CGr5mQTsVWWOKa35hZSwTW4z5fOOkWMBPR8z7xltoHkwfNqKT8E3CRYpzCThio30Pq2-E). Privacy says the developer will not collect or use data and shows the three standard data-use declarations.                                                                                                       |
| [Command Palette](https://chromewebstore.google.com/detail/command-palette/lfmfhlofoaleegdogpmknfbibciflfek?hl=en)                                   |    307 | 3.7 / 5 (10 ratings) | August 9, 2022 | “A command palette to navigate in Google Chrome faster.”   | Two screenshots: a default list of browser commands, and a `laravel` query with matching page results. [Screenshot 1](https://lh3.googleusercontent.com/GTG2n9Fla5mnor_gjcIJI5PxIFdHWnrL9mOh7WYrW9clRstj9psAXt9I64bGDbTwr33_ADbrOtMKh-0iKp2Trp0eYO4) · [Screenshot 2](https://lh3.googleusercontent.com/HYysUt6a8LswngzK8RXvBWEtAvXVgUzeX6sKfq9gJ5KlYJp9wkCPVQ_kRynyMO2xQX_SH1pQsyeotLHQlgEL6PY4). Privacy says the developer will not collect or use data and shows the three standard data-use declarations. |
| [Chrome Command Bar](https://chromewebstore.google.com/detail/chrome-command-bar/coeabcfopmadgjffgjgpfldnmhgjkmml?hl=en)                             |     64 |   5.0 / 5 (1 rating) | August 5, 2024 | “Navigate your browser like a pro with just a few clicks.” | One screenshot: a centered command list on a gray background, including browser actions and shortcuts. [Store screenshot](https://lh3.googleusercontent.com/Bl_mln8LRhG_zQxLn28cmFO6xgcvabhvzNF1tjzwrQ2NINQH4nRm8E__tL6axaOOTdl-E8tECFVS-CZdEAIKFVKcES0). Privacy says the developer will not collect or use data and shows the three standard data-use declarations.                                                                                                                                          |

All three listings currently disclose no collection or use of user data. These are the respective developers' disclosures, not an independent audit of those extensions. Keybar should disclose its own local handling accurately: Chrome's guidance says locally processed or stored user data still counts as handling that should be disclosed. [Omni](https://chromewebstore.google.com/detail/omni-bookmark-history-tab/mapjgeachilmcbbokkgcbgpbakaaeehi?hl=en) · [Command Palette](https://chromewebstore.google.com/detail/command-palette/lfmfhlofoaleegdogpmknfbibciflfek?hl=en) · [Chrome Command Bar](https://chromewebstore.google.com/detail/chrome-command-bar/coeabcfopmadgjffgjgpfldnmhgjkmml?hl=en) · [Chrome Web Store user-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

## Store listing copy

### Short description

> Keybar is a keyboard-first command palette for Google Chrome™ to find tabs, search pages, and run browser actions.

**Length:** 114 characters (132-character maximum; [Chrome Web Store listing guidance](https://developer.chrome.com/docs/webstore/best-listing)).

### Detailed description

Keybar brings tab search and browser commands together in one keyboard-first Command Bar.

Open the Command Bar from the Keybar extension button or an assigned keyboard shortcut on a regular web page. On Chrome and extension pages, the button and Command Bar shortcut open the popup; the Tab Switcher shortcut does nothing on those pages. The manifest suggests `Ctrl+T` / `Command+T`, which Chrome also uses to open a new tab; Chrome shortcuts take priority over extension commands, so that suggestion may remain unassigned. Choose another shortcut at `chrome://extensions/shortcuts` if needed. The Tab Switcher opens on regular web pages with its separate `Control+A` shortcut. [Commands API](https://developer.chrome.com/docs/extensions/reference/api/commands) · [Chrome keyboard shortcuts](https://support.google.com/chrome/answer/157179?hl=en)

Type to find open tabs, enter a web address, or search browser commands. Rename, pin, mute, move, group, duplicate, or close tabs; copy a page title or URL; navigate, adjust zoom, manage windows, or use Chrome's native Split View when that API is available.

Search prefixes such as `yt`, `g`, `ai`, `cl`, `p`, `x`, and `y` open the matching provider's search page with your query in its URL. These are user-selected URL handoffs, not API-backed search or embedded results. An unmatched query offers a Google web search. Local tab and command results do not wait for those network handoffs.

The separate Tab Switcher shows the five most recently accessed tabs in the current window. Use the Command Bar to search tabs, rename them, and find additional tab actions.

Choose **Search bookmarks and history** to request any missing optional permissions for both sources together. If either permission was granted earlier, Keybar loads that source locally when the Command Bar opens. History search returns up to 500 history entries from the last 30 days.

Set a light, dark, or system theme, choose a palette and font, and adjust the Command Bar width or window mode. Custom tab names are stored locally. Renaming a tab on a regular page also updates Chrome’s tab strip by setting the page title (which the page can read) and does not change favicons.

Keybar requests HTTP(S) host access so renamed titles can appear in the tab strip. It has no analytics or background network requests. A tab preview is captured only after you explicitly open the Command Bar or Tab Switcher on a regular web page, stays in session storage, and is never uploaded. The cache is cleared when Chrome reports a changed URL or the tab closes; a same-URL reload does not itself trigger that cleanup.

Google Chrome is a trademark of Google LLC. Use of this trademark is subject to Google Permissions.

## Screenshot captions

Use real captures from the release build with non-sensitive sample tabs and queries. Use `public/icons/keybar-128.png` for the Store icon, and avoid showing a stale product label. The first image should establish the primary Command Bar experience.

1. **Find a tab or command from one keyboard-first bar.** Show the Command Bar with a typed query and a mix of matching tab and command results. On Chrome or extension pages, the button and Command Bar shortcut open the popup; the Tab Switcher shortcut is unavailable there.
2. **Run browser actions without hunting through menus.** Show searchable commands such as pin, mute, rename, move, or duplicate on a selected tab.
3. **Search the web with a provider shortcut.** Show a prefix and query, with the result clearly handed off to that provider's website.
4. **Switch between your five most recently accessed tabs.** Show the separate Tab Switcher with the current window's recent tabs.
5. **Find a saved page when you need it.** Show bookmark and history results after the user chooses the saved-pages command; show the permission prompt only if either permission is missing.

## Privacy practices tab answers

Chrome asks for a narrow single-purpose statement, a justification for every manifest permission, a remote-code answer, data-use disclosures, and the limited-use certification. Permissions must be no broader than the features require; disclosures must match the policy and actual behavior. [Privacy practices guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy) · [Use of permissions](https://developer.chrome.com/docs/webstore/program-policies/permissions) · [Program policies](https://developer.chrome.com/docs/webstore/program-policies)

### Single purpose

> A keyboard-first command palette for Google Chrome™ to find open tabs and run browser actions.

### Permission justifications

The manifest declares four required API permissions, HTTP(S) host access, and five optional permissions. Keep the justifications below aligned with the permission name shown by the dashboard.

| Permission                  | Suggested justification                                                                                                                                                                                                                      |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activeTab`                 | Temporarily access the current regular web page after the user opens Keybar, so it can mount the overlay and capture a preview of the visible tab. Access is limited to the user-invoked tab.                                                |
| `scripting`                 | Inject the extension's locally packaged overlay scripts into the current tab after the user opens Keybar or the Tab Switcher, and set or restore `document.title` when the user renames a tab.                                               |
| `tabs`                      | Read tab IDs, titles, URLs, favicons, and window state so users can search and switch tabs and run tab actions such as rename, pin, mute, move, group, duplicate, or close.                                                                  |
| `storage`                   | Save appearance preferences and custom tab names in local storage, and keep temporary overlay state and tab-preview data in session storage.                                                                                                 |
| Host access                 | Read and change page titles on HTTP(S) sites so a custom tab name can appear in Chrome’s tab strip and be reapplied after reload or session restore.                                                                                         |
| `bookmarks` (optional)      | Read and search bookmarks locally. If missing, request this permission together with `history` when the user chooses saved-page search; if already granted, bookmark data is loaded when the Command Bar opens.                              |
| `history` (optional)        | Search up to 500 Chrome history entries from the last 30 days. If missing, request this permission together with `bookmarks` when the user chooses saved-page search; if already granted, history data is loaded when the Command Bar opens. |
| `tabGroups` (optional)      | When the user chooses a tab-group command, read and create or update Chrome tab groups for the selected tabs. Request this permission only for group features.                                                                               |
| `sessions` (optional)       | When the user chooses **Reopen closed tab**, ask Chrome to restore the most recently closed tab. Request this permission only for that command.                                                                                              |
| `clipboardWrite` (optional) | When the user chooses **Copy current URL** or **Copy current tab title**, write that value to the clipboard. Request this permission only for copy commands.                                                                                 |

### Remote code

> **No.** Keybar does not load or execute remotely hosted code. Its scripts, styles, and fonts are packaged with the extension. Provider search is a URL handoff, not remote code execution.

Manifest V3 does not allow remotely hosted executable code; the dashboard asks developers to select “No” when the extension does not execute remote code. [Privacy practices guidance](https://developer.chrome.com/docs/webstore/cws-dashboard-privacy)

### Data usage

Disclose the following types because Keybar accesses or processes them locally for user-facing features. Chrome's policy counts local processing and storage as data handling, and identifies browsing activity and captured page content as user data. [User-data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) · [Limited Use](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

| Dashboard data type                 | Select? | What Keybar handles and why                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web history                         | Yes     | Open-tab titles and URLs support tab search and actions. Custom tab names with their URLs and original page titles are stored locally for labels and unique-match recovery after session restore. Optional `history` access searches matching visit titles and URLs (up to 500 entries from the last 30 days). Processing stays in-browser for the command-palette purpose. |
| User activity                       | Yes     | The palette processes the user's typed query and command selection in memory to filter results and run the selected command. It does not record an activity log or send interaction analytics.                                                                                                                                                                              |
| Website content                     | Yes     | After the user opens an overlay on a regular web page, Chrome may capture the currently visible tab for a preview. The preview is kept in session storage, cleared when Chrome reports a changed URL or the tab closes, and never transmitted. A same-URL reload does not itself trigger the URL-change cleanup.                                                            |
| Personally identifiable information | No      | The extension does not ask for or collect identity details.                                                                                                                                                                                                                                                                                                                 |
| Health information                  | No      | Not accessed or used.                                                                                                                                                                                                                                                                                                                                                       |
| Financial and payment information   | No      | Not accessed or used.                                                                                                                                                                                                                                                                                                                                                       |
| Authentication information          | No      | Not accessed or used.                                                                                                                                                                                                                                                                                                                                                       |
| Personal communications             | No      | Not accessed or used.                                                                                                                                                                                                                                                                                                                                                       |
| Location                            | No      | Not accessed or used.                                                                                                                                                                                                                                                                                                                                                       |

The extension does not send tab data, bookmark data, history entries, custom names, previews, or usage events to the developer. If the user chooses a provider prefix or accepts the offered Google web search, the query is placed in the destination URL and sent to that provider by the browser. Chrome also loads favicon images from URLs it reports for tabs. These are feature-specific browser requests; the extension makes no background network requests.

### Submission gate

The current UI has no separate disclosure and consent step before it reads open-tab metadata when the Command Bar opens or captures a visible-tab screenshot for previews. Chrome's [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq) says disclosure and consent must occur in the product UI, while the current [troubleshooting guidance](https://developer.chrome.com/docs/webstore/troubleshooting#user-data-policy---prominent-disclosure) says prominent disclosure in the Store listing is sufficient for disclosure and still requires user consent before collection. The 2026 [policy update](https://developer.chrome.com/blog/cws-policy-updates-2026) also says collected data must be strictly necessary to the disclosed single purpose. Because the official guidance differs on where disclosure must appear, verify the appropriate consent path before submission; this draft does not establish that the current interaction meets the requirement.

### Data-use certifications

Select **Yes** for each dashboard certification while the shipped behavior remains as described above:

- **Check:** “I do not sell or transfer user data to third parties, outside of the approved use cases.”
- **Check:** “I do not use or transfer user data for purposes that are unrelated to my item's single purpose.”
- **Check:** “I do not use or transfer user data to determine creditworthiness or for lending purposes.”

Chrome's Limited Use policy restricts data use to the disclosed purpose, restricts transfers, and prohibits personalized advertising use. The policy's separate website statement is included in the privacy policy; it is not one of the three dashboard certifications. [Limited Use policy](https://developer.chrome.com/docs/webstore/program-policies/limited-use)

### Positioning decision

Position Keybar as a **command palette**. Product's purpose names the Command Bar as the primary surface and the Tab Switcher as a separate, supporting view. The command-palette position can accurately cover tab search, browser actions, provider handoffs, optional saved-page search, and the distinct recent-tab switcher without implying that the extension is only for organizing tabs.

For this position, use the single-purpose text above and make screenshot 1 show the Command Bar with a query plus matching tabs and commands.

If you instead position it as a **tab manager**, change the single-purpose text to:

> Keybar is a keyboard-first tab manager for Google Chrome™ to find, rename, organize, and switch tabs.

Then make screenshot 1 show the tab-focused experience: a search for open tabs with a clear rename or organize action, or the Tab Switcher if recent-tab switching is the core promise. Keep the first image focused on tabs and avoid leading with provider search or general browser commands.

The Command Palette position is recommended because it matches `PRODUCT.md` and the README's stated primary surface. The Store's branding rules require “for,” “for use with,” or “compatible with” plus ™ when describing compatibility with Google products, and proper attribution when using a Google trademark in the listing. [Branding guidelines](https://developer.chrome.com/docs/webstore/branding)

## Release artifact

PR [#12](https://github.com/pedrotmr/keybar/pull/12) is merged and added the release-check path used by `npm run package:extension`. The repository describes that command as running the release checks before creating `release/keybar-<version>.zip`; this launch kit does not publish the artifact or submit the Store listing.
