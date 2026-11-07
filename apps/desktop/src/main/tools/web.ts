import { z } from 'zod';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { searchUrl, validateWebUrl } from '../security/url';
import { findSearchSite, SEARCH_SITES, searchSiteUrl } from '../assistant/knowledge/sites';

export const BROWSERS = ['default', 'chrome', 'edge', 'firefox', 'brave', 'opera'] as const;
export type BrowserId = (typeof BROWSERS)[number];

/** Registry app names for each browser (see KNOWN_APPS). */
export const BROWSER_APPS: Record<Exclude<BrowserId, 'default'>, string> = {
  chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera',
};

export const BROWSER_LABEL: Record<BrowserId, string> = { default: 'your default browser', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera' };

/** Browsers that are installed and enabled in the app registry. */
export function installedBrowsers(apps: Array<{ name: string; enabled: boolean; kind: string }>): Array<Exclude<BrowserId, 'default'>> {
  return (Object.keys(BROWSER_APPS) as Array<Exclude<BrowserId, 'default'>>).filter((b) => apps.some((a) => a.enabled && a.kind === 'exe' && a.name === BROWSER_APPS[b]));
}

/** Opens a validated https URL, in a specific browser when asked (and installed), else the default one. */
async function openUrl(url: string, browser: BrowserId | undefined, ctx: ToolContext): Promise<string> {
  if (browser && browser !== 'default') {
    const app = ctx.repos.apps.list().find((a) => a.enabled && a.kind === 'exe' && a.name === BROWSER_APPS[browser]);
    if (app && ctx.platform.fileExists(app.target)) {
      // The URL is validated https and passed as a single argument, never as a flag.
      await ctx.platform.spawnDetached(app.target, [url]);
      return ` in ${BROWSER_LABEL[browser]}`;
    }
    await ctx.platform.openExternal(url);
    return ` in your default browser, because I couldn't find ${BROWSER_LABEL[browser]}`;
  }
  await ctx.platform.openExternal(url);
  return '';
}

const browserField = z.enum(BROWSERS).optional();

export const webTools: ToolDef[] = [
  defineTool({
    name: 'web.open', title: 'Open website', description: 'Open an http(s) website, in the default browser or a specific installed one (chrome, edge, firefox, brave, opera).', category: 'Web', risk: 1, permission: 'web',
    input: z.object({ url: z.string().trim().min(3).max(2048), browser: browserField, label: z.string().trim().max(80).optional() }).strict(), confirm: 'never', timeoutMs: 8000, offline: false,
    describe: ({ url, browser }) => `Open ${url}${browser && browser !== 'default' ? ` in ${BROWSER_LABEL[browser]}` : ''}`,
    async run({ url, browser, label }, ctx) {
      const u = validateWebUrl(url);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, message: 'Only web addresses can be opened.' };
      const where = await openUrl(u.toString(), browser, ctx);
      return { ok: true, data: { url: u.toString(), browser: browser ?? 'default' }, message: `Opening ${label ?? u.hostname.replace(/^www\./, '')}${where}.` };
    },
  }),
  defineTool({
    name: 'web.search', title: 'Web search', description: 'Open a web search for a query in the browser using the configured search engine.', category: 'Web', risk: 1, permission: 'web',
    input: z.object({ query: z.string().trim().min(1).max(300), browser: browserField }).strict(), confirm: 'never', timeoutMs: 8000, offline: false,
    describe: ({ query }) => `Search the web for "${query}"`,
    async run({ query, browser }, ctx) {
      const url = searchUrl(ctx.settings.tools.searchEngine, query);
      const where = await openUrl(url, browser ?? (ctx.settings.tools.browser === 'ask' ? undefined : ctx.settings.tools.browser), ctx);
      return { ok: true, data: { url }, message: `Searching for ${query}${where}.` };
    },
  }),
  defineTool({
    name: 'web.search_site', title: 'Search a website', description: `Search inside a specific website, e.g. YouTube, Amazon, Wikipedia, GitHub, Spotify. Sites: ${SEARCH_SITES.map((s) => s.name).join(', ')}.`, category: 'Web', risk: 1, permission: 'web',
    input: z.object({ site: z.string().trim().min(1).max(40), query: z.string().trim().min(1).max(300), browser: browserField }).strict(), confirm: 'never', timeoutMs: 8000, offline: false,
    describe: ({ site, query }) => `Search ${site} for "${query}"`,
    async run({ site, query, browser }, ctx) {
      const s = findSearchSite(site);
      if (!s) return { ok: false, message: `I can't search inside ${site} directly. I can do a normal web search instead.` };
      const url = searchSiteUrl(s, query);
      validateWebUrl(url);
      const where = await openUrl(url, browser ?? (ctx.settings.tools.browser === 'ask' ? undefined : ctx.settings.tools.browser), ctx);
      return { ok: true, data: { url, site: s.name }, message: `Searching ${s.name} for ${query}${where}.` };
    },
  }),
];
