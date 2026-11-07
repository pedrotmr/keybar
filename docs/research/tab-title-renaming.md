# Making custom names appear in Chrome's tab strip

## Recommendation

The page title can be replaced by injecting code into the page and setting `document.title`. Keybar's existing `activeTab` and `scripting` permissions support an on-demand override after the user invokes Keybar on a regular page. Chrome retains the temporary grant through same-origin navigation, including reload, so Keybar can reinject after those loads without optional host access while the grant remains active.

Once that grant ends—after a different-origin navigation or tab close—the user can invoke Keybar again to grant access to the current page. Optional host access is needed for automatic background reapplication without a fresh invocation, including after a browser restart and session restore. Recommend requesting it for the restored page's current origin when a user chooses to show a name in Chrome's tab strip. This adds no access to unrelated sites. No permission was added to Keybar; the product and permission decision is tracked separately in issue [#40](https://github.com/pedrotmr/keybar/issues/40).

On pages where access is not granted, keep the existing Keybar-only custom name. Chrome pages, extension pages, the Chrome Web Store, and other restricted pages cannot be scripted.

## Evidence

- The [Tab Renamer Chrome Web Store listing](https://chromewebstore.google.com/detail/tab-renamer/mncaahedchkhclokjmfjbennhbeceecl) describes tab-title changes and says names persist when tabs or windows are reopened. The listing does not document its permissions or implementation, so its permission model cannot be verified from the public listing.
- Chrome's [scripting API](https://developer.chrome.com/docs/extensions/reference/api/scripting) requires the `scripting` permission and either matching host access or `activeTab` for injection.
- Chrome's [`activeTab` documentation](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab) says access follows a user invocation, continues across same-origin navigation, is revoked on a different-origin navigation or tab close, and does not allow restricted pages such as `chrome://` pages.
- The [`tabs` API](https://developer.chrome.com/docs/extensions/reference/api/tabs) exposes the browser-computed tab title, but `tabs.update()` does not accept a title. Changing what Chrome displays therefore requires changing the page's `document.title` through script injection.
- Chrome's [permissions guidance](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions) supports declaring site access as optional so it can be requested when the user chooses the feature.

## Prototype results

The isolated [prototype](../../prototypes/tab-title-rename/README.md) confirms the page-side behavior in Chromium. The focused browser test launches the popup without a tab-ID parameter, grants the fixture origin, applies a custom title, resists a same-document SPA title update, reapplies after same-origin reload and navigation, restores the new document's original title, prevents a restore from site A from changing site B's title, and confirms Chrome rejects injection into `chrome://version`.

The prototype also shows the permission boundary: its popup requests the current origin only. The main automated fixture grants its two test origins (`title-prototype.test` and `other-title.test`) at extension load so it can run headlessly without an interactive Chrome permission prompt; the test verifies the requested origin but does not exercise Chrome's permission prompt or denial path. A separate temporary fixture grants `<all_urls>`, confirms injection succeeds on an ordinary web page, then confirms Chrome blocks `chrome://version`. These fixtures do not alter Keybar's manifest.

### Navigation and identity

- **SPA title updates:** A `MutationObserver` can restore the custom title when the page changes it. The prototype demonstrates this behavior.
- **Same-origin reload:** Chrome documents that `activeTab` survives same-origin navigation, including reloads; the service worker can reinject while that grant remains active. The prototype demonstrates the reinjection behavior using its granted test origin.
- **Different-origin navigation:** The temporary `activeTab` grant is revoked. Invoking Keybar again can grant access to the new page; optional host access is needed only for automatic background reinjection without a fresh invocation.
- **Browser restart and session restore:** `activeTab` is temporary and tied to the invoked tab, so the user must invoke Keybar again for on-demand injection after restore. Optional host access for the matching origin permits automatic reinjection, but Keybar must first identify the restored tab. Keybar already reattaches custom names only on a unique URL/title match. Reuse that reconciliation, and do not key durable state only by tab ID.
- **Restricted pages:** Chrome blocks injection regardless of this prototype's site-access flow. Leave those tabs' Chrome titles unchanged.
- **Back/forward cache:** The prototype does not reconcile cached documents after an override is restored or cleared. Going Back can restore a page that still displays the custom title after its saved override record was removed; the prototype's Restore action then has no record to use. A production implementation needs to handle cached documents explicitly.

## Implementation decision

If approved, implement this behind an explicit per-site **Show custom name in Chrome's tab strip** action. Request only the current page's origin with optional host permissions. Persist the original page title separately from the custom name. Ensure title-change events caused by Keybar do not overwrite the original title in `src/background/index.ts`. Reattach after session restore only when Keybar's existing unique-match rule succeeds. Restore the original page title when the user disables the feature or clears the custom name.

Decision needed from Pedro: approve the per-site optional access prompt and the tab-strip behavior, or keep custom names exclusive to Keybar's UI. No change to the shipped permission footprint was made as part of this investigation.
