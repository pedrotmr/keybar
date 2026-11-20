# Product

## Users

Keyboard-first Chrome users who keep many tabs open while researching, writing, planning, or building. They want to find a page or take a browser action without hunting through menus.

## Purpose

Keybar brings local search, browser commands, external search handoffs, and tab management into one fast interaction model. The Command Bar is the primary surface. The Tab Switcher is a separate, compact recent-tabs view opened with its keyboard shortcut on supported web pages.

Success means local actions feel immediate, tab names survive ordinary navigation, keyboard and screen-reader users can complete the same workflows, and the extension leaves the host page visually untouched.

## Product character

Quiet, precise, capable. Offer Open Sans, Outfit, Nunito Sans, Sora, and IBM Plex Mono with platform fallbacks and aligned result metadata. Plain is the black-and-white default; the palette can change the color mood without changing the shared hierarchy or interaction language. Keep the selected row clear without gradients, stacked pills, or decorative chrome. Load fonts locally and keep the system fallback responsive while they load. Arc, Lumno, and Raycast are references for selected interaction ideas, not templates to copy. Keybar is the product name.

## Principles

- Keep activation, local search, and keyboard response fast; network handoffs never block local results.
- Treat accessibility as part of each interaction: semantic controls, visible focus, predictable navigation, screen-reader announcements, reduced motion, and WCAG 2.2 AA contrast.
- Keep the Command Bar and Tab Switcher visually related while giving each a layout suited to its task.
- Store custom tab names as extension metadata. On regular pages, renaming also sets the page's document title so Chrome's tab strip shows the name (requires HTTP(S) host access, same model as Tab Renamer).
- Request optional API permissions (bookmarks, history, tab groups, sessions, clipboard) only when a user chooses the feature that needs them. HTTP(S) host access for tab-strip renaming is required at install.
- Render page overlays in extension-owned styles and leave host-page appearance and behavior alone aside from an explicit rename of document.title.
- Keep the command catalog focused; API availability alone is not a reason to add a feature.

## Anti-references

- A wholesale clone of another product.
- Heavy blur, decorative animation, or large visual effects that cost responsiveness.
- Fragile scraping or unsupported private APIs for external providers.
- Permissions, analytics, or background network activity without a clear user benefit.

## Accessibility and release quality

Target WCAG 2.2 AA where applicable. Verify keyboard-only completion of open, search, navigate, execute, nested flow, back, and close. Check visible focus, focus restoration, screen-reader announcements, zoom and text scaling, reduced motion, forced colors, and both themes. Automated checks complement real browser and assistive-technology workflows.
