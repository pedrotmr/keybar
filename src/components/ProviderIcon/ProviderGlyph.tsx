import type { CSSProperties } from 'react';
import googleLogo from '@/assets/provider-icons/google.svg?url&no-inline';
import googleMapsLogo from '@/assets/provider-icons/google-maps.svg?url&no-inline';
import youtubeLogo from '@/assets/provider-icons/youtube.svg?url&no-inline';
import openAiLightLogo from '@/assets/provider-icons/openai-light.svg?url&no-inline';
import openAiDarkLogo from '@/assets/provider-icons/openai-dark.svg?url&no-inline';
import claudeLogo from '@/assets/provider-icons/claude.svg?url&no-inline';
import perplexityLogo from '@/assets/provider-icons/perplexity.svg?url&no-inline';
import xLightLogo from '@/assets/provider-icons/x-light.svg?url&no-inline';
import xDarkLogo from '@/assets/provider-icons/x-dark.svg?url&no-inline';
import type { SearchProviderIconAsset } from '@/utils/searchProviders';

type ThemeLogos = { light: string; dark: string };
type ProviderLogo = string | ThemeLogos | null;

// Yahoo has no entry in SVGL's provider-logo catalog, so it keeps the local Y! wordmark.
const logos: Record<SearchProviderIconAsset, ProviderLogo> = {
  google: googleLogo,
  'google-maps': googleMapsLogo,
  youtube: youtubeLogo,
  openai: { light: openAiLightLogo, dark: openAiDarkLogo },
  claude: claudeLogo,
  perplexity: perplexityLogo,
  x: { light: xLightLogo, dark: xDarkLogo },
  yahoo: null,
};

// Maps' pin is geometrically centered but its pointed tail makes its visual center sit low.
const opticalOffsetY: Partial<Record<SearchProviderIconAsset, string>> = {
  'google-maps': '-12%',
};

interface ProviderGlyphProps {
  id: SearchProviderIconAsset;
}

function ProviderLogoImage({
  src,
  className,
  offsetY,
}: {
  src: string;
  className?: string;
  offsetY?: string;
}) {
  const resourcePath = src.replace(/^\/+/, '');
  const style = offsetY ? ({ '--provider-logo-offset-y': offsetY } as CSSProperties) : undefined;

  return <img src={chrome.runtime.getURL(resourcePath)} className={className} style={style} alt="" draggable={false} />;
}

export function ProviderGlyph({ id }: ProviderGlyphProps) {
  const logo = logos[id];
  const offsetY = opticalOffsetY[id];

  if (typeof logo === 'string') {
    return <ProviderLogoImage src={logo} offsetY={offsetY} />;
  }

  if (logo) {
    return (
      <>
        <ProviderLogoImage src={logo.light} className="provider-logo-light" offsetY={offsetY} />
        <ProviderLogoImage src={logo.dark} className="provider-logo-dark" offsetY={offsetY} />
      </>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <text
        x="12"
        y="17.6"
        fill="var(--provider-accent)"
        fontFamily="Arial, Helvetica, sans-serif"
        fontSize="15.5"
        fontWeight="800"
        textAnchor="middle"
        letterSpacing="-1"
      >
        Y!
      </text>
    </svg>
  );
}
