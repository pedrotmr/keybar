# Command Bar relevance evaluation

- **Date:** 18 November 2026 (evaluation); 23 November 2026 (decision)
- **Issue:** [#22](https://github.com/pedrotmr/keybar/issues/22); cold-start performance follow-up [#55](https://github.com/pedrotmr/keybar/issues/55) also covers concluded baselines from #23
- **Status:** decidido — evaluation and performance baselines concluded; cold-start performance follow-up is #55.

**Run date:** 18 November 2026 · **Fixture:** `keybar-command-bar-synthetic-v1` · **Method:** local deterministic evaluation of the existing `searchItems` interface.

## Scope and assumptions

The fixture contains 27 synthetic tasks over the Command Bar's current command registry, five synthetic open tabs (including a renamed tab and a tab in another window), three synthetic bookmarks, two synthetic history entries, explicit provider handoffs, a direct URL, and an unmatched web-search fallback. It contains no real user browsing data or queries. Its fixed URLs include reserved `example.test` addresses and public MDN and TypeScript documentation URLs used as synthetic inputs.

Expected results are chosen from each task's intended destination. For the `weekend porto` case, `toTabItems` uses the custom name `Weekend in Porto` as the result title and keeps the original `Hotel booking overview` title and URL in its subtitle. Bookmark and history fixtures carry their URL in both `subtitle` and `url`; the ranker searches those fields in addition to the title. The set is deliberately a diagnostic seed, not a representative sample of real user behavior: inputs and expected results were authored from the code and issue brief, not collected from users. The run checks whether the expected item appears first and within the first five results; it does not measure task completion time or user preference. Bookmark and history entries are included directly because their live sources require optional Chrome permissions.

This reports settled search: the saved-page fixtures are already loaded when `searchItems` runs. The live palette does not show its fallback while saved pages are still loading, so the reported Google fallback rank applies after loading completes.

The fixture does not include duplicate tabs, bookmarks, or history entries with the same title or URL. Each item ID is distinct, so tie-breaking between duplicate results remains untested.

Run it with:

```sh
npm run evaluate:relevance
```

## Results

| Query | Intended result | Type | Rank | Top 1 | Top 5 |
| --- | --- | --- | ---: | :---: | :---: |
| `new tab` | `new-tab` | Command | 1 | Yes | Yes |
| `new window` | `new-window` | Command | 1 | Yes | Yes |
| `incognito window` | `new-incognito-window` | Command | 1 | Yes | Yes |
| `reload current` | `reload-tab` | Command | 1 | Yes | Yes |
| `close current tab` | `close-tab` | Command | 1 | Yes | Yes |
| `reopen closed` | `reopen-closed-tab` | Command | 1 | Yes | Yes |
| `open history` | `open-history` | Command | 1 | Yes | Yes |
| `open bookmarks` | `open-bookmarks` | Command | 1 | Yes | Yes |
| `downloads` | `open-downloads` | Command | 1 | Yes | Yes |
| `keyboard shortcuts` | `open-shortcuts` | Command | 1 | Yes | Yes |
| `preferences` | `open-chrome-settings` | Command | 1 | Yes | Yes |
| `clear cache` | `hard-reload-tab` (bypass-cache reload) | Command | 1 | Yes | Yes |
| `quarterly roadmap` | `tab-201` | Tab | 1 | Yes | Yes |
| `invoice pdf` | `tab-202` | Tab | 1 | Yes | Yes |
| `rust async` | `tab-203` | Tab | 1 | Yes | Yes |
| `weekend porto` | `tab-204` | Tab | 1 | Yes | Yes |
| `mercury on-call` | `tab-205` | Tab | 1 | Yes | Yes |
| `typescript docs` | `bookmark-typescript` | Bookmark | 1 | Yes | Yes |
| `css grid` | `bookmark-css-grid` | Bookmark | 1 | Yes | Yes |
| `vite config` | `bookmark-vite` | Bookmark | 1 | Yes | Yes |
| `tax return` | `history-tax-return` | History | 1 | Yes | Yes |
| `gardening ideas` | `history-gardening` | History | 1 | Yes | Yes |
| `yt lo-fi music` | `search-youtube` | Provider search | 1 | Yes | Yes |
| `youtube cats` | `search-youtube` | Provider search | Not found | No | No |
| `ai focus time` | `search-chatgpt` | Provider search | 1 | Yes | Yes |
| `https://developer.mozilla.org/en-US/docs/Web/CSS/grid` | `navigate-url` | Direct navigation | 1 | Yes | Yes |
| `quantum computing basics` | `search-google` | Fallback search | 1 | Yes | Yes |

The expected item ranked first in **26/27** tasks and appeared in the first five in **26/27**. Commands were 12/12 top-one, tabs 5/5, bookmarks 3/3, history 2/2, direct navigation 1/1, and search actions 3/4. This fixture returns at most three matches per query, so top-five success means the expected result appeared somewhere in the returned set; it does not test ordering among five or more candidates. Excluding the provider-trigger case below, all 23 local command/tab/bookmark/history/navigation tasks placed the expected result first.

## Findings and follow-ups

- **Known provider-dispatch miss:** `youtube cats` produces the generic Google fallback because this evaluator's current provider handoff recognizes the exact prefix (`yt`), not the full provider name. This is dispatch behavior, not a ranking defect. Recognizing a full provider name before a query is a candidate follow-up in [issue #30](https://github.com/pedrotmr/keybar/issues/30), but it can turn ordinary text such as `youtube cats` into a handoff. The product should require clear commitment or explicit provider selection; implementation belongs in #30, not this evaluation.
- **No additional ranking defect surfaced in this seed.** The synthetic local cases all ranked their intended result first. This is evidence about these authored scenarios only, not a claim that real-user relevance is solved.
- **Next useful evidence:** expand the fixture with real, consented or explicitly synthetic query examples that contain overlapping titles, URL-only matches, typos, and ambiguous commands. Keep each expected result tied to a clearly stated task so ambiguous cases are not scored as objective failures.

## Reproduction

The script calls the same `searchItems` interface used by the Command Bar, constructs fixtures through the repository's `getCommands` and `toTabItems` helpers, and reports the expected item's rank and leading result IDs for each task. The exact generated dataset and calculations are in [`scripts/evaluate-command-bar-ranking.mjs`](../../scripts/evaluate-command-bar-ranking.mjs).
