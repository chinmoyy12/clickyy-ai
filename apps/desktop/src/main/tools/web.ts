import { z } from 'zod';
import { defineTool, type ToolDef } from './types';
import { searchUrl, validateWebUrl } from '../security/url';

export const webTools: ToolDef[] = [
  defineTool({
    name: 'web.open', title: 'Open website', description: 'Open an http(s) website in the default browser.', category: 'Web', risk: 1, permission: 'web',
    input: z.object({ url: z.string().trim().min(3).max(2048) }).strict(), confirm: 'never', timeoutMs: 5000, offline: false,
    describe: ({ url }) => `Open ${url} in your browser`,
    async run({ url }, ctx) {
      const u = validateWebUrl(url);
      await ctx.platform.openExternal(u.toString());
      return { ok: true, data: { url: u.toString() }, message: `Opening ${u.hostname.replace(/^www\./, '')}.` };
    },
  }),
  defineTool({
    name: 'web.search', title: 'Web search', description: 'Open a web search for a query in the default browser using the configured search engine.', category: 'Web', risk: 1, permission: 'web',
    input: z.object({ query: z.string().trim().min(1).max(300) }).strict(), confirm: 'never', timeoutMs: 5000, offline: false,
    describe: ({ query }) => `Search the web for "${query}"`,
    async run({ query }, ctx) {
      const url = searchUrl(ctx.settings.tools.searchEngine, query);
      await ctx.platform.openExternal(url);
      return { ok: true, data: { url }, message: `Searching for ${query}.` };
    },
  }),
];
