export const PopupMessage = Object.freeze({
  connect: 'connect',
  disconnect: 'disconnect',
  connectClaude: 'connect-claude',
  loadSample: 'load-sample',
  analyze: 'analyze',
  cancelAnalysis: 'cancel-analysis',
  apply: 'apply',
  reopen: 'reopen',
  session: 'session',
  catalog: 'catalog',
  saveSettings: 'save-settings',
  getSettings: 'get-settings',
  hasReopenableTabs: 'has-reopenable-tabs',
  analysisProgress: 'analysis-progress',
});

export const NativeHostAction = Object.freeze({
  session: 'session',
  signIn: 'sign-in',
  claudeLogin: 'claude-login',
  disconnect: 'disconnect',
  catalog: 'catalog',
  analyze: 'analyze',
  cancelAnalysis: 'cancel-analysis',
});

export const NativeHostEvent = Object.freeze({ progress: 'progress' });
