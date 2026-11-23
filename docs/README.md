# Keybar documentation

Index of product, launch, research, agent, how-to, and prototype docs. Start here when you need to know what a file is for and whether a research decision is still open.

## Produto

Repo-root product docs.

- [README.md](../README.md) — product overview, setup, and first-use walkthrough.
- [PRODUCT.md](../PRODUCT.md) — product definition and scope.
- [DESIGN.md](../DESIGN.md) — design system, typography, and palettes.
- [GLOSSARY.md](../GLOSSARY.md) — shared terms for the Keybar domain.
- [AGENTS.md](../AGENTS.md) — agent entry points; points at the docs in [Agents](#agents).
- [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) — third-party licenses and notices.
- [AUDIT.md](../AUDIT.md) — **historical.** Production audit snapshot from 31 October 2026; outdated, kept as a record only.

## Launch

Chrome Web Store preparation.

- [docs/launch/chrome-web-store.md](launch/chrome-web-store.md) — canonical Store launch kit (listing copy, screenshots, privacy practices, artwork).
- [docs/store-listing.md](store-listing.md) — pointer to the launch kit; earlier draft listing copy is kept there for reference.
- [docs/launch/name-check.md](launch/name-check.md) — name and trademark screen for the Store listing.
- [docs/launch/privacy-policy.md](launch/privacy-policy.md) — privacy policy text for launch.

## Research

Each research markdown has a status block at the top (`decidido` / `pendente` / `implementado`), with date and issue. Raw review fixtures live in [docs/research/competitor-reviews/](research/competitor-reviews/).

- [recently-closed-tabs-evaluation.md](research/recently-closed-tabs-evaluation.md) — [#28](https://github.com/pedrotmr/keybar/issues/28). **decidido** (23 November 2026): do not build searchable recently-closed tabs.
- [tab-switcher-mru-evaluation.md](research/tab-switcher-mru-evaluation.md) — [#24](https://github.com/pedrotmr/keybar/issues/24). **decidido** (23 November 2026): keep the current MRU size of 5.
- [search-provider-catalog.md](research/search-provider-catalog.md) — [#29](https://github.com/pedrotmr/keybar/issues/29). **decidido** (23 November 2026): large configurable provider catalog; implementation issue a abrir.
- [command-bar-relevance-evaluation.md](research/command-bar-relevance-evaluation.md) — [#22](https://github.com/pedrotmr/keybar/issues/22). **implementado.** Follow-up is [#55](https://github.com/pedrotmr/keybar/issues/55). Issue [#23](https://github.com/pedrotmr/keybar/issues/23) (performance baselines) is also concluded, with the same follow-up; it has no dedicated research markdown.
- [ai-tab-organizer.md](research/ai-tab-organizer.md) — [#36](https://github.com/pedrotmr/keybar/issues/36), [#37](https://github.com/pedrotmr/keybar/issues/37). **decidido** (23 November 2026): frozen until Chrome Web Store publication.
- [tab-title-renaming.md](research/tab-title-renaming.md) — [#40](https://github.com/pedrotmr/keybar/issues/40) / PR [#53](https://github.com/pedrotmr/keybar/pull/53). **implementado.**
- [command-bar-first-use-review.md](research/command-bar-first-use-review.md) — [#26](https://github.com/pedrotmr/keybar/issues/26) / PR [#48](https://github.com/pedrotmr/keybar/pull/48). **implementado.**
- [competitive-analysis.md](research/competitive-analysis.md) — no matching issue. **implementado:** reference research; no pending product decision.

## Agents

Workflow for agents working in this repo.

- [docs/agents/issue-tracker.md](agents/issue-tracker.md) — GitHub issue conventions, including the research-decision rule (`ready-for-human` until Pedro decides; approved work becomes a new `ready-for-agent` issue).
- [docs/agents/triage-labels.md](agents/triage-labels.md) — the five triage labels and what they mean.
- [docs/agents/domain.md](agents/domain.md) — domain-doc conventions (`GLOSSARY.md`, ADRs).
- [docs/agents/provider-icons.md](agents/provider-icons.md) — how to source and add provider icons.

## How-tos

- [docs/ctrl-tab-setup.md](ctrl-tab-setup.md) — use Control+Tab with Keybar.
- [docs/profile-shortcut-helper.md](profile-shortcut-helper.md) — configure Control+Tab on macOS.
- [docs/extension-validation.md](extension-validation.md) — validate an unpacked extension build.

## Protótipos

Isolated fixtures, not part of the production extension build.

- [prototypes/tab-organizer](../prototypes/tab-organizer/README.md) — AI tab organizer research prototype. Frozen with the research in [ai-tab-organizer.md](research/ai-tab-organizer.md) until Store publication.
- [prototypes/tab-title-rename](../prototypes/tab-title-rename/README.md) — **historical.** Tab-strip renaming research fixture; production shipped in PR [#53](https://github.com/pedrotmr/keybar/pull/53).
