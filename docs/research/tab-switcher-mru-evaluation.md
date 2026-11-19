# Tab Switcher MRU evaluation · Issue #24

Beta a compact, title-first list of up to ten tabs in the current window, including the active tab. Keep the previous tab preselected so a quick shortcut press and release still toggles between the two most recent tabs in that window. Keep five as the comparison baseline. Use Command Bar tab search for other windows while the beta establishes how often people need the shortcut to cross a window boundary.

## Current behavior

The switcher resolves the active tab in the last-focused normal window, filters candidates to that window, puts the active tab first, sorts the rest by descending `lastAccessed`, and takes five. With enough tabs, that is one active tab and four destinations. The shared tab inventory already queries all tabs and attaches custom names and window titles. The activation handler already focuses the destination window and activates its tab. A cross-window switcher would still need its own eligibility, ordering, and labeling rules. [Active window](../../src/background/index.ts#L1088-L1097) · [MRU selection](../../src/background/index.ts#L448-L460) · [Inventory](../../src/background/index.ts#L1119-L1155) · [Activation](../../src/background/index.ts#L1157-L1171)

On opening, the model selects the first entry whose ID differs from the current tab. Repeat shortcut presses can advance the selection, including presses queued during opening. Arrow keys move one position and wrap. Home and End go to the first and last entries, and Enter or Space commits. Modifier release commits when that mode is enabled, including release before the result arrives. [Keyboard and activation](../../src/components/TabSwitcher/useTabSwitcherModel.ts#L85-L174) · [Initial selection](../../src/components/TabSwitcher/useTabSwitcherModel.ts#L254-L268)

## Repeatable two-window scenario

Use eight tabs in normal window A and four in normal window B. Keep both windows side by side and fully visible so switching focus does not occlude either window. With distinct access timestamps, activate each tab in this order, oldest first. Finish in A. Before each scored run, verify that the descending `lastAccessed` order after A8 is `B4 → A7 → B3 → A6 → A5 → A4 → A3 → B2 → A2 → B1 → A1`; if Chrome's visibility or focus handling changed it, rebuild the history and recount from the observed order.

`A1 → B1 → A2 → B2 → A3 → A4 → A5 → A6 → B3 → A7 → B4 → A8`

A8 is current and B4 is active in B. Recreate this history before each target because switching changes recency. Count forward selection steps after opening and before committing. Zero means the target is preselected. Add one open and one commit to get total actions, with a quick shortcut press and release supplying both when release-to-switch is enabled. The count models keyboard navigation and excludes scan time, reverse wrap, and pointer movement. Use a row-major grid with the same linear navigation for the presentation comparison.

| Option | Visible order, including current | A7, previous in A | B4, previous across windows | A3, sixth in A | A1, eighth in A | B3, fourth globally | A2, tenth globally |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Current five, window A | A8, A7, A6, A5, A4 | 0 | Outside list | Outside list | Outside list | Outside list | Outside list |
| Ten-item limit, window A | A8, A7, A6, A5, A4, A3, A2, A1 | 0 | Outside list | 4 | 6 | Outside list | 5 |
| Five, both windows | A8, B4, A7, B3, A6 | 1 | 0 | Outside list | Outside list | 2 | Outside list |
| Ten-item limit, both windows | A8, B4, A7, B3, A6, A5, A4, A3, B2, A2 | 1 | 0 | 6 | Outside list | 2 | 8 |
| Ten-item limit, window A, thumbnail grid | A8, A7, A6, A5, A4, A3, A2, A1 | 0 | Outside list | 4 | 6 | Outside list | 5 |

For either global variant, A1 is twelfth in the recency order and stays outside its cap. In the ten-item global list, A2 is tenth and takes eight forward steps from the B4 preselection. In the eight-entry local-window list, End reaches A1 in one selection step. Reverse wrap can also beat the forward count for tail targets. A ten-item local cap in a full window puts a maximum of eight forward steps between the preselection and the last entry.

Five local entries keep the selection cycle short but leave A3 and A1 to search. Ten local entries reach both while preserving the A8/A7 toggle. Five global entries make A8/B4 the toggle and displace A5 and A4 with tabs from B. When windows represent separate tasks, a quick release can move the user into the wrong context. A grid with the same candidates changes visual recognition and pointer targets. It gives the same keyboard counts under linear navigation.

## Titles, favicons, and previews

Keep the current title priority: custom name, page title, URL, then “Untitled tab.” Show the title and favicon together, with host as a second line or disambiguator for similar titles. A favicon identifies the site quickly, but same-site tabs can share the icon. Current cards place initials beneath the favicon and hide it on load failure. Their accessible labels already include position, title, host, current state, and pinned or audio state when applicable. For any global experiment, add visible and spoken destination-window information. [Card labels and fallback](../../src/components/TabSwitcher/TabCard/TabCard.tsx#L35-L91) · [Favicon errors](../../src/components/TabSwitcher/TabCard/TabFavicon.tsx#L7-L19)

Today’s presentation is already a five-column thumbnail strip. With a cached screenshot, the card loads an asynchronously decoded JPEG. With no preview URL, it shows initials or favicon plus host. The screenshot image itself has no error handler to show that fallback if decoding or loading fails. Preview capture is opportunistic for eligible HTTP(S) pages, uses the visible active tab and its grant, throttles by window, and checks tab and URL before saving. Candidates can render and the shortcut can commit before the asynchronous preview lookup finishes. The lookup accepts at most five IDs, and the shared cache retains at most five screenshots across windows. Keep both limits for a thumbnail-grid experiment and show the existing favicon/host fallback when a preview is missing; a ten-item list cannot assume ten screenshots. Increasing both limits needs separate performance measurements. [Thumbnail markup](../../src/components/TabSwitcher/TabCard/TabCard.tsx#L66-L85) · [Capture and lookup](../../src/background/index.ts#L397-L480) · [Cache cap](../../src/background/index.ts#L28-L39) · [Preview arrival](../../src/components/TabSwitcher/useTabSwitcherModel.ts#L254-L285)

The current grid caps desktop width at 1,440 px and also clamps to the viewport. The standalone surface caps width at 728 px and height at 188 px, subject to available space. Cards use a 16:9 preview and ellipsize titles on one line. Putting ten cards in one row at the same width would roughly halve card width. Two rows preserve card width at the same column count but consume height and need a visible selection when content scrolls, especially in the standalone surface. Compact rows spend more horizontal space on each title and need a vertical scroll limit. A screenshot grid can help distinguish similar titles when the captures differ and are available. If retained as a beta variant, reserve stable card dimensions and use the same host and favicon fallback when a screenshot fails. [Panel and card geometry](../../src/styles/global.css#L1593-L1653) · [Title overflow](../../src/styles/global.css#L1745-L1754) · [Standalone dimensions](../../src/styles/global.css#L1917-L1923)

The inventory already queries and sorts all tabs. Increasing the local cap primarily adds rendered entries and, if enabled for them, preview payload and image decode work. Cross-window selection changes ranking and can add destination focus latency. A compact list with text and favicons avoids screenshot reads and decode work on open if the beta skips preview requests for that presentation. These are code-based expectations. The scenario measures selection steps only, with no runtime timings.

## Competitor review evidence

One QuicKey review praises an instant last-two toggle and another praises the setting that avoids other windows. The Quick Tabs sample includes praise for search, which supports keeping a separate route to a tab outside the MRU list. Tab Manager Plus feedback includes praise for readable icons as well as complaints about missing icons and site names in block view. This supports making titles and fallback cues dependable. The reviews cannot establish preference for ten items or a screenshot grid. [QuicKey](competitor-reviews/quickey.json) · [Quick Tabs](competitor-reviews/quick-tabs.json) · [Tab Manager Plus](competitor-reviews/tab-manager-plus.json)

The repo snapshots were collected on 2 November 2026 from kept English reviews in Recent and Helpful sorts. The samples are selective and small at the product level, particularly Quick Tabs with eight reviews. Comments describe individual experiences with competitor versions at the time. They give no Keybar usage rates, performance measurements, or evidence that a reported problem persists. Theme tags can overlap. [Method and limitations](competitive-analysis.md#data-quality-and-limits)

## Decisions for Pedro

1. **Depth and active slot.** Approve ten total entries for the beta, with the active tab visible first and up to nine destinations, or retain five total. Keep the first inactive entry preselected and preserve quick release. Decide whether five remains a comparison build only or becomes a user setting after the beta.
2. **Window scope.** Keep the existing shortcut local by default. Decide whether a later global mode should have a separate binding or an explicit scope setting. If approved, pin only the invoking tab first, rank other normal-window candidates by recency within the available profile, show the destination window, and let quick release activate the global previous tab.
3. **Presentation.** Approve compact title and favicon rows with host disambiguation and a scrollable height. Decide whether cached thumbnails warrant an optional grid experiment. For that experiment, keep row-major cycling, a stable fallback on preview failure, and a selected card that remains visible while scrolling.
4. **Rollout gate.** Approve beta success criteria before rollout. The deeper list should improve access to ranks six through ten while preserving one-gesture local toggling and meeting agreed latency and wrong-window activation limits.

## Beta follow-ups

- Run the fixture on the baseline and beta with the same history. Check the one-gesture toggle in both directions, ranks six through ten in a full window, and a target closed between opening and commit. Include cold and warm service-worker runs.
- Record open-to-visible-selection, key-to-selection-paint, and release-to-active-tab latency. Compare median and tail timings for overlay and standalone surfaces. For a grid experiment, record preview hit rate, image bytes, and preview arrival time separately from initial paint.
- Check narrow windows, zoom, long and duplicate titles, keyboard wrap, selection visibility during scroll, screen-reader announcements, and missing or failed images. Include several tabs with the same favicon and similar titles so the host, custom name, and preview can each be assessed.
- During beta, compare successful switching to deeper ranks, cancels, and fallback to Command Bar search. Ask about intentional cross-window switching and unexpected focus changes through beta feedback. Use that evidence to decide whether global MRU deserves its own shortcut or setting.
