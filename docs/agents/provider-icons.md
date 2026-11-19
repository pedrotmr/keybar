# Provider Icons

## Rule for new providers

Every search provider must declare an `iconAsset` in `src/utils/searchProviders.ts` and have a matching entry in the typed logo map in `src/components/ProviderIcon/ProviderGlyph.tsx`.

Use the provider's SVG from [SVGL](https://svgl.app/) when one is listed. Bundle the SVG locally under `src/assets/provider-icons/`; do not load logos from SVGL at runtime. When SVGL offers separate light and dark assets, register both and select them with the existing appearance theme. Add the exact SVGL asset URL to the source list below.

All provider logos use the shared icon slot in `global.css`. It centers the SVG, fits it within the slot while preserving its aspect ratio, and leaves an inset around it. The right-side typing hint uses the full 14px slot to preserve room for its label. Keep the source SVG's viewBox and use the shared fit for new providers.

If SVGL has no matching logo, use a neutral fallback or a clearly documented local mark. Do not draw a lookalike brand logo and present it as the official mark.

## Current assets

| Provider    | Bundled asset                         | SVGL source                                                                                                        |
| ----------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Google      | `google.svg`                          | [`google.svg`](https://svgl.app/library/google.svg)                                                                |
| Google Maps | `google-maps.svg`                     | [`googleMaps.svg`](https://svgl.app/library/googleMaps.svg)                                                        |
| YouTube     | `youtube.svg`                         | [`youtube.svg`](https://svgl.app/library/youtube.svg)                                                              |
| ChatGPT     | `openai-light.svg`, `openai-dark.svg` | [`openai.svg`](https://svgl.app/library/openai.svg), [`openai_dark.svg`](https://svgl.app/library/openai_dark.svg) |
| Claude      | `claude.svg`                          | [`claude-ai-icon.svg`](https://svgl.app/library/claude-ai-icon.svg)                                                |
| Perplexity  | `perplexity.svg`                      | [`perplexity.svg`](https://svgl.app/library/perplexity.svg)                                                        |
| X           | `x-light.svg`, `x-dark.svg`           | [`x.svg`](https://svgl.app/library/x.svg), [`x_dark.svg`](https://svgl.app/library/x_dark.svg)                     |
| Yahoo       | Local `Y!` fallback                   | No Yahoo entry was returned by the SVGL search API on 2026-11-19.                                                  |
