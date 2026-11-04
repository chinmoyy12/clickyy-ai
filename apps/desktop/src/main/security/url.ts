/** URL validation for anything Clickyy opens or fetches. */

export class UrlRejected extends Error {}

const BLOCKED_HOSTS = new Set(['0.0.0.0']);

/** Only http(s), no credentials in the URL, sane length. Bare domains get https://. */
export function validateWebUrl(raw: string): URL {
  const text = raw.trim();
  if (!text || text.length > 2048) throw new UrlRejected('URL is empty or too long');
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new UrlRejected('That does not look like a valid web address');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new UrlRejected(`Scheme ${url.protocol} is not allowed`);
  if (url.username || url.password) throw new UrlRejected('URLs with embedded credentials are not allowed');
  if (!url.hostname || BLOCKED_HOSTS.has(url.hostname)) throw new UrlRejected('Invalid host');
  if (!/^[a-z0-9.-]+$|^\[[0-9a-f:]+\]$/i.test(url.hostname)) throw new UrlRejected('Invalid host');
  if (!url.hostname.includes('.') && url.hostname !== 'localhost' && !url.hostname.startsWith('[')) {
    throw new UrlRejected('Host must be a full domain name');
  }
  return url;
}

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '::1' || /^127(?:\.\d{1,3}){3}$/.test(h);
}

const SETTINGS_PAGES: Record<string, string> = {
  home: 'ms-settings:',
  display: 'ms-settings:display',
  sound: 'ms-settings:sound',
  bluetooth: 'ms-settings:bluetooth',
  wifi: 'ms-settings:network-wifi',
  network: 'ms-settings:network-status',
  battery: 'ms-settings:batterysaver',
  power: 'ms-settings:powersleep',
  notifications: 'ms-settings:notifications',
  apps: 'ms-settings:appsfeatures',
  startup: 'ms-settings:startupapps',
  privacy: 'ms-settings:privacy',
  microphone: 'ms-settings:privacy-microphone',
  updates: 'ms-settings:windowsupdate',
  accessibility: 'ms-settings:easeofaccess',
  personalization: 'ms-settings:personalization',
  storage: 'ms-settings:storagesense',
  mouse: 'ms-settings:mousetouchpad',
  keyboard: 'ms-settings:keyboard',
  date: 'ms-settings:dateandtime',
  language: 'ms-settings:regionlanguage',
  defaultapps: 'ms-settings:defaultapps',
  focus: 'ms-settings:quiethours',
};

export const SETTINGS_PAGE_IDS = Object.keys(SETTINGS_PAGES);

/** Maps an allowlisted page id to its documented ms-settings: URI. */
export function settingsUri(page: string): string {
  const uri = SETTINGS_PAGES[page];
  if (!uri) throw new UrlRejected(`Unknown settings page ${page}`);
  return uri;
}

export function searchUrl(engine: 'duckduckgo' | 'bing' | 'google', query: string): string {
  const q = encodeURIComponent(query.trim().slice(0, 300));
  switch (engine) {
    case 'bing': return `https://www.bing.com/search?q=${q}`;
    case 'google': return `https://www.google.com/search?q=${q}`;
    default: return `https://duckduckgo.com/?q=${q}`;
  }
}
