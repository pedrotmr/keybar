export const ANALYSIS_REQUEST_TIMEOUT_MS = 120_000;
// Leave time for the native host to report a timeout before the extension disconnects.
export const CLAUDE_PROCESS_TIMEOUT_MS = ANALYSIS_REQUEST_TIMEOUT_MS - 10_000;
export const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
export const CLI_LAUNCH_TIMEOUT_MS = 30_000;
