#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionId = process.argv[2];
if (!/^[a-p]{32}$/.test(extensionId || '')) {
  process.stderr.write('Usage: node install-host.mjs <32-character Chrome extension ID>\n');
  process.exit(2);
}
if (process.platform !== 'darwin') {
  process.stderr.write("The prototype's Keychain credential encryption currently supports macOS only.\n");
  process.exit(2);
}

const projectDirectory = dirname(fileURLToPath(import.meta.url));
const hostPath = resolve(projectDirectory, 'native/host.mjs');
const appSupportDirectory = resolve(homedir(), 'Library/Application Support/Keybar Tab Organizer Prototype');
const launcherPath = resolve(appSupportDirectory, 'native-host.sh');
const runtimeConfigPath = resolve(appSupportDirectory, 'codex-runtime.json');
const claudeLoginPath = resolve(appSupportDirectory, 'claude-login.command');
const shellQuote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function resolveInstalledCliPath(command, { required = false } = {}) {
  const cliName = command === 'codex' ? 'Codex' : 'Claude Code';
  const unavailable = (message) => {
    if (required) throw new Error(message);
    return undefined;
  };
  let cliPath;
  try {
    cliPath = execFileSync('/usr/bin/which', [command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return unavailable(
      `Install the ${cliName} CLI and make \`${command}\` available in PATH before registering this prototype.`,
    );
  }
  if (!cliPath.startsWith('/')) {
    return unavailable(`The ${cliName} CLI path could not be resolved.`);
  }

  if (cliPath.includes('/.asdf/shims/')) {
    try {
      const asdfPath = execFileSync('/usr/bin/which', ['asdf'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (!asdfPath.startsWith('/')) {
        return unavailable(
          `Could not resolve ${cliName} through asdf. Run \`asdf which ${command}\` successfully, then register again.`,
        );
      }
      const installed = execFileSync(asdfPath, ['which', command], {
        encoding: 'utf8',
        env: process.env,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (installed.startsWith('/') && existsSync(installed)) cliPath = installed;
      else {
        return unavailable(
          `Could not resolve ${cliName} through asdf. Run \`asdf which ${command}\` successfully, then register again.`,
        );
      }
    } catch {
      return unavailable(
        `Could not resolve ${cliName} through asdf. Run \`asdf which ${command}\` successfully, then register again.`,
      );
    }
  }
  return existsSync(cliPath) ? cliPath : unavailable(`The ${cliName} CLI path does not exist.`);
}

let codexPath;
try {
  codexPath = resolveInstalledCliPath('codex', { required: true });
} catch (error) {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
}
const claudePath = resolveInstalledCliPath('claude');

const manifest = {
  name: 'com.keybar.tab_organizer',
  description: 'Keybar AI tab organizer local companion (prototype)',
  path: launcherPath,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`],
};
const manifestPath = resolve(
  homedir(),
  'Library/Application Support/Google/Chrome/NativeMessagingHosts/com.keybar.tab_organizer.json',
);
await mkdir(dirname(manifestPath), { recursive: true });
await mkdir(appSupportDirectory, { recursive: true, mode: 0o700 });
await writeFile(launcherPath, `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(hostPath)} "$@"\n`, {
  mode: 0o700,
});
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
await writeFile(runtimeConfigPath, `${JSON.stringify({ codexPath, claudePath: claudePath || null }, null, 2)}\n`, {
  mode: 0o600,
});
if (claudePath) {
  const loginScript = [
    '#!/bin/zsh',
    `${shellQuote(claudePath)} auth login`,
    'login_status=$?',
    'if [[ $login_status -eq 0 ]]; then',
    '  print "\\nClaude Code sign-in finished. Return to the prototype and reopen its popup."',
    'else',
    '  print "\\nClaude Code sign-in did not finish. Review the message above and try again."',
    'fi',
    'read -r "?Press Return to close this window..."',
    '',
  ].join('\n');
  await writeFile(claudeLoginPath, loginScript, { mode: 0o700 });
  await chmod(claudeLoginPath, 0o700);
}
await Promise.all([chmod(launcherPath, 0o700), chmod(manifestPath, 0o600), chmod(runtimeConfigPath, 0o600)]);
process.stdout.write(`Registered local host: ${manifestPath}\n`);
process.stdout.write(`Created executable launcher: ${launcherPath}\n`);
process.stdout.write(`Saved provider CLI paths: ${runtimeConfigPath}\n`);
if (claudePath) process.stdout.write(`Created Claude Code sign-in command: ${claudeLoginPath}\n`);
else process.stdout.write('Claude Code CLI was not found; install it and rerun setup to use the Claude provider.\n');
process.stdout.write('Restart Chrome before trying the prototype.\n');
