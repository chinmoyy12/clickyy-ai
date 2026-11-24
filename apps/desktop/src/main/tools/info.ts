import { z } from 'zod';
import { defineTool, type ToolDef } from './types';

/**
 * Information without an API key: news headlines (Google News RSS) and encyclopedia answers (Wikipedia's
 * public REST API). Everything fetched is untrusted data: only plain text is kept, markup is stripped,
 * and nothing in it is ever treated as an instruction.
 */

const decode = (s: string) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/<[^>]*>/g, '')
  .replace(/[\u0000-\u001f]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

/** Headlines from an RSS feed: title and source, at most `max`. */
export function parseRss(xml: string, max = 5): Array<{ title: string; source: string }> {
  const out: Array<{ title: string; source: string }> = [];
  for (const m of xml.slice(0, 2_000_000).matchAll(/<item\b[\s\S]*?<\/item>/g)) {
    const item = m[0];
    let title = decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '');
    let source = decode(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? '');
    // Google News appends " - Source" to the title.
    const dash = title.lastIndexOf(' - ');
    if (dash > 10 && title.length - dash < 50) { source ||= title.slice(dash + 3); title = title.slice(0, dash); }
    if (title) out.push({ title: title.slice(0, 200), source: source.slice(0, 60) });
    if (out.length >= max) break;
  }
  return out;
}

/** First sentences of an encyclopedia extract, short enough to speak. */
export function speakableSummary(extract: string, maxChars = 420): string {
  const text = decode(extract).replace(/\s*\([^()]{0,120}\)/g, ''); // drop pronunciations and dates in brackets
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [text];
  let out = '';
  for (const s of sentences) {
    if ((out + s).length > maxChars && out) break;
    out += s;
  }
  return out.trim();
}

const UA = { 'user-agent': 'ClickyyAI/0.7 (desktop voice assistant)', 'accept-language': 'en' };

export const infoTools: ToolDef[] = [
  defineTool({
    name: 'news.headlines', title: 'News headlines', description: 'Read the latest news headlines, optionally about a topic (e.g. cricket, technology, India, the stock market). From Google News; no account needed.', category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ topic: z.string().trim().max(80).default(''), count: z.number().int().min(1).max(10).default(5) }).strict(), confirm: 'never', timeoutMs: 12000, offline: false,
    describe: ({ topic }) => `Read the latest ${topic ? `${topic} ` : ''}headlines`,
    async run({ topic, count }, ctx) {
      const region = 'hl=en-IN&gl=IN&ceid=IN:en';
      const url = topic ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&${region}` : `https://news.google.com/rss?${region}`;
      const r = await ctx.net(url, { headers: UA, signal: ctx.signal });
      if (!r.ok) return { ok: false, message: `The news service didn't answer (HTTP ${r.status}). Try again in a moment.` };
      const items = parseRss(await r.text(), count);
      if (!items.length) return { ok: false, message: topic ? `I couldn't find recent news about ${topic}.` : "I couldn't load the headlines right now." };
      const spoken = items.map((h, i) => `${i + 1}. ${h.title}${h.source ? `, from ${h.source}` : ''}.`).join(' ');
      return { ok: true, data: { items }, message: `Here are the ${topic ? `${topic} ` : 'top '}headlines. ${spoken}`, detail: items.map((h) => `• ${h.title}${h.source ? ` — ${h.source}` : ''}`).join('\n') };
    },
  }),
  defineTool({
    name: 'knowledge.lookup', title: 'Look it up', description: 'Get a short, factual encyclopedia summary of a person, place, thing or idea from Wikipedia (no account needed). Good for "who is", "what is", "tell me about".', category: 'Knowledge', risk: 1, permission: 'web',
    input: z.object({ query: z.string().trim().min(1).max(120) }).strict(), confirm: 'never', timeoutMs: 12000, offline: false,
    describe: ({ query }) => `Look up ${query}`,
    async run({ query }, ctx) {
      // Find the best-matching article title first, then fetch its summary.
      const s = await ctx.net(`https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=1&namespace=0&search=${encodeURIComponent(query)}`, { headers: UA, signal: ctx.signal });
      if (!s.ok) return { ok: false, message: `The encyclopedia didn't answer (HTTP ${s.status}).` };
      const found = (await s.json()) as [string, string[]];
      const title = found?.[1]?.[0];
      if (!title) return { ok: false, message: `I couldn't find anything about ${query}.` };
      const r = await ctx.net(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`, { headers: UA, signal: ctx.signal });
      if (!r.ok) return { ok: false, message: `I found ${title} but couldn't load its summary.` };
      const body = (await r.json()) as { type?: string; title?: string; extract?: string; content_urls?: { desktop?: { page?: string } } };
      if (body.type === 'disambiguation') return { ok: false, message: `${title} can mean several things. Say a bit more, like the field or country.` };
      const summary = speakableSummary(body.extract ?? '');
      if (!summary) return { ok: false, message: `I couldn't find a summary for ${title}.` };
      return { ok: true, data: { title: body.title ?? title, url: body.content_urls?.desktop?.page }, message: `${summary} That's from Wikipedia.`, detail: body.content_urls?.desktop?.page };
    },
  }),
];
