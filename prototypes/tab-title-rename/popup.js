const nameInput = document.querySelector('#custom-name');
const status = document.querySelector('#status');
const tabIdParameter = new URLSearchParams(location.search).get('tabId');
const targetTabPromise = tabIdParameter
  ? chrome.tabs.get(Number(tabIdParameter))
  : chrome.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => tab);

document.querySelector('#apply').addEventListener('click', async () => {
  const tab = await targetTabPromise;

  if (tab?.id === undefined) {
    status.textContent = 'No regular tab is available.';
    return;
  }

  const url = new URL(tab.url);

  if (!isScriptableUrl(url)) {
    status.textContent = 'Chrome does not allow access to this page.';
    return;
  }

  const origin = `${url.origin}/*`;
  let granted;

  try {
    granted = await chrome.permissions.request({ origins: [origin] });
  } catch {
    status.textContent = 'Could not request site access.';
    return;
  }

  if (!granted) {
    status.textContent = 'Site access was not granted.';
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({
      action: 'title:apply',
      tabId: tab.id,
      customName: nameInput.value,
      expectedOrigin: url.origin,
    });
    status.textContent = result.success ? 'Custom title applied.' : 'Could not apply the title.';
  } catch {
    status.textContent = 'Could not apply the title.';
  }
});

document.querySelector('#restore').addEventListener('click', async () => {
  const tab = await targetTabPromise;

  if (tab?.id === undefined) {
    status.textContent = 'No regular tab is available.';
    return;
  }

  try {
    const result = await chrome.runtime.sendMessage({ action: 'title:restore', tabId: tab.id });
    status.textContent = result.success ? 'Original title restored.' : 'No active custom title on this page.';
  } catch {
    status.textContent = 'Could not restore the page title.';
  }
});

function isScriptableUrl(url) {
  if (!['http:', 'https:'].includes(url.protocol)) return false;
  if (url.hostname === 'chromewebstore.google.com') return false;
  return url.hostname !== 'chrome.google.com' || !url.pathname.startsWith('/webstore');
}
