# AI tab organizer prototype

This isolated prototype evaluates tab grouping and duplicate cleanup in a separate Chrome profile. It does not add an organizer command to the released Keybar extension.

Follow-up: [#37](https://github.com/pedrotmr/keybar/issues/37) explores a lightweight command-menu UX before integrating this into the existing extension. A full settings-style screen has not been selected.

## Chosen route

The prototype has two provider choices:

- **Codex models · ChatGPT plan** uses OpenAI's local **Sign in with ChatGPT** DevKit. It requests `chatgpt.tokens.use.direct` through the browser sign-in flow. The local Codex CLI supplies the model and supported reasoning-effort catalog; analysis itself uses the DevKit's direct Responses API client with no tools. OAuth tokens stay in the native host and the SDK stores them encrypted with a key held in macOS Keychain.
- **Claude Code · Claude plan** uses the user's installed, unmodified Claude Code CLI. **Sign in with Claude Code** opens Terminal and runs `claude auth login`; the user completes Anthropic's own sign-in flow there. The host checks `claude auth status` and accepts Claude account OAuth only. Analysis starts `claude -p`, streams tab metadata through stdin, and never reads, stores, or forwards Claude credentials. The prototype does not sign out of Claude Code because that would also sign the user out of their CLI outside this extension.

Codex's bundled model catalog does not confirm that a selected model is enabled for the signed-in account; a successful analysis request does. Claude Code does not expose a subscription-specific model catalog, so the prototype offers its documented `haiku`, `sonnet`, `opus`, and `fable` aliases and CLI effort flags. Model access and supported effort levels depend on the signed-in account and selected model; the CLI validates them when a request runs. The CLI does not offer a non-reasoning switch. Haiku with low effort is the default. Claude usage follows the user's Claude plan and limits.

The DevKit is source-only and its current license is noncommercial. Anthropic's developer guidance says products that interact with Claude should use Console API-key authentication, while its legal page permits an end user to sign in to the unmodified Claude Code binary with their own subscription. This local prototype tests that binary-launch route only; it is not a production policy approval. Review the terms for any wider distribution. Do not ship the DevKit in a commercial Keybar release without different rights and provider integration. The DevKit commit is pinned as a Git submodule so its exact source and license stay visible; setup applies a small, idempotent local patch for selected reasoning effort and host-only token access without changing that commit.

Installing the pinned DevKit currently reports dependency audit advisories, including a high-severity advisory in its optional `undici` dependency. Review the [research notes](../../docs/research/ai-tab-organizer.md) before running the prototype and resolve the upstream dependency finding before broader distribution.

Analysis considers every eligible HTTP(S) tab open in this Chrome profile, including other windows, plus the sample tabs. Use an empty profile for sample runs. Fresh AI requests send one unpinned representative per exact URL to the selected provider; local-only and cached proposals make no inference request. Each sent record includes its title, up to 2,048 URL characters, pinned state, existing group name, and a temporary request-local number to match the response. That number is not the Chrome tab ID and is discarded after the response. Full URLs stay in the extension for local duplicate detection and stale-tab checks. The browser password store, page contents, cookies, and browsing history are not read. URLs can themselves contain sensitive data, such as access tokens in query strings, and that text may be sent. Tab titles and URLs are untrusted input. The AI returns a proposal; the extension validates Chrome tab IDs against current browser state and requires a separate user selection before grouping or closing. Pinned tabs are protected from grouping and closing. Closed URLs can be reopened, but page state such as unsaved form data cannot be restored.

The default Codex model prefers **GPT-6 Luna**, then another listed Luna model, then the first account-listed model. Claude Code defaults to the **Haiku** alias with low effort. Users can change the model and reasoning effort. Setup patches the pinned local SDK working tree to pass the selected effort and expose a refreshed OAuth token only to the native host for Codex catalog discovery. The patch is idempotent and leaves the pinned submodule commit unchanged.

## Requirements

- macOS, Google Chrome, Node.js 22.12+, Git, and Xcode Command Line Tools.
- Codex CLI, an eligible ChatGPT account for the Codex model route, and network access.
- Claude Code CLI and a Claude account for the Claude route. If Claude Code is not found during setup, install it and rerun the installer.
- The repository checked out with submodules.

## Setup

From the repository root:

```sh
git submodule update --init --recursive
npm ci --prefix prototypes/tab-organizer/vendor/sign-in-with-chatgpt-devkit
node prototypes/tab-organizer/apply-devkit-patch.mjs
npm run build -w @siwc/local --prefix prototypes/tab-organizer/vendor/sign-in-with-chatgpt-devkit
```

1. Open `chrome://extensions`, turn on Developer mode, and load `prototypes/tab-organizer/extension` as an unpacked extension.
2. Copy its extension ID, then register the local host:

   ```sh
   node prototypes/tab-organizer/install-host.mjs EXTENSION_ID
   ```

3. Open the prototype extension popup and choose **Codex models · ChatGPT plan** or **Claude Code · Claude plan**.
4. For Codex models, use **Continue with ChatGPT** and approve plan usage in the browser. For Claude Code, click **Sign in with Claude Code** and finish the sign-in in Terminal. Reopen the popup to refresh the connection status. Neither credential is stored in Chrome.
5. Choose a model and reasoning effort. **Reload model options** refreshes the Codex catalog or reloads Claude Code's documented aliases.
6. Use an empty dedicated Chrome profile. Click **Load sample tabs** to create local-only product, research, travel, and duplicate tabs. Analysis considers every eligible HTTP(S) tab across all profile windows, so loading samples does not isolate an existing browsing profile. Then select **Organize tabs**.
7. Review each suggested group and any close candidates. Grouping is selected by default; closing is never selected by default. Click **Apply selected changes** to make browser changes.

The native host requires Chrome's exact extension ID in its `allowed_origins` list. Re-run the installer if the extension ID changes. To remove the prototype, first choose **Disconnect** in the popup if connected, then remove the extension, native host registration, launcher, stored credentials, and Keychain encryption key:

```sh
rm -f "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.keybar.tab_organizer.json"
rm -rf "$HOME/Library/Application Support/Keybar Tab Organizer Prototype"
security delete-generic-password -a credential-encryption-key -s com.keybar.tab-organizer
```

If you used an earlier version that accepted a Claude Console API key, that unused key is no longer read. Remove its old Keychain entry separately if desired:

```sh
security delete-generic-password -a anthropic-console-api-key -s com.keybar.tab-organizer.anthropic
```

## Evaluation notes

Run `npm run test:tab-organizer` from the repository root for the account-free prototype tests included in CI. After completing DevKit setup, run `npm run test:tab-organizer:non-reasoning` to additionally check the built SDK's reasoning request and proposal-member safeguards. These local tests do not replace the signed-in synthetic evaluation in #36.

Performance changes are being evaluated one at a time:

1. **Shorter output:** models return group names and tab IDs without a summary or group explanations. Duplicate reasons are limited to eight words in the prompt. Both providers use the same response contract. User-reported step 1 Host times were Luna low **8,596 ms** and Haiku low **6,287 ms**; tab count and repeat count were not supplied, so these are observations rather than a benchmark median.
2. **Authentication and startup overhead:** requests reuse one native-host connection, which closes after 60 seconds with no pending requests. The host keeps only the Keychain encryption key in memory for its lifetime and rereads it if decryption fails. The Codex SDK still validates its saved account, sharing permission, and token freshness on each request; the redundant preflight session read has been removed. Claude model options no longer launch an authentication subprocess, because the aliases are public metadata. Every fresh Claude analysis still checks the CLI's current authentication method before inference. Cancellation targets the active analysis; timeout or host failure closes the shared connection and the next request reconnects without automatically replaying inference. The user reported Luna low **9,700 ms** and Haiku low averaging **7,800 ms** for step 2. No timing breakdown or controlled repeat count was supplied; these observations have not established an improvement.
3. **Local work and proposal reuse:** exact duplicates are matched using complete URL strings before the provider's 2,048-character truncation, without normalizing queries or fragments. Only one unpinned representative per URL goes to the model; pinned tabs stay local. Topic groups expand back to the original unpinned copies for review. Exact-duplicate closures prefer keeping a pinned copy, otherwise the copy with the lowest tab ID. That keeper is protected from AI closure suggestions and must still exist at the same URL when a local closure is applied. Local and AI closure suggestions share the existing five-candidate limit and remain unchecked by default. With fewer than two unpinned representative URLs, the proposal is local and no native request is made. The user reported Luna low **6,500 ms**, Haiku low **700 ms**, and cache reuse around **3–4 ms** for step 3; the source labels, tab counts, and repeat counts were not captured alongside those observations.
4. **Progressive display (current):** both providers feed text deltas into a bounded scanner that extracts complete group objects. Previews pass the same ID, pinned-tab, membership, and name validation as final groups. The host forwards group snapshots through request-correlated progress messages; the extension expands duplicate representatives and shows read-only groups as they arrive. Apply is blocked both in the popup and worker while analysis runs. The complete JSON and provider completion are still required before enabling review or caching a proposal. A cancellation or failure discards previews. Late progress and messages from other popup runs are ignored. Closing the popup does not interrupt inference; only its complete successful result may be cached.

The extension keeps one successful proposal in worker memory for at most five minutes, until it is replaced or the worker stops. The cache key includes provider, model, effort, actual tab IDs, complete URLs, titles, pinned state, window IDs, and group IDs/names. Changing that snapshot or the model settings misses the cache. Sign-in/out attempts, disconnected status, apply, reopen, and sample-tab actions clear it; invalidation during inference prevents that result from repopulating the cache. Failed and cancelled requests are not cached. No credentials or new browser-storage records are cached. **Run fresh analysis** clears and bypasses the cache; duplicate preprocessing still runs.

For step 4, the user reported **First group shown** at **5,704 ms** for Haiku low and **3,791 ms** for Luna low. Total completion times from those runs were not supplied. These measure first preview display from the popup click and cannot establish a completion-time improvement over the earlier Host measurements.

The user then supplied the following detailed fresh step 4 runs. Both used low effort, analyzed 32 tabs, sent 27 records to AI, found 2 exact duplicate copies, and reused the companion. Times are milliseconds; this is one reported run per provider, not a controlled benchmark median.

| Measurement                    | Luna low | Haiku low |
| ------------------------------ | -------: | --------: |
| Total                          |    4,239 |     6,621 |
| First group shown              |    2,492 |     4,646 |
| Host                           |    4,234 |     6,616 |
| Auth check                     |        0 |       212 |
| Request / CLI + request        |    4,234 |     6,404 |
| First text within request      |    2,126 |     4,359 |
| First group within host        |    2,484 |     4,640 |
| Validation                     |        0 |         0 |
| Output characters (not tokens) |      320 |       557 |

In these runs, group previews appeared **1,747 ms** before Luna completed and **1,975 ms** before Haiku completed. Time outside the host was only 5 ms in each run. Both request phases spent about 2.1 seconds after the first text delta; Haiku's extra wait was primarily before that delta, inside its combined CLI/request phase. These measurements do not separate CLI startup, networking, provider queueing, or model processing, so they cannot identify which caused that difference or establish a general provider speed ranking.

After reloading the unpacked extension, keep the same tabs, model, and effort and leave proposals unapplied:

- Run **Organize tabs** once and record **Fresh AI** Host/Total times, plus **Sent to AI** and exact-duplicate counts under **Timing details · step 4**.
- Run **Organize tabs** again to measure a **Cached proposal**. That timing measures reuse, not faster model generation. It reports Total only and does not reuse the original request's timing numbers.
- Use **Run fresh analysis** 3–5 times to measure fresh requests for comparison with prior steps. Record **First group shown** and **Total** separately. Run less than 60 seconds apart to reuse the companion, and include Auth check / Request timing details where possible. Streaming is intended to make something useful visible sooner; full completion may take a similar amount of time.
- **Local result** means no AI request was necessary (for example, a duplicate-only tab set). It also reports Total rather than an artificial Host time.

No installer rerun is needed for this step.

**Total** measures the popup click through receipt of the proposal, including collecting tabs and starting the native host. **First group shown** measures from that click through inserting the first matching progress preview into the popup DOM (before the browser's next paint). It is absent for local/cache results. If the complete response arrives before any preview is displayed, the panel says **no streamed preview**. **Host** retains the previous analysis timer. Its breakdown separates the initial **Auth check**, **Request** (or **CLI + request** for Claude), and response validation. Request time includes SDK credential access or refresh for Codex, and CLI startup for Claude; it is not a pure model-inference measurement. Both providers report the first nonempty text delta relative to the request start; **First group within host** is relative to the host analysis start and includes its auth check. Output size is counted in characters, not tokens. No tab metadata or credentials are added to logs.

Claude uses the documented [`stream-json`, `--verbose`, and `--include-partial-messages` flags](https://code.claude.com/docs/en/headless#stream-responses). Only main-response text deltas are consumed for previews; thinking, account metadata, subagent output, and full assistant snapshots are not forwarded to the extension. The final `result` message remains authoritative and is required for success. CLI output is decoded as UTF-8 and bounded in memory, with session persistence still disabled.

Claude's analysis CLI still starts per request. Its documented [`--bare` startup optimization](https://code.claude.com/docs/en/headless#start-faster-with-bare-mode) does not read subscription OAuth credentials or the system Keychain, so it cannot be used for this subscription route. [Chrome native messaging](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle#chrome-105) keeps the worker alive while the host connection is open; the idle timeout releases it between sessions.

`docs/research/ai-tab-organizer.md` records the dated provider comparison, official references, permissions, setup and distribution implications, the sample-tab evaluation, and what still needs a live account run. The UI reports request latency. It does not expose per-request cost or token counts; plan limits and usage are managed by ChatGPT or Claude and can vary by plan, model, and activity.

Provider references: [Codex app-server model catalog and ChatGPT-plan authentication](https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server), [OpenAI reasoning effort](https://developers.openai.com/api/docs/guides/reasoning), [Claude Code CLI reference](https://code.claude.com/docs/en/cli-usage), and [Claude Code authentication and credential use](https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use).

## Failure behavior

- Missing DevKit build, native host registration, or Node.js: show a setup error with the failed local-host action.
- Disconnected, ineligible, or sharing-disabled ChatGPT account: offer **Continue with ChatGPT** and explain that explicit plan-usage permission is required.
- Claude Code CLI path not registered: install the CLI if needed, then rerun setup. Missing Claude account sign-in: open Terminal through **Sign in with Claude Code** and finish `claude auth login` there. Console API-key or other authentication modes are rejected without changing the user's existing CLI credentials.
- Codex model catalog mismatch: ask the user to update the Codex CLI and refresh; catalog presence alone does not establish account entitlement.
- Network, timeout, model-access, plan-limit, or malformed response: keep the tab set untouched and allow retry. Analysis requests time out after two minutes; provider sign-in runs in the provider's own flow.
- Tabs that closed, changed URL, or became pinned since analysis are skipped. Other groups and closes continue, with a partial-result summary.
- Closing stores the title, URL, and original window in `chrome.storage.session`; **Reopen last closed tabs** creates new tabs at those URLs. A later closing batch replaces the saved list, so only the latest batch can be reopened. Chrome clears session storage when it restarts or the extension is disabled, reloaded, or updated. Failed reopen attempts remain available to retry. Unsaved page state is not recoverable.

## Scope and limitations

The prototype targets Chrome on macOS. Chrome's Native Messaging API also works on Windows and Linux, but host registration and secure credential storage require per-OS installers and key-store adapters. Windows and Linux packaging, Chrome Web Store distribution, provider latency measurements under normal account load, and production policy review remain follow-up work.
