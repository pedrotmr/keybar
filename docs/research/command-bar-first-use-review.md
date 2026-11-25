# Command Bar first-use review

- **Date:** November 6, 2026
- **Issue:** [#26](https://github.com/pedrotmr/keybar/issues/26); review issue [#21](https://github.com/pedrotmr/keybar/issues/21)
- **Status:** implementado — PR #48.

**Reviewed:** November 6, 2026 · **Scope:** first-use discoverability, local search, provider handoff, and optional saved-page permissions.

## Code-backed findings

- The toolbar action opens the Command Bar overlay on supported web pages; Chrome pages use the extension popup. The Command Bar shortcut is suggested as Ctrl+T / Cmd+T, which Chrome may reserve for opening a new tab. Shortcut setup is available through the **Keyboard shortcuts** command. See `src/manifest.json`, `src/background/index.ts` (`browser:open-shortcuts`), and `src/popup/Popup.tsx`.
- The separate Tab Switcher is activated by the `open-tab-switcher` command, suggested as Control+A. It is a separate surface, not a Command Bar mode. See `src/manifest.json` and `src/overlay/tabs.tsx`.
- Tabs, commands, and saved-page results are filtered in the extension. Saved-page sources with existing grants are loaded locally; choosing the saved-pages result requests only missing `bookmarks` and `history` access. See `src/components/CommandPalette/useCommandPaletteModel.ts` and `src/components/CommandPalette/useSavedPages.ts`.
- Provider prefixes and the unmatched-query fallback create provider search results. Choosing one opens the provider URL containing the query. This is a browser navigation handoff, not an API-backed search. See `src/utils/searchProviders.ts`, `src/utils/fuzzySearch.ts`, and `src/components/CommandPalette/useCommandPaletteModel.ts`.
- Before this change, the README documented these details across separate sections, while the visible search placeholder only said “Search commands or a website.” There was no single first-use walkthrough. The README now provides a four-step walkthrough and separates local search from provider handoff.

## Competitor review evidence

The existing competitive review recommends showing an assigned shortcut and a one-step try-it cue where users first open the extension. Its cited QuicKey review evidence is in `docs/research/competitive-analysis.md` and `docs/research/competitor-reviews/quickey.json`. The collected reviews support treating keyboard setup and low learning effort as discoverability topics; they do not establish how Keybar's own users behave.

## Assumptions and follow-ups

- The first-use guide in the README is an adequate immediate surface for the walkthrough; a first-run UI or in-product help surface would require a separate product decision.
- Real-user validation should ask whether people distinguish the Command Bar from the Tab Switcher, find shortcut setup, understand the saved-pages permission timing, and expect provider searches to leave Keybar. No user research was run for this review.
- No permissions were added. A first-run UI, shortcut conflict detection, or a different default shortcut are product decisions for follow-up rather than part of this copy change.
