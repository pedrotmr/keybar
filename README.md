# Keybar

Keybar is a keyboard-first command surface for Chrome, built with React, TypeScript, and Manifest V3.

## Open it

- On a regular web page, click the Keybar action or use an assigned shortcut to open the compact, centered Command Bar overlay. The manifest suggests **Ctrl+T** (Windows/Linux) / **Cmd+T** (macOS), which Chrome also uses to open a new tab; Chrome shortcuts take priority over extension commands, so that suggestion may remain unassigned. Choose another shortcut at `chrome://extensions/shortcuts`. See [Chrome's commands API](https://developer.chrome.com/docs/extensions/reference/api/commands) and [keyboard shortcuts](https://support.google.com/chrome/answer/157179?hl=en).
- On Chrome and extension pages, the same action opens the extension popup because Chrome does not allow injected overlays on those pages.
- Open the separate Tab Switcher with **Control+A** on regular web pages, including macOS. It has no button in the Command Bar, and its shortcut does nothing on Chrome or extension pages.
- Use **↑ / ↓** and **Enter** in the Command Bar. In the Tab Switcher, use **← / →** or **↑ / ↓** to cycle, then **Enter** to switch. **Escape** closes either surface. Chrome lets users change both shortcuts at `chrome://extensions/shortcuts`.

## First time using Keybar

1. Open Keybar from the toolbar on any page. On a regular page this opens the Command Bar over the page; on a Chrome or extension page it opens the popup. Type `settings` or choose **Appearance and settings** to see the current shortcut for each surface. Use **Manage shortcuts** there, or choose **Keyboard shortcuts** in the Command Bar, to view or change them in Chrome. Chrome controls which shortcuts extensions can use, so browser shortcuts such as **Ctrl+T** / **Cmd+T** may stay with Chrome; choose an available shortcut if Keybar does not open with one.
2. Type a browser task such as **mute tab**, **pin tab**, or **open downloads**, then use **↑ / ↓** and **Enter**. To switch to an open tab, type part of its title or website, use the arrows to select the matching tab result, and press **Enter**. A website-like query may also show an **Open** address result. For the separate recent-tab strip, use its assigned shortcut; the suggested **Control+A** works on regular pages, including macOS. On Chrome or extension pages, the Command Bar shortcut opens the popup; the Tab Switcher shortcut is unavailable.
3. Search commands and open tabs locally on your device. To find the **Search bookmarks and history** choice, type a non-URL query such as `project notes` (not a provider prefix), then choose it. If access is missing, the overlay opens a Keybar permission window: select **Grant access**, approve Chrome's prompt, return to the overlay, and choose the saved-pages result again. In the popup, Chrome asks for access directly after you choose the result. Once granted, sources are loaded locally when the Command Bar opens and matching saved pages can appear in later searches. History search covers up to 500 history entries from the last 30 days.
4. To send a query to a search provider, type a prefix such as **g**, **yt**, **ai**, or **cl**, press **Tab** to choose the provider, then type your query. Use the arrows to select that provider's search result before pressing **Enter**; a URL-like query may show an **Open** address result first. The query is included in the provider's URL and sent by your browser. A plain unmatched query also offers Google web search; choosing it sends the query to Google.

## Command Bar

Search commands, open tabs, direct addresses, and provider shortcuts in one place. Commands include tab renaming, moving, pinning, muting, grouping, copying a title or URL, closing and duplicating tabs, browser navigation, zoom, window actions, and Chrome's native Split View when the API is available.

Search prefixes such as `yt`, `g`, `ai`, `cl`, `p`, `x`, and `y` open the corresponding provider's search page with the query. These are URL-based handoffs, not API-backed search or embedded results. A normal unmatched query offers a Google web search. Local commands and tabs stay available without waiting for network requests.

To search bookmarks and history, choose the saved-pages result. Chrome requests any missing optional access only after that choice; sources already permitted are loaded locally when the Command Bar opens. History search returns up to 500 history entries from the last 30 days.

Appearance settings include **Compact** and **Expanded** window modes. Compact opens to the search bar and reveals results as you type; Expanded shows suggestions immediately, with pinned tabs first, followed by browser commands and recent unpinned tabs.

## Tab Switcher and custom names

The Tab Switcher is a centered, horizontal strip of the five most recently accessed tabs in the current window. It shows favicons and titles, cycles with the keyboard, and supports the modifier-release behavior when opened from its shortcut. Search all tabs, rename one, or run additional tab actions from the Command Bar.

Chrome only exposes a screenshot of the currently visible tab. When you explicitly open the Command Bar or Tab Switcher on a regular web page, the extension starts a non-blocking capture using the temporary `activeTab` grant. Other cards use a favicon-and-host fallback until a preview is available. The cache is limited to five tabs, cleared when Chrome reports a changed URL or a tab closes, and never uploaded. A same-URL reload does not itself trigger the URL-change cleanup.

Custom tab names and their associated URLs and original page titles are stored in `chrome.storage.local`. On regular web pages, renaming a tab also sets the page’s `document.title` so Chrome’s tab strip shows the name (same approach as Tab Renamer). That needs HTTP(S) host access declared in the manifest; the page’s own scripts can read the custom title. Keybar keeps the original title for clear/reset and session reattachment, and does not change favicons. Names reattach after session restore only on a unique URL/title match; ambiguous matches stay unattached. A duplicate tab inherits its name. Closed-tab names expire after 90 days. Names remain local and are not synced.

## Themes and design

Choose **System**, **Light**, or **Dark**, then select a palette. **Plain** is the default black-and-white palette. The picker includes Cursor Dark, Cursor Midnight, VS Code Dark, Tobacco, Dracula, Catppuccin, Aurora, Gruvbox, and Nordic, plus T3 Code and Ocean. Appearance settings offer Open Sans, Outfit, Nunito Sans, Sora, and IBM Plex Mono font families. Preferences persist across the Command Bar, Tab Switcher, and popup. Choose Compact, Standard, or Wide to set the Command Bar width.

To add a palette, add its light/dark source colors and lightweight swatch colors to the theme definitions in `src/themes/index.ts`. Settings discovers palettes from the registry; full contrast-adjusted token maps are memoized on first use, and components do not need palette-specific styles.

Suggested defaults are **Control+A** for the Tab Switcher and **Cmd+T** on Mac / **Ctrl+T** on Windows/Linux for Keybar. Existing installations can retain their previous assignments. Check or change them at `chrome://extensions/shortcuts`; Chrome may leave its new-tab shortcut unavailable to the extension. For optional **Ctrl+Tab**, see [setup steps](docs/ctrl-tab-setup.md). The [Chrome Web Store launch kit](docs/launch/chrome-web-store.md) contains the product copy and launch guidance.

The Command Bar and Tab Switcher use the same tokens and typography, with separate layouts. Web-page overlays render in a closed Shadow DOM inside a browser top-layer popover so site CSS does not style the extension UI. Native Chrome pages use the extension popup.

## Privacy and permissions

- Required permissions are `activeTab`, `scripting`, `tabs`, `storage`, and HTTP(S) host access so renamed titles can appear in Chrome’s tab strip. There are no analytics or background network requests.
- Choosing a provider sends the query in that provider's URL and opens its website. Favicon images use the URLs already reported by Chrome.
- Optional `bookmarks` and `history` access enables saved-page search. Choosing that feature requests any missing bookmarks and history permissions together; sources already permitted are read locally when the Command Bar opens. `tabGroups` enables group commands; `sessions` restores a closed tab; `clipboardWrite` enables copy commands. Each optional permission is requested only when a user chooses the feature.
- A tab preview is captured only after the user explicitly opens the Command Bar or Tab Switcher on a regular web page and Chrome grants temporary access to the visible tab. It stays in session storage, is cleared when Chrome reports a changed URL or the tab closes, and is never transmitted. A same-URL reload does not itself trigger the URL-change cleanup.

## Development

For browser connection checks, build-directory verification, and the reusable CSS/focus fixture, see [Extension validation](docs/extension-validation.md).

For the macOS Chrome/Helium Control+Tab helper, see [Profile shortcut helper](docs/profile-shortcut-helper.md). It previews changes by default; its tests use temporary profiles.

Requires Node.js 20.19+ or 22.12+ and npm.

```bash
npm install
npm run build
npm test
```

`npm test` exercises background message contracts, concurrent mutations, failed storage writes, safe bulk-close confirmations, search ranking, tab-name recovery, provider URLs, navigation parsing, theme completeness, and WCAG AA contrast for built-in light/dark palettes. It also reports p50/p95 local-search timings for synthetic sets of 2,300 and 10,000 tabs. These algorithm timings do not replace profiling the extension in Chrome. Hard performance budgets run separately with `npm run test:benchmark`.

Install the isolated test browser with `npx playwright install chromium`, then run `npm run test:e2e`. Browser tests load the production extension and cover the overlay, keyboard activation, focus restoration, saved-page failure/retry/revocation, stale responses, bulk-close recovery, worker restart, and a complete browser restart with restored tab names. Permission/data failures and response ordering use controlled boundary simulations; real toolbar action and ordinary Chrome APIs run unchanged. No personal browser profile is used.

The browser suite also checks fresh-install shortcut registration, allowing the deliberately reserved Cmd/Ctrl+T suggestion to remain unassigned. A focused macOS CI job checks the registered Control+A shortcut and stored `mac:Ctrl+A` notation; it does not verify activation by a physical keypress.

To prepare a distributable ZIP, run `npm run package:extension`. This requires the `zip` command and runs lint, formatting, type checks, unit/integration tests, the production build, and browser tests before creating `release/keybar-<version>.zip`. Third-party notices and font licenses ship inside the package. The command prints its SHA-256 checksum. CI runs the browser suite after building as well. Publishing to the Chrome Web Store remains a separate account and listing operation.

`npm test` also checks registered commands against the background listener and runs React lifecycle regressions with jsdom: stale replies, duplicate Enter, retry after API failure, permission revocation, IME/dialog keys, and subscription cleanup. jsdom is a development-only dependency; rendering and Chrome integration still require the browser procedure linked above.

To load the built extension, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/`.

## Code map

```text
src/
├── background/index.ts       Chrome APIs, tab names, screenshot cache, messages
├── components/               Command Bar, result list, settings, Tab Switcher
├── overlay/                  Shadow DOM surfaces for regular web pages
├── popup/                    Extension popup for Chrome-native pages
├── themes/index.ts           Shared light/dark palette registry
├── utils/commands.ts         Searchable browser command registry
├── utils/fuzzySearch.ts      Local ranking, provider prefixes, URL parsing
├── styles/global.css         Shared tokens and component styling
└── manifest.json             MV3 permissions and shortcuts
```
