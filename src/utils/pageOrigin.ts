export const getHttpOrigin = (url?: string): string | null => {
  if (!url) {
    return null;
  }

  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
};

export const isScriptableHttpUrl = (url?: string): boolean => {
  const origin = getHttpOrigin(url);

  if (!origin) {
    return false;
  }

  try {
    const parsed = new URL(url!);

    if (parsed.hostname === 'chromewebstore.google.com') {
      return false;
    }

    if (parsed.hostname === 'chrome.google.com' && parsed.pathname.startsWith('/webstore')) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
};
