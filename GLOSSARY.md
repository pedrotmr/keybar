# Keybar

Keyboard-first command surface for Chrome: find tabs, bookmarks, history, commands, and hand off web searches to providers.

## Language

**Command Bar**:
The search overlay (or extension popup on Chrome-native pages) where the user types a query and picks a result.
_Avoid_: Omnibar, command palette (in product copy)

**History item**:
A previously visited page from Chrome history, shown as a result row.
_Avoid_: Search history, past searches

**Search handoff**:
A result that opens a search provider’s URL with the current query (for example Google), then dismisses the Command Bar. Not an embedded API result list.
_Avoid_: Search result, Google result, web result

**Unmatched-query Google fallback**:
The automatic Google search handoff shown when the query has no provider prefix (not `g …`).
_Avoid_: Default search, Google suggestion

**Result ranking**:
The order of rows in the Command Bar list for a query.
_Avoid_: Relevance only (when meaning the full ordered stack of types)

**Active result**:
The highlighted row that Enter activates. Follows the top of result ranking unless the user moves with arrow keys.
_Avoid_: Focus (when meaning the selected result row), selection (ambiguous with multi-select)
