#!/usr/bin/env node
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { execFile, execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { createChatGPT } from '../vendor/sign-in-with-chatgpt-devkit/packages/local/dist/index.js';
import { listCodexModels } from './codex-model-catalog.mjs';
import { PROPOSAL_INSTRUCTIONS, validateProposal } from './proposal.mjs';
import { buildStreamRequest } from './stream-request.mjs';
import { createGroupStream } from './group-stream.mjs';
import { createClaudeStream } from './claude-stream.mjs';
import {
  CLAUDE_MODELS,
  CLAUDE_REASONING_EFFORTS,
  isProvider,
  OPENAI_REASONING_EFFORTS,
  PROVIDERS,
} from '../extension/shared/provider-config.mjs';
import { CLAUDE_PROCESS_TIMEOUT_MS } from '../extension/shared/timeouts.mjs';
import { NativeHostAction, NativeHostEvent } from '../extension/shared/protocol.mjs';

const execFileAsync = promisify(execFile);
const MAX_FRAME_BYTES = 2 * 1024 * 1024;
const MAX_TABS = 100;
const KEYCHAIN_SERVICE = 'com.keybar.tab-organizer';
const KEYCHAIN_ACCOUNT = 'credential-encryption-key';
const APP_SUPPORT_DIRECTORY = join(homedir(), 'Library', 'Application Support', 'Keybar Tab Organizer Prototype');
const PROVIDER_RUNTIME_PATH = join(APP_SUPPORT_DIRECTORY, 'codex-runtime.json');
let encryptionKey;
const OPENAI_EFFORTS = new Set(OPENAI_REASONING_EFFORTS);
const CLAUDE_EFFORTS = new Set(CLAUDE_REASONING_EFFORTS);

const credentialEncryption = {
  id: 'keybar-tab-organizer-macos-keychain-aes-256-gcm-v1',
  isAvailable: () => process.platform === 'darwin' && existsSync('/usr/bin/security'),
  async encrypt(plaintext) {
    const key = await getEncryptionKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
  },
  async decrypt(value) {
    const data = Buffer.from(value);
    if (data.length < 29) throw new Error('The saved ChatGPT connection could not be decrypted. Connect again.');
    const decrypt = (key) => {
      const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12));
      decipher.setAuthTag(data.subarray(12, 28));
      return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
    };
    const key = await getEncryptionKey();
    try {
      return decrypt(key);
    } catch {
      encryptionKey = undefined;
      return decrypt(await getEncryptionKey());
    }
  },
};

const chatgpt = createChatGPT({
  appName: 'Keybar Tab Organizer Prototype',
  appId: 'keybar-tab-organizer-prototype',
  redirectPort: 0,
  sendHostId: true,
  storageDir: join(homedir(), 'Library', 'Application Support', 'Keybar Tab Organizer Prototype', 'chatgpt'),
  credentialEncryption,
  openBrowser: async (href) => {
    const target = new URL(href);
    if (target.origin !== 'https://auth.openai.com') throw new Error('Unexpected ChatGPT sign-in destination.');
    await execFileAsync('/usr/bin/open', [target.href]);
  },
});

let input = Buffer.alloc(0);
let activeController;
let activeAnalysisId;
let signInPending = false;
let completedRequests = 0;

process.stdin.on('data', (chunk) => {
  input = Buffer.concat([input, chunk]);
  while (input.length >= 4) {
    const length = input.readUInt32LE(0);
    if (length > MAX_FRAME_BYTES) {
      process.stderr.write(`Rejected oversized native-message frame (${length} bytes).\n`);
      process.exit(1);
    }
    if (input.length < length + 4) return;
    const frame = input.subarray(4, length + 4);
    input = input.length === length + 4 ? Buffer.alloc(0) : input.subarray(length + 4);
    void handleFrame(frame);
  }
});

process.stdin.on('end', () => {
  activeController?.abort();
  if (signInPending) chatgpt.cancelSignIn();
  setTimeout(() => process.exit(0), 100).unref();
});

process.stdin.on('error', () => process.exit(1));

async function handleFrame(frame) {
  let request;
  try {
    request = JSON.parse(frame.toString('utf8'));
    if (request?.action === NativeHostAction.cancelAnalysis) {
      if (request.targetId === activeAnalysisId) activeController?.abort();
      return;
    }
    const data = await dispatch(request);
    completedRequests++;
    send({ id: request.id, ok: true, data });
  } catch (error) {
    send({ id: request?.id, ok: false, error: safeMessage(error) });
  }
}

async function dispatch(request) {
  if (!request || typeof request.action !== 'string') throw new Error('Invalid local host request.');
  switch (request.action) {
    case NativeHostAction.session:
      return providerSession(request.provider);
    case NativeHostAction.signIn: {
      requireProvider(request.provider, 'codex');
      if (process.platform !== 'darwin')
        throw new Error("This prototype's encrypted sign-in storage currently supports macOS only.");
      signInPending = true;
      try {
        const current = await chatgpt.getSession();
        return safeSession(await chatgpt.signIn(current.status === 'connected' ? { reconsent: true } : {}));
      } finally {
        signInPending = false;
      }
    }
    case NativeHostAction.claudeLogin:
      requireProvider(request.provider, 'anthropic');
      return startClaudeLogin();
    case NativeHostAction.disconnect:
      return disconnectProvider(request.provider);
    case NativeHostAction.catalog:
      return loadModelCatalog(request.provider);
    case NativeHostAction.analyze:
      return analyze(request);
    default:
      throw new Error('Unknown local host action.');
  }
}

async function providerSession(provider) {
  requireProvider(provider);
  if (provider === 'codex') return safeSession(await chatgpt.getSession());
  return claudeSession();
}

async function disconnectProvider(provider) {
  requireProvider(provider);
  if (provider === 'codex') {
    await chatgpt.disconnect();
    return safeSession(await chatgpt.getSession());
  }
  throw new Error('Claude Code sign-in is managed by its CLI. This prototype does not sign you out of Claude Code.');
}

async function loadModelCatalog(provider) {
  requireProvider(provider);
  if (provider === 'codex') {
    const session = await chatgpt.getSession();
    if (!session.sharing) throw new Error('Connect ChatGPT and enable plan usage before loading Codex models.');
    const [accountModels, accessToken, codexRuntime] = await Promise.all([
      chatgpt.listModels(),
      chatgpt.getAccessToken(),
      getCodexRuntime(),
    ]);
    const codexModels = await listCodexModels({ ...codexRuntime, accessToken });
    const bySlug = new Map();
    for (const model of codexModels) {
      for (const alias of [model.model, model.id]) {
        if (typeof alias === 'string' && alias) bySlug.set(alias, model);
      }
    }
    const models = accountModels.flatMap((accountModel) => {
      const model = bySlug.get(accountModel.slug);
      if (!model) return [];
      const reasoningEfforts = codexEfforts(model);
      return [
        {
          id: accountModel.slug,
          displayName: accountModel.displayName,
          reasoningEfforts,
          defaultReasoningEffort: chooseDefaultEffort(model.defaultReasoningEffort, reasoningEfforts),
        },
      ];
    });
    if (!models.length) {
      throw new Error(
        'Codex and ChatGPT returned different model catalogs. Update the Codex CLI, then refresh models.',
      );
    }
    return { provider, models };
  }

  return { provider, models: CLAUDE_MODELS };
}

function codexEfforts(model) {
  const advertised = Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts : [];
  const efforts = advertised.flatMap((option) => {
    const value = option?.reasoningEffort;
    if (typeof value !== 'string' || !OPENAI_EFFORTS.has(value)) return [];
    return [{ value, label: value === 'none' ? 'Non-reasoning' : capitalize(value) }];
  });
  return [{ value: 'default', label: 'Provider default' }, ...efforts];
}

function chooseDefaultEffort(advertised, options) {
  if (options.some((option) => option.value === 'none')) return 'none';
  if (options.some((option) => option.value === 'low')) return 'low';
  if (options.some((option) => option.value === advertised)) return advertised;
  return options[0]?.value || 'default';
}

function capitalize(value) {
  return value === 'xhigh' ? 'Extra high' : `${value[0].toUpperCase()}${value.slice(1)}`;
}

async function getCodexRuntime() {
  const runtime = await getProviderRuntime();
  if (typeof runtime?.codexPath !== 'string' || !runtime.codexPath.startsWith('/')) {
    throw new Error('The Codex CLI path is invalid. Re-run the prototype setup.');
  }
  return { codexPath: runtime.codexPath };
}

async function getClaudeRuntime() {
  const runtime = await getProviderRuntime();
  if (typeof runtime?.claudePath !== 'string' || !runtime.claudePath.startsWith('/')) return undefined;
  return { claudePath: runtime.claudePath };
}

async function getProviderRuntime() {
  try {
    return JSON.parse(await readFile(PROVIDER_RUNTIME_PATH, 'utf8'));
  } catch {
    throw new Error('The local provider setup is missing. Re-run install-host.mjs from the prototype README.');
  }
}

async function claudeSession(runtime, signal) {
  runtime ??= await getClaudeRuntime();
  if (!runtime) return { status: 'not_installed', sharing: false };

  let output;
  try {
    ({ stdout: output } = await execFileAsync(runtime.claudePath, ['auth', 'status'], {
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 64 * 1024,
      signal,
    }));
  } catch (error) {
    if (error.code === 1 && typeof error.stdout === 'string') output = error.stdout;
    else
      throw new Error('Could not check Claude Code sign-in. Open Terminal and run `claude auth status`.', {
        cause: error,
      });
  }

  let auth;
  try {
    auth = JSON.parse(output);
  } catch (error) {
    throw new Error('Claude Code returned an unreadable sign-in status. Update Claude Code and rerun setup.', {
      cause: error,
    });
  }
  if (auth?.loggedIn === false || auth?.authMethod === 'none') {
    return { status: 'disconnected', sharing: false };
  }
  if (auth?.authMethod === 'claude.ai' || auth?.authMethod === 'oauth_token') {
    return { status: 'connected', sharing: false, authMethod: 'subscription' };
  }
  return { status: 'unsupported_auth', sharing: false };
}

async function startClaudeLogin() {
  if (process.platform !== 'darwin') throw new Error('Claude Code sign-in currently opens Terminal on macOS only.');
  const runtime = await getClaudeRuntime();
  if (!runtime) throw new Error('Install Claude Code, then rerun the prototype setup to register its CLI path.');
  const loginScript = join(APP_SUPPORT_DIRECTORY, 'claude-login.command');
  if (!existsSync(loginScript)) throw new Error('Claude Code sign-in setup is missing. Rerun the prototype installer.');
  try {
    await execFileAsync('/usr/bin/open', ['-a', 'Terminal', loginScript], { timeout: 15_000 });
  } catch {
    throw new Error('Could not open Terminal for Claude Code sign-in. Open Terminal and run `claude auth login`.');
  }
  return { status: 'login_started' };
}

function claudeConnectionError(status) {
  if (status === 'not_installed') {
    return new Error('Claude Code CLI path is not registered. Install it if needed, then rerun the prototype setup.');
  }
  if (status === 'unsupported_auth') {
    return new Error(
      'Claude Code is signed in with a Console API key or another provider. This prototype requires Claude account sign-in; existing CLI credentials were left unchanged.',
    );
  }
  return new Error('Sign in to your Claude account through Claude Code before using this provider.');
}

function requireProvider(provider, expected) {
  if (expected && provider !== expected) throw new Error('Invalid provider for this connection action.');
  if (!isProvider(provider)) {
    const labels = Object.values(PROVIDERS)
      .map(({ label }) => label)
      .join(' or ');
    throw new Error(`Choose ${labels} before continuing.`);
  }
}

async function analyze(request) {
  if (activeController) throw new Error('An analysis is already running.');
  const { tabs, provider, modelId, reasoningEffort = 'default' } = request || {};
  if (!Array.isArray(tabs) || tabs.length < 2 || tabs.length > MAX_TABS) {
    throw new Error(`Analyze between 2 and ${MAX_TABS} tabs at a time.`);
  }
  requireProvider(provider);
  if (
    typeof modelId !== 'string' ||
    modelId.length < 1 ||
    modelId.length > 200 ||
    Array.from(modelId).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    throw new Error('Choose a model before analyzing tabs.');
  }
  if (typeof reasoningEffort !== 'string' || reasoningEffort.length > 32) {
    throw new Error('Choose a valid reasoning setting before analyzing tabs.');
  }
  if (provider === 'codex' && reasoningEffort !== 'default' && !OPENAI_EFFORTS.has(reasoningEffort)) {
    throw new Error('That reasoning setting is not supported by Codex. Refresh the model catalog.');
  }
  if (provider === 'anthropic' && !CLAUDE_EFFORTS.has(reasoningEffort)) {
    throw new Error('That effort setting is not supported by Claude Code. Refresh the model options.');
  }
  if (provider === 'anthropic' && !CLAUDE_MODELS.some((model) => model.id === modelId)) {
    throw new Error('Choose a Claude Code model from the available options.');
  }
  const snapshot = tabs.map(validateTab);
  const tabByModelId = new Map(snapshot.map((tab) => [tab.id, tab]));
  const modelTabs = snapshot.map((tab) => ({
    id: tab.id,
    title: tab.title,
    url: tab.url.slice(0, 2048),
    pinned: tab.pinned,
    group: tab.group,
  }));
  const serializedTabs = JSON.stringify(modelTabs).replaceAll('<', '\\u003c');
  const controller = new AbortController();
  activeController = controller;
  activeAnalysisId = request.id;
  const started = performance.now();
  try {
    const claudePath = provider === 'anthropic' ? await ensureClaudeConnection(controller.signal) : undefined;
    controller.signal.throwIfAborted();
    const authMs = performance.now() - started;
    const input = `Analyze only this JSON tab metadata array. Return JSON and nothing else.\n<tab_metadata_json>\n${serializedTabs}\n</tab_metadata_json>`;
    const requestStarted = performance.now();
    let firstTextMs;
    let firstGroupMs;
    const groupStream = createGroupStream();
    const partialGroups = [];
    let shownGroups = 0;
    const onText = (delta) => {
      if (controller.signal.aborted) return;
      if (delta.length && firstTextMs === undefined) firstTextMs = performance.now() - requestStarted;
      const completed = groupStream.push(delta);
      if (!completed.length || partialGroups.length >= 20) return;
      partialGroups.push(...completed.slice(0, 20 - partialGroups.length));
      const preview = validateProposal({ groups: partialGroups, closeCandidates: [] }, tabByModelId);
      if (preview.groups.length <= shownGroups) return;
      shownGroups = preview.groups.length;
      firstGroupMs ??= performance.now() - started;
      send({ id: request.id, event: NativeHostEvent.progress, data: { groups: preview.groups } });
    };
    let responseText;
    if (provider === 'codex') {
      const { requestOptions } = buildStreamRequest(
        { slug: modelId },
        {
          signal: controller.signal,
          reasoningEffort: reasoningEffort === 'default' ? undefined : reasoningEffort,
          instructions: PROPOSAL_INSTRUCTIONS,
          onDelta: onText,
          // The pinned SDK sets store: false in the Responses API request.
          input,
        },
      );
      const response = await chatgpt.streamResponse(requestOptions);
      responseText = response.text;
    } else {
      responseText = await requestClaudeCodeAnalysis({
        claudePath,
        modelId,
        reasoningEffort,
        input,
        signal: controller.signal,
        onText,
      });
    }
    const requestMs = performance.now() - requestStarted;
    const validationStarted = performance.now();
    let responseValue;
    try {
      responseValue = JSON.parse(responseText);
    } catch (error) {
      throw new Error(
        `${providerName(provider)} returned an incomplete proposal. Retry analysis; no browser changes were made.`,
        {
          cause: error,
        },
      );
    }
    const plan = validateProposal(responseValue, tabByModelId);
    return {
      ...plan,
      provider,
      modelName: modelId,
      ...(reasoningEffort !== 'default' ? { reasoningEffort } : {}),
      tabsAnalyzed: snapshot.length,
      latencyMs: performance.now() - started,
      optimizationStep: 4,
      hostReused: completedRequests > 0,
      timings: {
        authMs,
        requestMs,
        validationMs: performance.now() - validationStarted,
        ...(firstTextMs !== undefined ? { firstTextMs } : {}),
        ...(firstGroupMs !== undefined ? { firstGroupMs } : {}),
      },
      outputCharacters: responseText.length,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Analysis cancelled. No tabs were changed.', { cause: error });
    throw error;
  } finally {
    activeController = undefined;
    activeAnalysisId = undefined;
  }
}

async function ensureClaudeConnection(signal) {
  const runtime = await getClaudeRuntime();
  if (!runtime) throw claudeConnectionError('not_installed');
  const session = await claudeSession(runtime, signal);
  if (session.status !== 'connected') throw claudeConnectionError(session.status);
  return runtime.claudePath;
}

function requestClaudeCodeAnalysis({ claudePath, modelId, reasoningEffort, input, signal, onText }) {
  const args = [
    '--print',
    '--output-format',
    'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--no-session-persistence',
    '--max-turns',
    '1',
    '--safe-mode',
    '--tools',
    '',
    '--disallowedTools',
    'mcp__*',
    '--model',
    modelId,
  ];
  if (reasoningEffort !== 'default') args.push('--effort', reasoningEffort);
  args.push('--system-prompt', PROPOSAL_INSTRUCTIONS, 'Analyze the browser tab metadata supplied on standard input.');

  return new Promise((resolve, reject) => {
    const child = spawn(claudePath, args, {
      cwd: APP_SUPPORT_DIRECTORY,
      env: {
        ...process.env,
        PATH: [dirname(process.execPath), process.env.PATH || '/usr/bin:/bin'].join(':'),
        CLAUDE_CODE_SKIP_PROMPT_HISTORY: '1',
      },
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const stream = createClaudeStream(onText);
    child.stdout.setEncoding('utf8');
    let outputBytes = 0;
    let settled = false;
    let timedOut = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve(value);
    };
    const terminate = () => {
      child.kill('SIGTERM');
      const forceKill = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 2_000);
      forceKill.unref();
    };
    const abort = () => {
      terminate();
      finish(new Error('Analysis cancelled. No tabs were changed.'));
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
      finish(new Error('Claude Code took too long to respond. Retry when the CLI or network is available.'));
    }, CLAUDE_PROCESS_TIMEOUT_MS);

    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      outputBytes += Buffer.byteLength(chunk, 'utf8');
      if (outputBytes > 8 * 1024 * 1024) {
        terminate();
        finish(new Error('Claude Code returned too much output. Retry the tab analysis.'));
        return;
      }
      try {
        stream.push(chunk);
      } catch (error) {
        terminate();
        finish(error);
      }
    });
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      finish(
        new Error(
          error.code === 'ENOENT'
            ? 'Claude Code could not be started. Rerun the prototype setup and check the CLI installation.'
            : 'Claude Code could not be started. Check the local CLI installation.',
        ),
      );
    });
    child.on('close', (code) => {
      if (settled) return;
      if (timedOut) {
        finish(new Error('Claude Code took too long to respond. Retry when the CLI or network is available.'));
        return;
      }
      if (code !== 0) {
        finish(
          new Error(
            'Claude Code could not complete the request. Check sign-in, model access, and subscription usage, then retry.',
          ),
        );
        return;
      }
      try {
        finish(undefined, stream.finish());
      } catch (error) {
        finish(error);
      }
    });
    child.stdin.end(input);
  });
}

function providerName(provider) {
  return provider === 'anthropic' ? 'Claude Code' : 'Codex';
}

function validateTab(tab) {
  if (
    !tab ||
    !Number.isSafeInteger(tab.id) ||
    typeof tab.title !== 'string' ||
    typeof tab.url !== 'string' ||
    typeof tab.pinned !== 'boolean' ||
    typeof tab.group !== 'string'
  ) {
    throw new Error('Invalid tab metadata. Analyze the tabs again.');
  }
  return {
    id: tab.id,
    title: tab.title.slice(0, 300),
    url: tab.url,
    pinned: tab.pinned,
    group: tab.group.slice(0, 80),
  };
}

function safeSession(session) {
  return {
    status: session.status,
    sharing: session.sharing,
    ...(session.identity?.email ? { identity: { email: session.identity.email } } : {}),
    ...(session.profileLabel ? { profileLabel: session.profileLabel } : {}),
  };
}

function safeMessage(error) {
  if (error?.code === 'cancelled') return 'Analysis cancelled. No tabs were changed.';
  if (
    error?.code === 'subscription_sharing_usage_limit_exceeded' ||
    error?.code === 'subscription_sharing_usage_unavailable'
  )
    return 'ChatGPT plan usage limit reached or unavailable. Wait for the limit to reset or try again later.';
  if (error?.code === 'network_error' || error?.code === 'stream_interrupted')
    return 'Could not finish the request. Check your connection and try again.';
  if (error?.code === 'sign_in_required') return 'Connect ChatGPT before analyzing tabs.';
  if (error?.code === 'sharing_not_enabled') return 'Reconnect ChatGPT and enable plan usage before analyzing tabs.';
  return typeof error?.message === 'string' && error.message.length < 300
    ? error.message
    : 'The local AI request failed. Check the connection and try again.';
}

function send(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  if (body.length > 1024 * 1024) {
    process.stderr.write("Refusing native-message response larger than Chrome's 1 MiB response limit.\n");
    return process.exit(1);
  }
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

async function getEncryptionKey() {
  if (encryptionKey) return encryptionKey;
  const security = '/usr/bin/security';
  try {
    const stored = execFileSync(
      security,
      ['find-generic-password', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const key = Buffer.from(stored, 'base64url');
    if (key.length === 32) return (encryptionKey = key);
    throw new Error('Invalid prototype Keychain key.');
  } catch (error) {
    if (error.message === 'Invalid prototype Keychain key.') throw error;
    if (error.status !== 44)
      throw new Error('Could not read the macOS Keychain. Unlock it and try connecting again.', {
        cause: error,
      });
    const key = randomBytes(32);
    const encoded = key.toString('base64url');
    try {
      execFileSync(security, ['add-generic-password', '-U', '-a', KEYCHAIN_ACCOUNT, '-s', KEYCHAIN_SERVICE, '-w'], {
        input: `${encoded}\n${encoded}\n`,
        stdio: ['pipe', 'ignore', 'ignore'],
      });
    } catch (error) {
      throw new Error('Could not save the encryption key in macOS Keychain. Unlock it and try again.', {
        cause: error,
      });
    }
    return (encryptionKey = key);
  }
}
