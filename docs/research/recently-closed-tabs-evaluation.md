# Searchable recently closed tabs: product decision

**Updated:** 19 November 2026
**Scope:** Evidence-based recommendation for [issue #28](https://github.com/pedrotmr/keybar/issues/28). This is a decision artifact, not an implementation.

## Recommendation

**Hold the beta.** Chromium 127, Keybar's minimum supported version, defaults to collecting closed tabs until it has at least 100 eligible tabs and eight display items, or runs out of entries. Its eight-item display limit applies only when the search is empty; a typed query searches the collected entries, and selecting one restores that session. This covers the eleventh of twelve eligible closed tabs in the unique-URL scenario below. Chromium's Tab Search also omits an ungrouped closed tab when that URL is already open in an ungrouped tab; a sessions-based Keybar search may still expose that closed session, although Keybar already finds the open URL. That narrow case could add access to the closed-session identity, but the comparison below establishes no speed or reach advantage for its unique-URL case. Keybar's `sessions` API is capped at 25 session entries, so the proposal does not establish a broader recovery range. The competitor sample provides weak demand evidence. Confirm the source-based behavior in supported Chrome and keep the idea deferred unless the unified workflow or the duplicate-URL case is a product priority. ([Chromium URL de-duplication](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/ui/webui/tab_search/tab_search_page_handler.cc#L879-L885))

**Decision for Pedro:** defer implementation. Reconsider only if a supported-Chrome check contradicts the source-based comparison, users need to restore the exact closed session when its URL is still open, or the unified Command Bar workflow is important enough to justify the feature despite Chrome's native route. If approved, use an explicitly invoked list of recently closed individual tabs with a 25-session API cap and no saved session archive.

## The three jobs

| Job | Keybar today | Chrome today | Potential Keybar addition |
| --- | --- | --- | --- |
| Switch to a tab that is still open | Search the live tab list in the Command Bar. The background queries open tabs and the palette converts them to results. ([`background/index.ts`](../../src/background/index.ts#L654), [`useCommandPaletteModel.ts`](../../src/components/CommandPalette/useCommandPaletteModel.ts#L254)) | Tab Search and `Ctrl/Cmd+Shift+A` find and activate open tabs. ([desktop Tab Search](https://support.google.com/chrome/answer/2391819?co=GENIE.Platform%3DDesktop&hl=en)) | No new recovery capability. |
| Undo the latest close | The **Reopen closed tab** command calls `chrome.sessions.restore()` without an ID, so Chrome restores its most recent closed entry. It already requires the optional `sessions` permission. ([`commands.ts`](../../src/utils/commands.ts#L148-L154), [`background/index.ts`](../../src/background/index.ts#L1007-L1008)) | `Ctrl/Cmd+Shift+T` reopens a recently closed tab or window. ([Chrome shortcuts](https://support.google.com/chrome/answer/157179)) | No new recovery capability; keep the one-step command unchanged. |
| Find a less-recently closed tab | Keybar has no closed-session search today. When both optional bookmarks and history permissions are granted, its Command Bar can search visited pages and reopen a matching URL, but that does not restore the selected closed-session entry. ([`useCommandPaletteModel.ts`](../../src/components/CommandPalette/useCommandPaletteModel.ts#L270-L311)) | Chromium 127's default backend continues through recent-session entries until it has at least eight display items and 100 eligible closed tabs, or runs out of entries; a closed group can take the count above 100. A typed query searches the full collected set, while the eight-item display limit applies only to an empty query. Eligible unique entries can be restored by session ID. Tab Search omits an ungrouped closed tab when the same URL is already open in an ungrouped tab. ([feature defaults](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/ui/ui_features.cc#L395-L405), [collection loop](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/ui/webui/tab_search/tab_search_page_handler.cc#L781-L862), [query and display behavior](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/resources/tab_search/tab_search_page.ts#L709-L745), [open-URL de-duplication](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/ui/webui/tab_search/tab_search_page_handler.cc#L879-L885), [session restore](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/ui/webui/tab_search/tab_search_page_handler.cc#L410-L426)) | The main possible addition is finding/restoring the item inside Keybar's Command Bar. The unique-URL example does not show a range or selection-step advantage over Chrome; searching the exact closed session may remain useful when that URL is already open. |

## Evidence and limits

### Chrome API and privacy

Chrome's [`sessions` API](https://developer.chrome.com/docs/extensions/reference/api/sessions) directly supports this job: `getRecentlyClosed()` returns closed tab or window entries in most-recent-first order; `MAX_SESSION_RESULTS` is 25; and `restore(sessionId)` restores a selected entry. `onChanged` signals when that closed list changes. No separate archive or URL lookup is needed.

Keybar already declares `sessions` as an optional permission and requests it for the one-command restore action. Its permission UI currently labels it **Recently closed tabs** and uses generic copy. ([`manifest.json`](../../src/manifest.json#L12), [`PermissionRequest.tsx`](../../src/popup/PermissionRequest.tsx#L5-L10)) Chrome lists a browsing-history warning when `sessions` is used with `tabs` or `history`, but a runtime request may not show that combined warning if the relevant permission is already active. ([Chrome permission warning list](https://developer.chrome.com/docs/extensions/reference/permissions-list), [Chromium permission request logic](https://github.com/chromium/chromium/blob/main/extensions/browser/api/permissions/permissions_api.cc#L327-L446)) Keybar should explain the purpose before first use even when Chrome shows no new permission prompt: it reads the recent tab/window session entries for this search, restores only the selected result, and does not save the list. Request `sessions` only when the user invokes the feature; do not request `history` for it. Chrome recommends optional permissions for features that can request access at use time. ([Chrome permissions guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions))

Use the existing permission, request it only when the person invokes closed-tab search, and keep the returned titles and URLs in memory while the search is open. If permission is absent or denied, live-tab search and the rest of Keybar should continue to work. If a result disappears before selection, refresh the list and report the stale result; do not silently fall back to restoring the newest entry.

The API cap is a real product limit: it is 25 **sessions**, not a promise of 25 individual tabs. A closed window is one session entry and may contain multiple tabs. For the first version, show individual tab entries only; omit whole-window results and make clear that this is not an archive of older tabs. The returned set may contain fewer than 25 tabs after window entries are filtered out.

### Competitor evidence

QuicKey includes closed-tab search, but the local samples do not show repeated direct requests for this feature. One QuicKey review complains that a closed tab found in search opens in a new window; one Quick Tab Switch review praises recognizing closed tabs. Neither asks for a searchable recent-closed list. ([QuicKey sample](competitor-reviews/quickey.json#L21), [Quick Tab Switch sample](competitor-reviews/quick-tab-switch.json#L12)) One Tab Manager Plus review does ask to search tabs in closed windows, but its context is named, saved-window management; it is adjacent evidence, not a request for a short-lived recently closed list. ([Tab Manager Plus sample](competitor-reviews/tab-manager-plus.json#L25))

The full sample covers 602 selected English reviews across 26 extensions, gathered from Recent and Helpful sorts. It is neither representative nor a measure of demand for Keybar. Session-backup and lost-data requests in tab managers describe a different, durable recovery job and should not be used to justify archives, sync, or workspaces. ([sample limits](competitive-analysis.md#L74), [parent issue #20 scope](https://github.com/pedrotmr/keybar/issues/20))

## Synthetic comparison

Assume a person has eight open tabs and twelve closed individual tabs, with no closed windows. The **Chrome session restore API** page is the eleventh-most-recent entry. It has a unique title and URL, is not a New Tab page, and is not already open. In Chromium 127's default configuration, the backend collects the twelve eligible closed tabs; Tab Search applies its eight-item display limit only when the query is empty, so a typed unique title can match the eleventh entry. This is a source-based expectation, not a live-browser measurement; feature configuration or later Chrome changes may alter it.

| Task | Current route | Bounded Keybar route |
| --- | --- | --- |
| Switch to an open tab titled **Release notes** | Focus Command Bar, type the title, press Enter. | Unchanged. |
| Restore the latest accidental close | Invoke **Reopen closed tab**; Chrome restores the newest session. | Unchanged. |
| Return to **Chrome session restore API** | Open Tab Search with `Ctrl/Cmd+Shift+A`, type the title, and select the matching closed entry. | Invoke closed-tab search, type the title, select the matching tab, and restore its `sessionId`. |

The comparison is synthetic. It counts selection actions, not elapsed time. It assumes Chrome's **Recently Closed** section is expanded; if it is collapsed, expand it before selecting the result, adding one action. ([Tab Search section expansion](https://github.com/chromium/chromium/blob/127.0.6533.119/chrome/browser/resources/tab_search/tab_search_page.ts#L747-L759)) With that assumption, both native Tab Search and the proposed Keybar route take three actions: open the surface, enter the title, and select the result. Chrome History can revisit the URL, while either sessions-based route restores the closed entry. The proposed feature's remaining value is using the same Command Bar workflow as Keybar's other navigation tasks; no speed or reach advantage is established for this unique-URL case.

## Boundary if approved

- Add an explicit **Search recently closed tabs** command or scope. Do not silently mix closed entries into every open-tab query.
- Search only the entries returned by `chrome.sessions.getRecentlyClosed()` (maximum 25 sessions); show individual tab entries and restore the selected `sessionId`.
- Preserve **Reopen closed tab** as the one-step action for the newest entry.
- Reuse the optional `sessions` permission. Before first use, explain that Keybar reads recent tab/window session entries to search and restores only the selected entry; do not rely on a Chrome warning being shown, and do not request the `history` permission for this feature.
- Do not persist the result list or add whole-window restore, saved sessions, backups, export, or sync.
- Refresh results when `sessions.onChanged` fires and handle a stale selection without restoring a different tab.
- Treat task success, permission comprehension, and whether users prefer this over `@history` or repeated undo as later validation, not a blocker for this investigation.

**No code is proposed in this report.** Issue #28 remains open for Pedro's product decision, as required by its parent issue.
