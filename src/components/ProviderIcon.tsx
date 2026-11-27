import type { CSSProperties } from 'react';
import { getSearchProvider } from '@/utils/searchProviders';
import type { SearchProviderDefinition } from '@/utils/searchProviders';
import { ProviderGlyph } from './ProviderIcon/ProviderGlyph';

export const providerAccentStyle = (provider: SearchProviderDefinition): CSSProperties => {
  return {
    '--provider-accent-light': provider.accent.light,
    '--provider-accent-dark': provider.accent.dark,
  } as CSSProperties;
};

interface ProviderIconProps {
  providerId: string;
  className?: string;
}

export function ProviderIcon({ providerId, className = '' }: ProviderIconProps) {
  const provider = getSearchProvider(providerId);

  if (!provider) {
    return null;
  }

  return (
    <span className={`provider-mark ${className}`.trim()} style={providerAccentStyle(provider)} aria-hidden="true">
      <ProviderGlyph id={provider.iconAsset} label={provider.name} />
    </span>
  );
}
