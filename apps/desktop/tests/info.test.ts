/**
 * 0.7.0 knowledge without an API key: news headlines (Google News RSS) and spoken Wikipedia answers.
 */
import { describe, expect, it } from 'vitest';
import { setup } from './helpers';
import { route } from '../src/main/assistant/router';
import { parseRss, speakableSummary } from '../src/main/tools/info';

const res = (t: string) => { const r = route(t, { session: {}, apps: [] }); return r.kind === 'commands' ? r.steps[0].resolution : null; };

describe('news headlines', () => {
  it('routes the ways people ask for news', () => {
    for (const t of ["what's the news", 'news', 'read me the headlines', 'top headlines', "today's news", "what's happening in the world", 'any news today'])
      expect(res(t), t).toEqual({ kind: 'tool', tool: 'news.headlines', args: {} });
    expect(res('news about cricket')).toEqual({ kind: 'tool', tool: 'news.headlines', args: { topic: 'cricket' } });
    expect(res('latest technology news')).toEqual({ kind: 'tool', tool: 'news.headlines', args: { topic: 'technology' } });
    expect(res("what's the latest news on the stock market")).toEqual({ kind: 'tool', tool: 'news.headlines', args: { topic: 'stock market' } });
  });
  it('leaves other sentences that mention news alone', () => {
    for (const t of ['how do newspapers make money', 'write a news article about my school', 'open news app']) expect(res(t)?.kind === 'tool' && (res(t) as { tool: string }).tool === 'news.headlines', t).toBe(false);
  });
  it('reads plain-text titles and strips markup from untrusted feeds', () => {
    const items = parseRss('<item><title><![CDATA[A big story <b>today</b> - Source One]]></title></item><item><title>Second &amp; last</title><source>Two</source></item>');
    expect(items).toEqual([{ title: 'A big story today', source: 'Source One' }, { title: 'Second & last', source: 'Two' }]);
    expect(parseRss('<rss></rss>')).toEqual([]);
  });
  it('speaks the top headlines with sources', async () => {
    const s = await setup();
    const r = await s.executor.execute('news.headlines', {}, s.ctx(), { origin: 'user_command' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Here are the top headlines\. 1\. Monsoon arrives early across Kerala this year, from The Hindu\. 2\. Markets close higher as tech stocks rally & rupee steadies, from Mint\./);
    expect(r.message).not.toMatch(/<script>/);
  });
  it('says so when a topic has no news', async () => {
    const s = await setup();
    const r = await s.executor.execute('news.headlines', { topic: 'zzznothing' }, s.ctx(), { origin: 'user_command' });
    expect(r.ok).toBe(false);
    expect(r.message).toBe("I couldn't find recent news about zzznothing.");
  });
});

describe('wikipedia answers', () => {
  it('routes explicit Wikipedia questions, and keeps "look up X on wikipedia" as a site search', () => {
    expect(res('what does wikipedia say about black holes')).toEqual({ kind: 'tool', tool: 'knowledge.lookup', args: { query: 'black holes' } });
    expect(res('tell me about the eiffel tower from wikipedia')).toEqual({ kind: 'tool', tool: 'knowledge.lookup', args: { query: 'the eiffel tower' } });
    expect(res('wikipedia summary of albert einstein')).toEqual({ kind: 'tool', tool: 'knowledge.lookup', args: { query: 'albert einstein' } });
    expect(res('according to wikipedia who is ada lovelace')).toEqual({ kind: 'tool', tool: 'knowledge.lookup', args: { query: 'ada lovelace' } });
    expect(res('look up black holes on wikipedia')).toMatchObject({ kind: 'tool', tool: 'web.search_site' });
  });
  it('trims a summary to a few speakable sentences without bracketed dates', () => {
    const t = speakableSummary('Paris (French pronunciation: [paʁi]) is the capital of France. It has 2 million people. '.repeat(10), 120);
    expect(t).toBe('Paris is the capital of France. It has 2 million people. Paris is the capital of France. It has 2 million people.');
  });
  it('speaks a short answer and credits Wikipedia', async () => {
    const s = await setup();
    const r = await s.executor.execute('knowledge.lookup', { query: 'ada lovelace' }, s.ctx(), { origin: 'user_command' });
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Augusta Ada King, Countess of Lovelace was an English mathematician and writer\./);
    expect(r.message).toMatch(/That's from Wikipedia\.$/);
    expect(r.message.length).toBeLessThan(480);
  });
  it('handles unknown and ambiguous topics honestly', async () => {
    const s = await setup();
    expect((await s.executor.execute('knowledge.lookup', { query: 'Nowhereland' }, s.ctx(), { origin: 'user_command' })).message).toBe("I couldn't find anything about Nowhereland.");
    expect((await s.executor.execute('knowledge.lookup', { query: 'Mercury' }, s.ctx(), { origin: 'user_command' })).message).toMatch(/can mean several things/);
  });
});
