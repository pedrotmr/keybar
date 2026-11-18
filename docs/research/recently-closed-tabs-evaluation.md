# Searchable recently closed tabs: product decision

**Updated:** 18 November 2026  
**Scope:** Evidence-based recommendation for [issue #28](https://github.com/pedrotmr/keybar/issues/28). This is a decision artifact, not an implementation.

## Recommendation

**Go for a narrow Command Bar beta.** Finding a particular recently closed page is a navigation job: return to a known destination after later closures have displaced it from the one-command undo path. Product fit is good; demand evidence is weak and should be validated after a beta. This should remain a short-lived recovery list, not a session manager.

**Decision for Pedro:** approve a searchable, explicitly invoked list of recently closed individual tabs, or defer it in favor of Chrome History and repeated undo. The recommendation below assumes a 25-entry cap and no saved session archive.

## The three jobs

| Job | Keybar today | What is different |
| --- | --- | --- |
| Switch to a tab that is still open | Search the live tab list in the Command Bar. The background queries open tabs and the palette converts them to results. ([`background/index.ts`](../../src/background/index.ts#L104), [`useCommandPaletteModel.ts`](../../src/components/CommandPalette/useCommandPaletteModel.ts#L254)) | Search chooses among current destinations. |
| Undo the latest close | The **Reopen closed tab** command calls `chrome.sessions.restore()` without an ID, so Chrome restores its most recent closed entry. It already requires the optional `sessions` permission. ([`commands.ts`](../../src/utils/commands.ts#L148-L154), [`background/index.ts`](../../src/background/index.ts#L1007-L1008)) | This is a one-step undo, not a search. Keep it unchanged. |
| Find a less-recently closed tab | There is no closed-session search in Keybar today. Chrome documents `Ctrl/Cmd+Shift+T` for reopening closed tabs and its desktop Tab Search for **open** tabs. Chrome History can search visited pages by keyword. ([Chrome shortcuts](https://support.google.com/chrome/answer/157179), [desktop Tab Search](https://support.google.com/chrome/answer/2391819?co=GENIE.Platform%3DDesktop&hl=en), [History search](https://support.google.com/chrome/answer/95589)) | A Keybar result could select a specific closed-session entry directly. History search is a useful fallback for revisiting a URL, but it does not select that closed-session entry; that distinction follows from Chrome's separate History and Sessions interfaces. |

## Evidence and limits

### Chrome API and privacy

Chrome's [`sessions` API](https://developer.chrome.com/docs/extensions/reference/api/sessions) directly supports this job: `getRecentlyClosed()` returns closed tab or window entries in most-recent-first order; `MAX_SESSION_RESULTS` is 25; and `restore(sessionId)` restores a selected entry. `onChanged` signals when that closed list changes. No separate archive or URL lookup is needed.

Keybar already declares `sessions` as an optional permission and requests it for the one-command restore action. Its permission UI calls it **Recently closed tabs**. ([`manifest.json`](../../src/manifest.json#L12), [`PermissionRequest.tsx`](../../src/popup/PermissionRequest.tsx#L5-L10)) Chrome recommends optional permissions for features that can request access at use time. The `sessions` permission also has a browsing-history warning when combined with Keybar's existing `tabs` permission, so the prompt should explain why a closed-tab search needs it. ([Chrome permissions guidance](https://developer.chrome.com/docs/extensions/reference/api/permissions), [permission warning list](https://developer.chrome.com/docs/extensions/reference/permissions-list))

Use the existing permission, request it only when the person invokes closed-tab search, and keep the returned titles and URLs in memory while the search is open. If permission is absent or denied, live-tab search and the rest of Keybar should continue to work. If a result disappears before selection, refresh the list and report the stale result; do not silently fall back to restoring the newest entry.

The API cap is a real product limit: it is 25 **sessions**, not a promise of 25 individual tabs. A closed window is one session entry and may contain multiple tabs. For the first version, show individual tab entries only; omit whole-window results and make clear that this is not an archive of older tabs. The returned set may contain fewer than 25 tabs after window entries are filtered out.

### Competitor evidence

The existing competitor review study says QuicKey includes closed-tab search and that closed-tab requests appear in several switchers. ([competitive analysis](competitive-analysis.md#L48)) Two examples in the local sample are relevant but not strong demand proof: one QuicKey reviewer encountered a closed tab in tab search, and one Quick Tab Switch reviewer valued recognizing closed tabs. ([QuicKey sample](competitor-reviews/quickey.json#L21), [Quick Tab Switch sample](competitor-reviews/quick-tab-switch.json#L12)) The first describes unexpected new-window behavior, not a direct feature request; the second is praise for recognition, not a request for a closed-tab search.

The full sample covers 602 selected English reviews across 26 extensions, gathered from Recent and Helpful sorts. It is neither representative nor a measure of demand for Keybar. Session-backup and lost-data requests in tab managers describe a different, durable recovery job and should not be used to justify archives, sync, or workspaces. ([sample limits](competitive-analysis.md#L74), [parent issue #20 scope](https://github.com/pedrotmr/keybar/issues/20))

## Synthetic comparison

Assume a person has eight open tabs and twelve closed individual tabs in Chrome's recent-session list, with no closed windows. The unique **Chrome session restore API** page is the eleventh-most-recent entry, and it is still present in that list. The title is known and does not match another result.

| Task | Current route | Bounded Keybar route |
| --- | --- | --- |
| Switch to an open tab titled **Release notes** | Focus Command Bar, type the title, press Enter. | Unchanged. |
| Restore the latest accidental close | Invoke **Reopen closed tab**; Chrome restores the newest session. | Unchanged. |
| Return to **Chrome session restore API** | Repeat Chrome's reopen shortcut until the target is reached (eleven presses in this scenario), or search Chrome History and reopen a matching visit. | Invoke closed-tab search, type the title, select the matching tab, and restore its `sessionId`. |

The comparison is synthetic. It counts selection actions, not elapsed time, and assumes the target is still inside Chrome's capped list. History search may be just as effective when the goal is only to revisit a page; the stronger case for Keybar is selecting a recent closed-session entry from the same keyboard workflow.

## Boundary if approved

- Add an explicit **Search recently closed tabs** command or scope. Do not silently mix closed entries into every open-tab query.
- Search only the entries returned by `chrome.sessions.getRecentlyClosed()` (maximum 25 sessions); show individual tab entries and restore the selected `sessionId`.
- Preserve **Reopen closed tab** as the one-step action for the newest entry.
- Reuse the optional `sessions` permission, explain Chrome's warning, and avoid requesting the `history` permission for this feature.
- Do not persist the result list or add whole-window restore, saved sessions, backups, export, or sync.
- Refresh results when `sessions.onChanged` fires and handle a stale selection without restoring a different tab.
- Treat task success, permission comprehension, and whether users prefer this over `@history` or repeated undo as later validation, not a blocker for this investigation.

**No code is proposed in this report.** Issue #28 remains open for Pedro's product decision, as required by its parent issue.
