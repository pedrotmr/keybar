const defaultReasoningChoices = [
  { value: 'default', label: 'Provider default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'Extra high' },
  { value: 'max', label: 'Max' },
];

export const PROVIDERS = Object.freeze({
  codex: { label: 'Codex', defaultModelMatches: ['gpt-6-luna', 'luna'] },
  anthropic: { label: 'Claude Code', defaultModelMatches: ['haiku'] },
});

export const OPENAI_REASONING_EFFORTS = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
export const CLAUDE_REASONING_EFFORTS = Object.freeze(['default', 'low', 'medium', 'high', 'xhigh', 'max']);

export const CLAUDE_MODELS = Object.freeze(
  ['haiku', 'sonnet', 'opus', 'fable'].map((id) => ({
    id,
    displayName: `Claude ${id[0].toUpperCase()}${id.slice(1)}`,
    reasoningEfforts: defaultReasoningChoices,
    defaultReasoningEffort: 'low',
  })),
);

export const isProvider = (value) => typeof value === 'string' && Object.hasOwn(PROVIDERS, value);

export const chooseDefaultModel = (models, provider) => {
  const matches = PROVIDERS[provider]?.defaultModelMatches ?? [];
  const searchable = (model) => `${model.id} ${model.displayName}`.toLowerCase();
  for (const match of matches) {
    const exact = models.find((model) => model.id.toLowerCase() === match);
    if (exact) return exact;
    const partial = models.find((model) => searchable(model).includes(match));
    if (partial) return partial;
  }
  return models[0];
};

export const normalizeProviderSelection = (value) => ({
  modelId: typeof value?.modelId === 'string' ? value.modelId.slice(0, 200) : '',
  reasoningEffort: typeof value?.reasoningEffort === 'string' ? value.reasoningEffort.slice(0, 32) : 'default',
});

export const normalizeProviderSettings = (value) => ({
  provider: isProvider(value?.provider) ? value.provider : 'codex',
  selections: {
    codex: normalizeProviderSelection(value?.selections?.codex),
    anthropic: normalizeProviderSelection(value?.selections?.anthropic),
  },
});
