import type { Resolution, RouteCtx } from './catalog';
import { BROWSER_LABEL, type BrowserId } from '../tools/web';

const tool = (t: string, args: Record<string, unknown> = {}): Resolution => ({ kind: 'tool', tool: t, args });
const clarify = (question: string, pending?: Extract<Resolution, { kind: 'clarify' }>['pending']): Resolution => ({ kind: 'clarify', question, pending });

export const orList = (xs: string[]) => (xs.length <= 2 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/**
 * Opens something in a browser. With the preference set to 'ask' and more than one browser
 * installed, it asks which one ("YouTube Music is a website. Chrome or Edge?").
 */
export function inBrowser(toolName: 'web.open' | 'web.search_site', args: Record<string, unknown>, label: string, ctx: RouteCtx, browser?: BrowserId): Resolution {
  if (browser) return tool(toolName, { ...args, browser });
  const pref = ctx.browser ?? 'ask';
  if (pref !== 'ask') return tool(toolName, pref === 'default' ? args : { ...args, browser: pref });
  const list = ctx.browsers ?? [];
  if (list.length < 2) return tool(toolName, args);
  const names = list.map((b) => BROWSER_LABEL[b]);
  const what = toolName === 'web.open' ? `${label} is a website. Should I open it in ${orList(names)}?` : `I'll search ${label} in your browser. ${orList(names)}?`;
  return clarify(`${what} Say "always ${names[0]}" and I'll stop asking.`, { commandId: 'web.browser', slot: 'browser', partial: { tool: toolName, args } });
}

