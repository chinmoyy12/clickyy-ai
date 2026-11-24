import type { AppEntry } from '@shared/types';
import type { Settings } from '@shared/settings';
import type { SessionState } from '../tools/types';
import { findApp } from '../tools/apps';
import { BROWSER_LABEL, type BrowserId } from '../tools/web';
import { CURRENCY_WORDS } from '../tools/extras';
import { parseClockTime, parseDuration } from './normalize';
import { findSearchSite, findSite } from './knowledge/sites';
import { findSettingsPage, findShellFolder, findWinTool } from './knowledge/windows';
import { findZone } from './knowledge/cities';
import { CODE_FIRST, EXTENDED, parseLoan } from './catalog-ext';
import { BLUEPRINT_FIRST, BLUEPRINT_LAST } from './catalog-blueprint';
import { inBrowser, orList } from './browserAsk';

export { inBrowser };

export type Builtin =
  | 'greeting' | 'presence' | 'capabilities' | 'repeat' | 'slower' | 'faster' | 'stop_speaking' | 'cancel'
  | 'new_session' | 'end_conversation' | 'mode' | 'verbosity' | 'status_model' | 'status_offline' | 'status_mic'
  | 'identity' | 'thanks' | 'shortcuts' | 'ui' | 'mic_pause' | 'refuse_shell' | 'how_are_you' | 'continue'
  | 'briefing' | 'system_report' | 'screen' | 'clipboard_ai' | 'clipboard_read'
  | 'open_with_browser' | 'set_browser' | 'always_listen' | 'self_test'
  | 'say' | 'code_task' | 'ai_task' | 'draft_message' | 'battery_alert'
  | 'ai_mode' | 'check_updates' | 'version';

export interface RouteCtx {
  session: SessionState;
  apps: AppEntry[];
  /** Browser preference from settings ('ask' asks when several are installed). */
  browser?: Settings['tools']['browser'];
  /** Installed browsers, e.g. ['chrome', 'edge']. */
  browsers?: Array<Exclude<BrowserId, 'default'>>;
}

export interface PendingSlot { commandId: string; slot: string; partial: Record<string, unknown> }

export type Resolution =
  | { kind: 'tool'; tool: string; args: Record<string, unknown> }
  | { kind: 'builtin'; builtin: Builtin; params?: Record<string, unknown> }
  | { kind: 'clarify'; question: string; pending?: PendingSlot };

export interface CommandDef {
  id: string;
  category: string;
  description: string;
  examples: string[];
  patterns: RegExp[];
  tool?: string;
  resolve(m: RegExpMatchArray, text: string, ctx: RouteCtx): Resolution | null;
  /** Fills a pending slot from a follow-up answer. */
  fill?(answer: string, partial: Record<string, unknown>, ctx: RouteCtx, raw?: string): Resolution | null;
  /** Try fill() before treating the answer as a new command (short answers like "chrome"). */
  fillFirst?: boolean;
  /** Never split this command's utterance on "and"/"then" ("how much RAM and CPU Chrome uses"). */
  atomic?: boolean;
  /** Commands this one already covers: when every split part is one of them, the whole wins ('*' = never split). */
  absorbs?: string[] | '*';
}

const tool = (t: string, args: Record<string, unknown> = {}): Resolution => ({ kind: 'tool', tool: t, args });
const builtin = (b: Builtin, params?: Record<string, unknown>): Resolution => ({ kind: 'builtin', builtin: b, params });
const clarify = (question: string, pending?: PendingSlot): Resolution => ({ kind: 'clarify', question, pending });
const cmd = (def: CommandDef) => def;

const FOLDERS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'workspace'];

const BROWSER_WORD = /\b(google chrome|chrome|microsoft edge|edge|firefox|mozilla|brave|opera)\b/;
const browserId = (word: string): Exclude<BrowserId, 'default'> =>
  /chrome/.test(word) ? 'chrome' : /edge/.test(word) ? 'edge' : /firefox|mozilla/.test(word) ? 'firefox' : /brave/.test(word) ? 'brave' : 'opera';

function openSite(url: string, label: string, ctx: RouteCtx, browser?: BrowserId): Resolution {
  return inBrowser('web.open', { url, label }, label, ctx, browser);
}

const YES = /^(yes|yeah|yep|yup|sure|ok|okay|please|do it|go ahead|search( it| for it)?|sounds good)\b/;
const NO = /^(no|nope|nah|don'?t|never ?mind|cancel)\b/;

function openTarget(target: string, ctx: RouteCtx): Resolution {
  const t = target.replace(/^(up |the |my |a )+/, '').replace(/\s+(app|application|program)$/, '').trim();
  if (!t) return clarify('What should I open?', { commandId: 'apps.open', slot: 'app', partial: {} });
  if (/^(it|that)( again)?$/.test(t)) {
    return ctx.session.lastApp ? tool('apps.open', { app: ctx.session.lastApp.name }) : clarify('Which app do you mean?', { commandId: 'apps.open', slot: 'app', partial: {} });
  }
  if (/^(windows )?settings$/.test(t)) return tool('system.open_settings', { page: 'home' });
  const settings = t.match(/^(?:the )?(.+?) (?:settings?|options)$/);
  const settingsPage = settings && findSettingsPage(settings[1]);
  if (settingsPage) return tool('system.open_settings', { page: settingsPage.id });
  if (/^task manager$/.test(t)) return tool('system.task_manager');
  const folder = t.match(/^(?:(?:my|the) )?(desktop|documents|downloads|pictures|music|videos|workspace|home)(?: folder)?$/);
  if (folder && FOLDERS.concat('home').includes(folder[1]) && !(folder[1] === 'music' && findApp(ctx.apps, 'music', { exactOnly: true }).match)) return tool('system.open_folder', { folder: folder[1] });
  if (/^(my )?project( folder)?$|^(the )?last approved workspace$/.test(t)) return tool('system.open_folder', { folder: 'workspace' });
  if (/^(?:https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(t)) return openSite(t, t.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0], ctx);
  // 1. An installed app with exactly this name. 2. A known website. 3. Windows tools and folders. 4. Close app names.
  const exact = findApp(ctx.apps, t, { exactOnly: true });
  if (exact.match) return tool('apps.open', { app: exact.match.name });
  const site = findSite(t);
  if (site) return openSite(site.url, site.name, ctx);
  const winTool = findWinTool(t);
  if (winTool) return tool('system.open_tool', { tool: winTool.id });
  const shell = findShellFolder(t);
  if (shell) return tool('system.open_special_folder', { folder: shell.id });
  const app = findApp(ctx.apps, t);
  if (app.match) return tool('apps.open', { app: app.match.name });
  if (app.candidates.length > 1) return clarify(`Do you mean ${orList(app.candidates.slice(0, 3).map((a) => a.name))}?`, { commandId: 'apps.open', slot: 'app', partial: {} });
  const page = findSettingsPage(t);
  if (page && page.id !== 'home') return tool('system.open_settings', { page: page.id });
  return clarify(`I couldn't find an app or website called ${t} on this PC. Should I search the web for it?`, { commandId: 'apps.open', slot: 'search', partial: { query: t } });
}

const pct = (s: string | undefined) => (s ? Math.max(0, Math.min(100, parseInt(s, 10))) : undefined);

/**
 * Ordered command catalog. The first matching pattern wins, so specific
 * commands come before generic ones ("open settings" before "open <app>").
 */
export const CATALOG: CommandDef[] = [
  // Code and Excel requests mention "run" or "script" but never execute anything, so they precede the shell filter.
  ...CODE_FIRST,
  // ---------- safety ----------
  cmd({ id: 'safety.refuse_shell', category: 'Safety', description: 'Refuses requests to run arbitrary shell commands or scripts.', examples: ['run powershell command', 'execute this script', 'open cmd and run del'],
    patterns: [/\b(run|execute|exec)\b.*\b(powershell|cmd|command prompt|bash|shell|script|terminal command)\b/, /\b(powershell|cmd)\b.*\b(rm|del|format|remove-item|reg delete)\b/, /\bformat (my )?(c|hard) ?(drive)?\b/, /\bdelete (system ?32|windows)\b/],
    resolve: () => builtin('refuse_shell') }),
  // Narrow blueprint phrases and honest "not connected" answers for smart home, email and calendar.
  ...BLUEPRINT_FIRST,

  // ---------- conversation ----------
  cmd({ id: 'conv.stop', category: 'Conversation', description: 'Stop speaking immediately.', examples: ['stop talking', 'stop', 'quiet', 'be quiet'],
    patterns: [/^(stop|stop talking|stop speaking|quiet|be quiet|shh+|shut up|enough|hush|silence)$/], resolve: () => builtin('stop_speaking') }),
  cmd({ id: 'conv.cancel', category: 'Conversation', description: 'Cancel the current task.', examples: ['cancel that', 'never mind', 'forget it', 'go back'],
    patterns: [/^(cancel|never ?mind|forget it|abort|scratch that|go back)( that| it)?$/, /^(?:stop|cancel|abort|end|kill) (?:the |this |that |my )?(?:current )?(?:task|action|job|operation|agent)$/], resolve: () => builtin('cancel') }),
  cmd({ id: 'conv.greeting', category: 'Conversation', description: 'Greetings.', examples: ['hey clickyy', 'good morning clickyy', 'hello'],
    patterns: [/^(hi|hello|hey|hiya|yo|howdy|good (morning|afternoon|evening|day))( there)?( clickyy)?$/, /^$/], resolve: (m) => builtin('greeting', { when: m[2] }) }),
  cmd({ id: 'conv.presence', category: 'Conversation', description: 'Check that the assistant is listening.', examples: ['are you there', 'can you hear me', 'you there'],
    patterns: [/^(are )?you (there|awake|listening)$/, /^(can you )?hear me$/], resolve: () => builtin('presence') }),
  cmd({ id: 'conv.how_are_you', category: 'Conversation', description: 'Small talk.', examples: ['how are you', "how's it going"],
    patterns: [/^(how are you|hows it going|how are things|how are you doing)( today)?$/], resolve: () => builtin('how_are_you') }),
  cmd({ id: 'conv.thanks', category: 'Conversation', description: 'Acknowledges thanks.', examples: ['thank you', 'thanks', 'nice job'],
    patterns: [/^(thanks?( you)?( so much)?|cheers|nice( job| one)?|good job|great|perfect|awesome|cool)$/], resolve: () => builtin('thanks') }),
  cmd({ id: 'conv.end', category: 'Conversation', description: 'End the conversation and stop follow-up listening.', examples: ["that's all", 'goodbye', 'stop listening'],
    patterns: [/^(that'?s all|that will be all|that'?s it|goodbye|bye( bye)?|we'?re done|go to sleep|stop listening|thanks that'?s all|thank you that'?s all|good night)$/], resolve: () => builtin('end_conversation') }),
  cmd({ id: 'conv.capabilities', category: 'Conversation', description: 'Describe what Clickyy can do.', examples: ['what can you do', 'help', 'what are your commands'],
    patterns: [/what can you (do|help( me)? with)|^help( me)?$|what are your (skills|abilities|commands|features|capabilities)|what commands|how many (things|commands|skills|capabilities|features) (can you|do you)/], resolve: () => builtin('capabilities') }),
  cmd({ id: 'conv.identity', category: 'Conversation', description: 'Who the assistant is (always honest that it is an AI).', examples: ['who are you', 'are you human', "what's your name"],
    patterns: [/^who are you$|what(s| is) your name|are you (a )?(human|real|person|robot|ai|bot)/], resolve: () => builtin('identity') }),
  cmd({ id: 'conv.repeat_slower', category: 'Conversation', description: 'Repeat the last response more slowly.', examples: ['repeat that more slowly', 'say it again slower'],
    patterns: [/^(?:repeat|say) (?:that|it)(?: again)? (?:a (?:little|bit) )?(?:more )?slow(?:ly|er)$/], resolve: () => builtin('repeat', { slower: true }) }),
  cmd({ id: 'conv.repeat', category: 'Conversation', description: 'Repeat the last response.', examples: ['can you repeat that', 'say that again', 'what did you say'],
    patterns: [/^(repeat|say) (that|it)( again)?$|^repeat( yourself)?$|^what did you (just )?say$|^come again$|^pardon$|^repeat the last instruction$/], resolve: () => builtin('repeat') }),
  cmd({ id: 'conv.slower', category: 'Conversation', description: 'Speak more slowly.', examples: ['speak a little slower', 'talk slower'],
    patterns: [/(speak|talk|go)( a)?( little| bit)? (slower|more slowly)|^slow down$/], resolve: () => builtin('slower') }),
  cmd({ id: 'conv.faster', category: 'Conversation', description: 'Speak faster.', examples: ['speak faster', 'talk a bit quicker'],
    patterns: [/(speak|talk|go)( a)?( little| bit)? (faster|quicker)|^speed up$/], resolve: () => builtin('faster') }),
  cmd({ id: 'conv.brief', category: 'Conversation', description: 'Shorter answers.', examples: ['give me the short version', 'be more concise'],
    patterns: [/short version|be (more )?(brief|concise)|shorter answers?|keep it short|tl ?dr/], resolve: () => builtin('verbosity', { level: 'brief' }) }),
  cmd({ id: 'conv.detailed', category: 'Conversation', description: 'More detailed answers.', examples: ['be more detailed', 'explain in more detail'],
    patterns: [/be more detailed|more detail|longer answers?|go deeper/], resolve: () => builtin('verbosity', { level: 'detailed' }) }),
  cmd({ id: 'conv.new', category: 'Conversation', description: 'Start a new conversation.', examples: ["let's start a new conversation", 'clear the chat'],
    patterns: [/(start )?(a )?new (conversation|chat|session|topic)|^(?:change|switch) (?:the )?(?:topic|subject)$|let'?s start (over|fresh|again)|clear (the |this )?(conversation|chat)|reset (the )?conversation/], resolve: () => builtin('new_session') }),
  cmd({ id: 'conv.continue', category: 'Conversation', description: 'Resume the previous conversation.', examples: ["let's continue where we left off"],
    patterns: [/continue where we left off|pick up where we left off|resume (our|the) (last )?conversation/], resolve: () => builtin('continue') }),
  cmd({ id: 'conv.ai_mode', category: 'Conversation', description: 'Response mode: Fast (quick, short answers), Balanced, or Turbo (deeper reasoning).', examples: ['turbo mode', 'switch to fast mode', 'balanced mode', 'think harder', 'what response mode are you in'],
    patterns: [
      /^(?:(?:switch|change|go|set|put) (?:it |yourself )?(?:to |into |in )?|use |turn on |enable |activate |start |lets go |go )?(?:the )?(fast|quick|speed|rapid|balanced|medium|default|turbo|deep|deep thinking|reasoning|thinking) (?:response |answer |reply )?mode(?: on| please| now)?$/,
      /^(?:go|be|answer) (turbo|faster|quick(?:er)?)$/,
      /^(?:think|reason) (harder|deeper|more carefully|step by step)(?: from now on)?$/,
      /^(?:what|which) (?:response |speed |answer )?mode (?:are you|am i|is (?:it|on))(?: in| using)?$/,
    ],
    resolve: (m, text) => {
      if (/^(?:what|which)/.test(text)) return builtin('ai_mode', {});
      const w = m[1];
      const mode = /^(fast|faster|quick|quicker|speed|rapid)$/.test(w) ? 'fast' : /^(balanced|medium|default)$/.test(w) ? 'balanced' : 'turbo';
      return builtin('ai_mode', { mode });
    } }),
  cmd({ id: 'app.update', category: 'Conversation', description: 'Check for a new version of Clickyy and install it.', examples: ['check for updates', 'is there a new version', 'update yourself', 'what version are you'],
    patterns: [
      /^(?:please )?(?:check (?:for )?(?:app |clickyy |new )?(?:updates?|a new version)|(?:is there|are there|any) (?:an? )?(?:new )?(?:updates?|new version|newer version)(?: available| for you| for clickyy)?|update (?:yourself|clickyy|the app|this app)|install (?:the )?(?:latest )?update|are you up to date|get the latest version)$/,
      /^(?:what|which) version (?:are you|of clickyy is this|is this)$|^(?:whats|what is) your version$/,
    ],
    resolve: (_m, text) => builtin(/version (?:are you|of clickyy is this|is this)$|your version$/.test(text) ? 'version' : 'check_updates') }),
  cmd({ id: 'conv.mode', category: 'Conversation', description: 'Switch personality mode.', examples: ["let's switch to work mode", 'playful mode', 'soothing mode'],
    patterns: [/(switch to|let'?s switch to|enable|start|go into|use|activate) (work|focus|professional|playful|fun|casual|calm|soothing|sweet|elegant|energetic|charming|natural|normal) mode/, /^(work|playful|professional|soothing|casual) mode$/],
    resolve: (m) => {
      const word = (m[2] ?? m[1]).trim();
      const map: Record<string, string> = { work: 'professional', focus: 'professional', professional: 'professional', playful: 'playful', fun: 'playful', casual: 'natural', normal: 'natural', natural: 'natural', calm: 'soothing', soothing: 'soothing', sweet: 'sweet', elegant: 'elegant', energetic: 'energetic', charming: 'charming' };
      return builtin('mode', { profile: map[word] ?? 'natural' });
    } }),
  cmd({ id: 'status.model', category: 'Status', description: 'Report the active AI provider and model.', examples: ['which model are you using', 'check the local ai service'],
    patterns: [/which (ai )?model|what (ai )?model|which (ai|llm|provider)|check (the )?local (ai|model)( service)?|is (the )?local (ai|model) (running|ready)/], resolve: () => builtin('status_model') }),
  cmd({ id: 'status.offline', category: 'Status', description: 'Report the offline/online routing mode.', examples: ['are you in offline mode', 'are you online'],
    patterns: [/are you (in )?(offline|online)( mode)?|offline mode\??$|are you using the cloud/], resolve: () => builtin('status_offline') }),
  cmd({ id: 'status.mic', category: 'Status', description: 'Check microphone and speech engine.', examples: ['is the microphone working', 'check my mic'],
    patterns: [/is (the |my )?(microphone|mic) (working|on|ok)|check (the |my )?(microphone|mic)|can you hear me properly/], resolve: () => builtin('status_mic') }),
  cmd({ id: 'ui.shortcuts', category: 'Accessibility', description: 'Show keyboard shortcuts.', examples: ['show me the available keyboard shortcuts'],
    patterns: [/(show|what are|list)( me)?( the)?( available)? (keyboard )?shortcuts/], resolve: () => builtin('shortcuts') }),
  cmd({ id: 'ui.mic_pause', category: 'Accessibility', description: 'Pause voice recognition (mute the microphone).', examples: ['pause voice recognition', 'mute the microphone'],
    patterns: [/pause (voice recognition|listening)|(mute|turn off|disable) (the |your |my )?(microphone|mic)\b(?! access| permissions?| privacy)/], resolve: () => builtin('mic_pause') }),
  cmd({ id: 'ui.motion', category: 'Accessibility', description: 'Reduce or restore animations.', examples: ['reduce animations', 'turn animations back on'],
    patterns: [/(reduce|turn off|disable|less) (the )?(animations?|motion)/, /(turn on|enable|restore) (the )?(animations?|motion)/, /(animations?|motion) back on/],
    resolve: (m, text) => builtin('ui', { setting: 'reducedMotion', value: /reduce|off|disable|less/.test(text) ? 'on' : 'off' }) }),
  cmd({ id: 'ui.contrast', category: 'Accessibility', description: 'Toggle high-contrast mode.', examples: ['switch to high contrast mode', 'turn off high contrast'],
    patterns: [/high[ -]?contrast/], resolve: (_m, text) => builtin('ui', { setting: 'highContrast', value: !/(off|disable|normal)/.test(text) }) }),
  cmd({ id: 'ui.text_size', category: 'Accessibility', description: 'Change text size.', examples: ['increase the text size', 'make the text smaller'],
    patterns: [/(increase|bigger|larger|enlarge|decrease|smaller|reduce) (the )?(text|font)( size)?|(make )?(the )?(text|font) (bigger|larger|smaller)/],
    resolve: (_m, text) => builtin('ui', { setting: 'textScale', delta: /(increase|bigger|larger|enlarge)/.test(text) ? 0.1 : -0.1 }) }),

  // ---------- commands from the 10,000-command analysis ----------
  ...EXTENDED,

  // ---------- self, voice, browser ----------
  cmd({ id: 'skill.self_test', category: 'Skills', description: 'Self-test: checks the speech engine, microphone path, language model, Windows bridge, tools, network and command understanding.', examples: ['run a self test', 'test yourself', 'are you working properly', 'run a self check'],
    patterns: [/\bself[- ]?(test|check|diagnostics?)\b|test yourself|(check|diagnose|test) (your ?self|all (your )?systems)|run (all )?(your )?(own )?tests|are you (working|functioning) (properly|correctly|ok|okay)/], resolve: () => builtin('self_test') }),
  cmd({ id: 'voice.always_listen', category: 'Voice', description: 'Turn always-on listening (wake word) on or off.', examples: ['turn on always listening', 'enable wake word', 'listen all the time', 'turn off always listening', 'disable hands free mode'],
    patterns: [
      /^(turn on|enable|start|activate|switch on) (the )?(always[- ]?on |always |hands[- ]?free |continuous )?(listening|wake ?words?|voice activation|hands[- ]?free)( mode)?$/,
      /^(always listen|listen all the time|keep listening( all the time)?|be always listening|listen always|always be listening)$/,
      /^(turn off|disable|stop|deactivate|switch off) (the )?(always[- ]?on |always |hands[- ]?free |continuous )(listening|mode)( mode)?$/,
      /^(turn off|disable|deactivate|switch off) (the )?(wake ?words?|voice activation|hands[- ]?free)( mode)?$/,
    ],
    resolve: (_m, text) => builtin('always_listen', { on: !/^(turn off|disable|stop|deactivate|switch off)/.test(text) }) }),
  cmd({ id: 'web.set_browser', category: 'Web', description: 'Choose which browser opens websites, or have Clickyy ask each time.', examples: ['always use chrome', 'use edge as my browser', 'set my browser to firefox', 'ask me which browser', 'use the default browser'],
    patterns: [
      /^(?:always )?use (google chrome|chrome|microsoft edge|edge|firefox|brave|opera)(?: browser)?(?: as (?:my|the) (?:default )?browser| for (?:websites|links|everything|the web|web))?(?: from now on| always| by default)?$/,
      /^(?:set|change|make|switch) (?:my |the )?(?:default )?browser (?:to|as) (google chrome|chrome|microsoft edge|edge|firefox|brave|opera)$/,
      /^(?:always )?ask (?:me )?(?:which|what) browser(?: to use)?(?: every time)?$/,
      /^use (?:my |the )?(?:default|normal|system) browser(?: from now on| always)?$/,
    ],
    resolve: (m, text) => builtin('set_browser', { browser: /ask/.test(text) ? 'ask' : /default|normal|system/.test(text) ? 'default' : browserId(m[1] ?? '') }) }),
  cmd({ id: 'web.in_browser', category: 'Web', tool: 'web.open', description: 'Open a website in a specific browser.', examples: ['open yt music in chrome', 'open youtube in edge', 'open github.com in firefox'],
    patterns: [/^(?:open|launch|go to|visit|start|show me|pull up|bring up)(?: up)? (.+?) (?:in|on|with|using|via) (google chrome|chrome|microsoft edge|edge|firefox|brave|opera)(?: browser)?$/],
    resolve: (m, _t, ctx) => {
      const target = m[1].replace(/^(the|my) /, '').trim();
      const b = browserId(m[2]);
      if (/^(?:https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(target)) return openSite(target, target.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0], ctx, b);
      const site = findSite(target);
      if (site) return openSite(site.url, site.name, ctx, b);
      if (/^(a )?(new )?(tab|window|browser)$/.test(target)) return tool('apps.open', { app: { chrome: 'Google Chrome', edge: 'Microsoft Edge', firefox: 'Firefox', brave: 'Brave', opera: 'Opera' }[b] });
      return tool('web.search', { query: target, browser: b });
    } }),
  cmd({ id: 'web.site_search', category: 'Web', tool: 'web.search_site', description: 'Search inside a website: YouTube, YouTube Music, Amazon, Wikipedia, GitHub, Reddit and 60 more.', examples: ['play lofi beats on youtube', 'search amazon for wireless earbuds', 'look up black holes on wikipedia', 'search arijit singh on yt music', 'find react hooks on stack overflow'],
    patterns: [
      /^(?:search|look up|find|look for|browse)(?: on| in| inside)? (.+?) for (.+?)(?: (?:in|on|with|using) (google chrome|chrome|microsoft edge|edge|firefox|brave|opera))?$/,
      /^(?:search(?: for)?|look up|find|look for|play|watch|show me|listen to|put on|stream) (.+?) (?:on|in|at|from|using) (.+?)(?: (?:in|on|with|using) (google chrome|chrome|microsoft edge|edge|firefox|brave|opera))?$/,
    ],
    resolve: (m, text, ctx) => {
      const firstForm = /\bfor\b/.test(text) && /^(search|look up|find|look for|browse)(?: on| in| inside)? /.test(text) && findSearchSite(m[1]);
      const [siteName, query] = firstForm ? [m[1], m[2]] : [m[2], m[1]];
      const site = findSearchSite(siteName);
      if (!site || !query.trim()) return null;
      // "play X on youtube" starts the top result instead of showing a results page.
      if (!firstForm && /^(?:play|watch|listen to|put on|stream) /.test(text)) {
        const svc = /^youtube music$/i.test(site.name) ? 'youtube_music' : /^youtube$/i.test(site.name) ? 'youtube' : /^spotify( web)?$/i.test(site.name) ? 'spotify' : null;
        if (svc) return tool('music.play', { query: query.trim().slice(0, 160), service: svc });
      }
      return inBrowser('web.search_site', { site: site.name, query: query.trim() }, site.name, ctx, m[3] ? browserId(m[3]) : undefined);
    } }),

  // ---------- quick knowledge ----------
  cmd({ id: 'skill.world_clock', category: 'Skills', tool: 'clock.world', description: 'Time anywhere in the world (offline).', examples: ['what time is it in tokyo', "what's the time in new york", 'time in london'],
    patterns: [/^(?:whats |what is )?(?:the )?(?:current |local )?time (?:is it |right now |now )?in (.+)$/, /^what time is it (?:right now |now )?in (.+)$/, /^(?:hows|what is|whats) the time (?:like )?in (.+)$/],
    resolve: (m) => {
      const place = m[1].replace(/\b(right now|now|currently|today|at the moment)\b/g, '').trim();
      return place ? tool('clock.world', { place }) : null;
    } }),
  cmd({ id: 'skill.random', category: 'Skills', tool: 'fun.random', description: 'Flip a coin, roll dice, or pick a random number.', examples: ['flip a coin', 'roll a dice', 'roll 2 dice', 'roll a 20 sided die', 'pick a random number between 1 and 50', 'heads or tails'],
    patterns: [/^(?:flip|toss)(?: a| the| me a)?(?: (\d+))? coins?$|^heads or tails$/, /^roll\b.*\b(dice|die|d\d+)$/, /\b(?:pick|give me|choose|generate|say|tell me)(?: me)?(?: a)? random number\b.*$|^random number\b.*$/],
    resolve: (_m, text) => {
      if (/coin|heads/.test(text)) return tool('fun.random', { kind: 'coin', count: Math.min(10, parseInt(text.match(/(\d+) coins/)?.[1] ?? '1', 10)) });
      if (/^roll/.test(text)) {
        const count = Math.min(10, parseInt(text.match(/^roll (\d+)/)?.[1] ?? '1', 10));
        const sides = parseInt(text.match(/(\d+) sided|\bd(\d+)/)?.slice(1).find(Boolean) ?? '6', 10);
        return tool('fun.random', { kind: 'dice', count, sides: Math.max(2, Math.min(1000, sides)) });
      }
      const range = text.match(/(?:between|from) (-?\d+) (?:and|to) (-?\d+)/);
      return tool('fun.random', { kind: 'number', ...(range ? { min: parseInt(range[1], 10), max: parseInt(range[2], 10) } : {}) });
    } }),
  cmd({ id: 'skill.days_until', category: 'Skills', tool: 'date.until', description: 'Days until a date or holiday.', examples: ['how many days until christmas', 'days until december 25', 'how long until new year', 'when is easter', 'how many days until my birthday on june 2'],
    patterns: [/^how many (?:days|sleeps|weeks) (?:are (?:there |left )?)?(?:until|till|til|to|before) (.+)$/, /^(?:days|how long) (?:is it )?(?:until|till|til) (.+)$/, /^when is (christmas(?: eve)?|easter|thanksgiving|halloween|new years?(?: day| eve)?|valentines(?: day)?|mothers day|fathers day|labou?r day|boxing day|earth day)(?: this year)?$/],
    resolve: (m) => {
      const target = m[1].replace(/\b(this year|from now|from today)\b/g, '').trim();
      if (!target || /\b(timer|reminder|alarm|focus|pomodoro)\b/.test(target)) return null;
      if (/^\d{1,2}(?::\d{2})? ?(?:am|pm|oclock)?$|^(?:noon|midnight|midday)$/.test(target)) return null; // a clock time: time.until
      return tool('date.until', { target });
    } }),
  cmd({ id: 'skill.currency', category: 'Skills', tool: 'currency.convert', description: 'Convert currency with daily ECB rates (online).', examples: ['convert 100 dollars to rupees', '50 euros in usd', 'how much is 20 pounds in yen', 'exchange rate dollar to rupee'],
    patterns: [/^(?:convert |change |exchange )?(\d+(?:\.\d+)?) ([a-z ]+?) (?:to|in|into) ([a-z ]+)$/, /^(?:how much is|whats|what is) (\d+(?:\.\d+)?) ([a-z ]+?) (?:in|to) ([a-z ]+)$/, /^(?:whats |what is )?(?:the )?(?:exchange |conversion )?rate (?:of |for |from )?([a-z ]+?) (?:to|in|into|against|vs) ([a-z ]+)$/],
    resolve: (m, text) => {
      const code = (w: string) => CURRENCY_WORDS[w.trim().replace(/^(the|a|an) /, '').replace(/ (today|now|right now)$/, '')] ?? null;
      const isRate = /rate/.test(text) && !/^\d/.test(m[1]);
      const [amount, from, to] = isRate ? [1, code(m[1]), code(m[2])] : [parseFloat(m[1]), code(m[2]), code(m[3])];
      return from && to ? tool('currency.convert', { amount, from, to }) : null;
    } }),

  // ---------- advanced skills ----------
  cmd({ id: 'skill.briefing', category: 'Skills', description: 'Spoken briefing: time, weather, battery and reminders.', examples: ['give me my morning briefing', 'brief me', 'what does my day look like', 'daily briefing'],
    patterns: [/(morning|daily|evening) (briefing|brief|update|rundown)|^brief me$|^briefing$|what does my day look like|give me (a |my )?(rundown|briefing|status update)( for today)?$|catch me up$/], resolve: () => builtin('briefing') }),
  cmd({ id: 'skill.system_report', category: 'Skills', description: 'Full system health report in one sentence.', examples: ['run a system check', "how's my computer doing", 'system report', 'run diagnostics'],
    patterns: [/(run (a )?)?(system|full|quick|health) (check|report|scan|status|diagnostic)s?|run (a )?diagnostics?|hows my (computer|pc|laptop|system) (doing|holding up)|status report/], resolve: () => builtin('system_report') }),
  cmd({ id: 'skill.screen', category: 'Skills', tool: 'screen.capture', description: 'Look at the screen and answer a question about it (vision model, always asks first).', examples: ["what's on my screen", 'look at my screen and explain this error', 'describe my screen', 'what am i looking at'],
    patterns: [/(whats|what is) on (my|the) screen|(look at|check|read|describe|scan) (my|the|this) screen|what am i looking at|(explain|summari[sz]e) (whats|what is) on (my|the) screen|help me with (this|whats on my) screen/],
    resolve: (_m, text) => builtin('screen', { question: text }) }),
  cmd({ id: 'skill.clipboard_ai', category: 'Skills', tool: 'clipboard.read', description: 'Summarize, explain, translate or proofread what you copied (asks before reading the clipboard).', examples: ['summarize what i copied', 'explain my clipboard', 'proofread what i just copied', 'translate my clipboard to spanish'],
    patterns: [/^(summari[sz]e|explain|translate|proofread|check|fix|rewrite|simplify)( the text)? (what i (just )?copied|my clipboard|the clipboard|this text)(.*)$/],
    resolve: (m) => builtin('clipboard_ai', { instruction: `${m[1]}${m[5] ?? ''}`.trim() }) }),
  cmd({ id: 'skill.clipboard_read', category: 'Skills', tool: 'clipboard.read', description: 'Read what you copied out loud.', examples: ['read what i copied', 'read my clipboard aloud', 'read the selected text aloud'],
    patterns: [/read (out )?(what i (just )?copied|my clipboard|the clipboard|the selected text|the selection)( aloud| out loud)?/], resolve: () => builtin('clipboard_read') }),
  cmd({ id: 'skill.weather', category: 'Skills', tool: 'weather.current', description: 'Current weather and today\'s forecast.', examples: ["what's the weather", 'weather in london', 'do i need an umbrella today', "how's the weather in tokyo", "what's the temperature outside"],
    patterns: [/\b(weather|forecast)\b(?:.*?\b(?:in|for|at) ([a-z][a-z .'-]{1,40}))?/, /do i need an? (umbrella|jacket|coat)/, /(is it|will it) (going to )?(rain|snow)( today)?/, /temperature outside/],
    resolve: (m) => {
      const place = m[2]?.replace(/\b(today|tomorrow|right now|now|please)\b/g, '').trim();
      return tool('weather.current', place ? { location: place } : {});
    } }),
  // ---------- 0.7 everyday extras ----------
  cmd({ id: 'fun.joke', category: 'Fun', tool: 'fun.say', description: 'Tell a joke (offline).', examples: ['tell me a joke', 'make me laugh', 'another joke', 'say something funny'],
    patterns: [/^(?:(?:tell|give)(?: me| us)? |say |do you know |know any )?(?:a |another |one more |some |any )?(?:good |funny |new )?jokes?(?: please)?$/, /^make me (?:laugh|smile)$/, /^say something funny$/, /^cheer me up with a joke$/],
    resolve: () => tool('fun.say', { kind: 'joke' }) }),
  cmd({ id: 'fun.fact', category: 'Fun', tool: 'fun.say', description: 'Share an interesting, true fact (offline).', examples: ['tell me a fun fact', 'give me an interesting fact', 'another fact', 'teach me something new'],
    patterns: [/^(?:(?:tell|give)(?: me| us)? |say |share )?(?:a |an |another |one more |some )?(?:fun |interesting |random |cool |amazing )?facts?(?: please)?$/, /^teach me something (?:new|interesting|cool)$/, /^did you know$/],
    resolve: () => tool('fun.say', { kind: 'fact' }) }),
  cmd({ id: 'fun.riddle', category: 'Fun', tool: 'fun.say', description: 'Ask a riddle, then reveal the answer when asked (offline).', examples: ['tell me a riddle', 'give me a riddle', 'another riddle'],
    patterns: [/^(?:(?:tell|give|ask)(?: me| us)? )?(?:a |another |one more )?(?:good |hard |easy )?riddles?(?: please)?$/], resolve: () => tool('fun.say', { kind: 'riddle' }) }),
  cmd({ id: 'fun.riddle_answer', category: 'Fun', tool: 'fun.riddle_answer', description: 'Reveal the answer to the last riddle.', examples: ['tell me the answer', 'i give up', "what's the answer to the riddle"],
    patterns: [/^(?:tell me |whats |what is |give me |reveal )?the answer(?: to the riddle)?(?: please)?$/, /^i give up$/], resolve: () => tool('fun.riddle_answer') }),
  cmd({ id: 'fun.motivation', category: 'Fun', tool: 'fun.say', description: 'A line of encouragement (offline).', examples: ['motivate me', 'i need some motivation', 'inspire me', 'give me a pep talk'],
    patterns: [/^(?:motivate|inspire|encourage) me(?: please)?$/, /^(?:i need |give me )(?:some |a little )?(?:motivation|inspiration|encouragement|a pep talk)$/, /^(?:say something|tell me something) (?:motivating|inspiring|encouraging)$/],
    resolve: () => tool('fun.say', { kind: 'motivation' }) }),
  cmd({ id: 'security.password', category: 'Skills', tool: 'password.generate', description: 'Make a strong random password, shown on screen and never read aloud (offline).', examples: ['generate a strong password', 'make me a 20 character password', 'create a random password', 'suggest a secure password'],
    patterns: [/^(?:generate|make|create|give|suggest|get)(?: me)? (?:a |an )?(?:new )?(?:(?:strong|secure|random|good|safe) )*(?:(\d{1,2}) (?:character|char|letter|digit) )?password(?: (?:with|of) (\d{1,2}) (?:characters|chars|letters))?(?: please)?$/],
    resolve: (m) => { const n = Number(m[1] ?? m[2] ?? 16); return tool('password.generate', { length: Math.min(64, Math.max(8, n)) }); } }),
  cmd({ id: 'text.spell', category: 'Skills', tool: 'text.spell', description: 'Spell a word letter by letter, or with the phonetic alphabet (offline).', examples: ['how do you spell necessary', 'spell accommodation', 'spell my name chinmay phonetically'],
    patterns: [/^(?:how (?:do you|do i|to) spell|spell(?: out)?|(?:whats|what is) the spelling of)(?: the word| my name)? ([a-z][a-z'-]{0,39})( phonetically| using the phonetic alphabet| with the phonetic alphabet)?$/],
    resolve: (m) => (/^(?:check|it|that|this)$/.test(m[1]) ? null : tool('text.spell', { word: m[1], phonetic: !!m[2] })) }),
  cmd({ id: 'number.roman', category: 'Skills', tool: 'number.roman', description: 'Roman numerals to and from numbers (offline).', examples: ['what is 2026 in roman numerals', 'convert 49 to roman numerals', 'what number is mcmxcix'],
    patterns: [/^(?:(?:whats|what is|convert|write|show me) )?(\d{1,4}) (?:in|to|into|as) roman(?: numerals?)?$/, /^(?:whats |what is )?(?:the )?roman numerals? for (\d{1,4})$/, /^(?:what number is|convert|what is) ([mdclxvi]{2,15})(?: from roman numerals?)?(?: in numbers| to a number| to numbers| as a number)?$/],
    resolve: (m) => tool('number.roman', { value: m[1] }) }),
  cmd({ id: 'math.split_bill', category: 'Skills', tool: 'math.split_bill', description: 'Split a bill between people, with an optional tip (offline).', examples: ['split 1200 between 4 people', 'split the bill of 2500 among 5 with a 10 percent tip', "what's a 15 percent tip on 80"],
    patterns: [
      /^split (?:a |the |my |this )?(?:bill |check |amount |total )?(?:of )?(?:rs |inr |\$)?(\d+(?:\.\d+)?)(?: rupees| dollars| rs)? (?:between|among|amongst|by|for|with|into) (\d{1,4})(?: people| persons| friends| ways| of us)?(?: (?:with|and|plus|including) (?:a )?(\d+(?:\.\d+)?) percent tip)?$/,
      /^(?:whats |what is |calculate |work out )?(?:a )?(\d+(?:\.\d+)?) percent tip (?:on|for) (?:rs |\$)?(\d+(?:\.\d+)?)(?: rupees| dollars)?(?: (?:split )?(?:between|among|for) (\d{1,4})(?: people)?)?$/,
    ],
    resolve: (m, text) => (/percent tip (?:on|for)/.test(text) && !/^split/.test(text)
      ? tool('math.split_bill', { amount: Number(m[2]), tipPercent: Number(m[1]), people: Number(m[3] ?? 1) })
      : tool('math.split_bill', { amount: Number(m[1]), people: Number(m[2]), tipPercent: Number(m[3] ?? 0) })) }),
  cmd({ id: 'date.weekday', category: 'Skills', tool: 'date.weekday', description: 'Which day of the week a date or holiday falls on (offline).', examples: ['what day was august 15 1947', 'what day is christmas this year', 'which day of the week is january 26'],
    patterns: [/^(?:what|which) day (?:of the week )?(?:is|was|will|does|did) (.+?)(?: be| fall on| fall| falls on| land on)?(?: this year| next year)?$/, /^what day (?:does|did|will) (.+?) (?:fall|land) on(?: this year)?$/],
    resolve: (m) => {
      const t = m[1].replace(/^(?:it|today|tomorrow|yesterday)$/, '');
      return t && (/\b(?:january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\b|\d{4}-\d/.test(t) || /christmas|new year|halloween|valentine|independence day|republic day|diwali|easter|thanksgiving|gandhi jayanti|mothers day|fathers day|boxing day|earth day|teachers day|childrens day|womens day|april fool|solstice|patricks day|labou?r day|fourth of july|july fourth/.test(t)) ? tool('date.weekday', { date: t.replace(/^the /, '') }) : null;
    } }),
  cmd({ id: 'date.age', category: 'Skills', tool: 'date.weekday', description: 'Age from a birth date (offline).', examples: ['how old is someone born on june 2 2006', 'how old am i if i was born on march 3 1999'],
    patterns: [/^how old (?:is (?:someone|somebody|a person)|am i|would i be|is a person) (?:who was |if i was |if i were |if )?born (?:on |in )?(.+\d{4})$/],
    resolve: (m) => tool('date.weekday', { date: m[1], mode: 'age' }) }),
  cmd({ id: 'system.panel', category: 'System', tool: 'system.panel', description: 'Open Windows panels: screen snip, notifications, quick settings, Wi-Fi list, second screen, Task View, Clock, Store, Camera, Photos, Maps, Calculator.', examples: ['snip part of my screen', 'show my notifications', 'open quick settings', 'show available wifi networks', 'connect to a second screen', 'open task view', 'open the camera'],
    patterns: [
      /^(?:take a |make a |start a |open (?:the )?)?(?:screen ?)?snip(?:ping)?(?: tool)?$|^snip (?:part of |a part of |an area of |a region of )?(?:my |the )?screen$|^(?:screenshot|capture) (?:part of|an area of|a region of|a section of) (?:my |the )?screen$/,
      /^(?:open|show|check|see)(?: me)? (?:my |the )?(?:notifications?|notification (?:center|centre|panel)|action (?:center|centre))$/,
      /^(?:open|show)(?: me)? (?:the )?quick settings(?: panel)?$/,
      /^(?:show|list|open|scan for|find)(?: me)? (?:the |all )?(?:available |nearby )?(?:wifi|wi fi|wireless) (?:networks?|list)(?: nearby| around me)?$/,
      /^(?:connect to|project to|extend to|duplicate to|show) (?:a |1 |my |the )?(?:second (?:screen|monitor|display)|projector|external (?:monitor|display|screen)|tv)$|^(?:open )?(?:the )?project(?:ion)? (?:menu|options|settings)$/,
      /^(?:open|show)(?: me)? (?:the )?task view$|^show (?:me )?all (?:my )?(?:open )?(?:windows|apps) side by side$/,
      /^(?:open|launch|start)(?: up)? (?:the )?(clock|alarms?|store|microsoft store|windows store|camera|webcam|photos|maps)(?: app)?$/,
    ],
    resolve: (m, text) => {
      if (/snip|part of|area of|region of|section of/.test(text)) return tool('system.panel', { panel: 'snip' });
      if (/notification|action cent/.test(text)) return tool('system.panel', { panel: 'notifications' });
      if (/quick settings/.test(text)) return tool('system.panel', { panel: 'quick_settings' });
      if (/wifi|wi fi|wireless/.test(text)) return tool('system.panel', { panel: 'wifi_list' });
      if (/second|projector|external|\btv\b|project/.test(text)) return tool('system.panel', { panel: 'project' });
      if (/task view|side by side/.test(text)) return tool('system.panel', { panel: 'task_view' });
      const app = m[1] ?? '';
      const panel = /clock|alarm/.test(app) ? 'clock' : /store/.test(app) ? 'store' : /camera|webcam/.test(app) ? 'camera' : app === 'photos' ? 'photos' : 'maps';
      return tool('system.panel', { panel });
    } }),
  cmd({ id: 'math.emi', category: 'Skills', tool: 'math.emi', description: 'Loan EMI, total interest and total payment (offline).', examples: ['emi for 5 lakh at 9 percent for 3 years', 'calculate the emi on a 25 lakh home loan at 8.5 percent for 20 years', 'monthly payment for a 20000 loan at 7 percent for 24 months'],
    patterns: [/^(?:(?:calculate|whats|what is|work out|tell me) )?(?:the |my )?(?:emi|monthly (?:payment|installment|instalment)) (?:for|on|of) (?:a |an |my )?(.*?\d.*?) (?:at|with|@) (.+?) (?:for|over) (.+)$/],
    resolve: (_m, text) => { const l = parseLoan(text); return l ? tool('math.emi', { principal: l.principal, ratePercent: l.rate, months: l.months }) : null; } }),
  cmd({ id: 'math.bmi', category: 'Skills', tool: 'math.bmi', description: 'BMI from weight and height (offline).', examples: ['calculate my bmi 70 kg 175 cm', "what's the bmi for 82 kilos and 180 centimeters"],
    patterns: [/\bbmi\b.*?(\d+(?:\.\d+)?) ?(?:kg|kgs|kilos?|kilograms?)\b.*?(\d+(?:\.\d+)?) ?(?:cm|cms|centimet(?:er|re)s?)\b/, /\bbmi\b.*?(\d+(?:\.\d+)?) ?(?:cm|cms|centimet(?:er|re)s?)\b.*?(\d+(?:\.\d+)?) ?(?:kg|kgs|kilos?|kilograms?)\b/],
    resolve: (m, text) => { const kgFirst = /\d ?(?:kg|kilo)/.test(text.split(/cm|centimet/)[0]); return tool('math.bmi', kgFirst ? { weightKg: Number(m[1]), heightCm: Number(m[2]) } : { weightKg: Number(m[2]), heightCm: Number(m[1]) }); } }),
  cmd({ id: 'date.leap', category: 'Skills', tool: 'date.leap', description: 'Is a year a leap year (offline).', examples: ['is 2028 a leap year', 'was 1900 a leap year'],
    patterns: [/^(?:is|was|will) (\d{1,4}) (?:be )?a leap year$/, /^is this year a leap year$/],
    resolve: (m) => tool('date.leap', { year: Number(m[1] ?? new Date().getFullYear()) }) }),
  cmd({ id: 'time.until', category: 'Skills', tool: 'time.until', description: 'How long until a time of day (offline).', examples: ['how long until 5 pm', 'how many minutes until 6:30', 'how much time until midnight'],
    patterns: [/^how (?:long|many (?:minutes|hours)|much time)(?: is it| is left| left| do i have)? (?:until|till|til|before) (\d{1,2}(?::\d{2})? ?(?:am|pm|oclock)?|noon|midnight|midday)$/],
    resolve: (m) => tool('time.until', { time: m[1] }) }),
  cmd({ id: 'fun.choose', category: 'Fun', tool: 'fun.choose', description: 'Pick one of your options at random.', examples: ['pick between pizza and burger', 'help me decide between red blue or green', 'choose between tea or coffee'],
    patterns: [/^(?:(?:can you |please )?(?:pick|choose|decide)(?: for me)?|help me (?:decide|choose|pick)|you (?:pick|choose|decide)) (?:between|from|among) (.{3,200})$/, /^(?:flip a coin|toss up) between (.{3,200})$/],
    resolve: (m) => {
      const opts = m[1].replace(/\?$/, '').split(/,\s*| or | and /).map((o) => o.replace(/^(?:the|a|an) /, '').trim()).filter(Boolean);
      return opts.length >= 2 && opts.length <= 10 ? tool('fun.choose', { options: opts }) : null;
    } }),
  cmd({ id: 'fun.rps', category: 'Fun', tool: 'fun.rps', description: 'Play rock, paper, scissors.', examples: ["let's play rock paper scissors", 'i choose paper', 'rock'],
    patterns: [/^(?:lets |let us |can we |wanna |do you want to )?play rock paper scissors$|^rock paper scissors$/, /^(?:i (?:choose|pick|go with|play)|ill go with|my move is) (rock|paper|scissors)$/, /^(rock|paper|scissors)$/],
    resolve: (m) => tool('fun.rps', m[1] ? { move: m[1] } : {}) }),
  cmd({ id: 'wellness.breathe', category: 'Fun', tool: 'wellness.breathe', description: 'A short guided breathing exercise.', examples: ['help me relax', "let's do a breathing exercise", 'i feel stressed', 'calm me down'],
    patterns: [/^(?:help me (?:relax|calm down|breathe|unwind)|calm me down|(?:(?:lets|let us) )?(?:(?:start|do|try|guide me through) )?(?:a )?(?:short |quick )?breathing exercises?|i(?: am|m) (?:feeling )?(?:stressed|anxious|overwhelmed|tense)(?: out)?|i feel (?:stressed|anxious|overwhelmed|tense)(?: out)?|guide my breathing)$/],
    resolve: () => tool('wellness.breathe') }),
  cmd({ id: 'dictionary.define', category: 'Skills', tool: 'dictionary.define', description: 'Dictionary definitions, synonyms and antonyms (no account needed).', examples: ['define serendipity', 'what does ubiquitous mean', 'synonyms for happy', 'opposite of generous', "what's the meaning of resilience"],
    patterns: [
      /^(?:define|definition of|(?:whats|what is|tell me) the (?:definition|meaning) of|meaning of|dictionary)(?: the word)? ([a-z][a-z'-]{1,39})$/,
      /^what does (?:the word )?([a-z][a-z'-]{1,39}) mean$/,
      /^(?:(?:give me|whats|what is|what are|tell me|list)(?: a| the| some)? )?(synonyms?|antonyms?|another word|other words|opposite|the opposite) (?:of|for) ([a-z][a-z'-]{1,39})$/,
    ],
    resolve: (m) => {
      if (m[2]) return tool('dictionary.define', { word: m[2], mode: /^(?:antonym|opposite|the opposite)/.test(m[1]) ? 'antonyms' : 'synonyms' });
      return /^(?:life|it|that|this|everything|love)$/.test(m[1]) ? null : tool('dictionary.define', { word: m[1] });
    } }),
  cmd({ id: 'skill.air_quality', category: 'Skills', tool: 'weather.air', description: 'Current air quality (AQI) for a city (no account needed).', examples: ["what's the air quality", 'aqi in delhi', 'how is the air in mumbai today', 'pollution level in bangalore'],
    patterns: [/\b(?:air quality|aqi|pollution levels?|air pollution|smog)\b(?:.*?\b(?:in|for|at|of) ([a-z][a-z .'-]{1,40}))?/, /^(?:hows|how is) the air(?: quality)?(?: (?:in|at) ([a-z][a-z .'-]{1,40}))?(?: today| now| right now)?$/],
    resolve: (m) => { const place = m[1]?.replace(/\b(?:today|tomorrow|right now|now|please)\b/g, '').trim(); return tool('weather.air', place ? { location: place } : {}); } }),
  cmd({ id: 'skill.sun', category: 'Skills', tool: 'weather.sun', description: "Today's sunrise and sunset times (no account needed).", examples: ['when is sunset', 'what time is sunrise in tokyo', 'when does the sun set today'],
    patterns: [/\b(?:sunrise|sunset|sun rise|sun set)\b(?:.*?\b(?:in|for|at) ([a-z][a-z .'-]{1,40}))?/, /^when (?:does|will) the sun (?:rise|set|go down|come up)(?: (?:in|at) ([a-z][a-z .'-]{1,40}))?(?: today| tomorrow)?$/],
    resolve: (m) => { const place = m[1]?.replace(/\b(?:today|tomorrow|right now|now|please)\b/g, '').trim(); return tool('weather.sun', place ? { location: place } : {}); } }),
  cmd({ id: 'skill.news', category: 'Skills', tool: 'news.headlines', description: 'Read the latest news headlines, or news about a topic (no account needed).', examples: ["what's the news", 'read me the headlines', 'news about cricket', 'latest technology news', "what's happening in the world"],
    patterns: [
      /^(?:(?:whats|what is|tell me|give me|read(?: me)?|show(?: me)?|get(?: me)?|any) )?(?:the )?(?:latest |top |todays |breaking |recent )?(?:news|headlines)(?: (?:about|on|for|from|in|regarding) (?:the )?([a-z0-9][a-z0-9 .&'-]{1,50}?))?(?: today| right now| now| please)?$/,
      /^(?:whats the |what is the |read me the |give me the |tell me the )?(?:latest|todays|top|recent) ([a-z0-9][a-z0-9 .&'-]{1,40}?) (?:news|headlines)$/,
      /^whats (?:happening|going on) in the world(?: today)?$/,
    ],
    resolve: (m) => {
      const topic = (m[1] ?? '').trim();
      return tool('news.headlines', topic && !/^(?:the world|world|today)$/.test(topic) ? { topic } : {});
    } }),
  cmd({ id: 'skill.wikipedia', category: 'Skills', tool: 'knowledge.lookup', description: 'Spoken encyclopedia answer from Wikipedia (no account needed).', examples: ['what does wikipedia say about black holes', 'tell me about the eiffel tower from wikipedia', 'wikipedia summary of albert einstein', 'according to wikipedia who is ada lovelace'],
    patterns: [
      /^what does wikipedia (?:say|know|have) (?:about|on) (.{2,80})$/,
      /^(?:tell me|read me|give me a summary) (?:about|of) (.{2,80}?) (?:from|on|according to|using) wikipedia$/,
      /^(?:give me (?:the |a )?)?wikipedia (?:summary|article|entry|page) (?:of|for|on|about) (.{2,80})$/,
      /^according to wikipedia,? (?:who|what) (?:is|was|are|were) (.{2,80})$/,
    ],
    resolve: (m) => tool('knowledge.lookup', { query: m[1].replace(/\?$/, '').trim() }) }),
  cmd({ id: 'skill.convert', category: 'Skills', tool: 'units.convert', description: 'Convert units offline.', examples: ['convert 5 miles to kilometers', 'how many cups in a liter', '100 fahrenheit in celsius', '2 gigabytes in megabytes'],
    patterns: [/^(?:convert )?(\d+(?:\.\d+)?) ?([a-z][a-z/ ]{0,24}?) (?:to|in|into) ([a-z][a-z/ ]{0,24})$/, /^how many ([a-z][a-z ]{0,24}) (?:are )?in (?:a|an|one|1) ([a-z][a-z ]{0,24})$/],
    resolve: (m, text) => (/^how many/.test(text) ? tool('units.convert', { value: 1, from: m[2], to: m[1] }) : tool('units.convert', { value: parseFloat(m[1]), from: m[2], to: m[3] })) }),
  cmd({ id: 'skill.math', category: 'Skills', tool: 'math.calculate', description: 'Calculator (offline).', examples: ["what's 15 percent of 240", 'calculate 12 times 7', 'what is the square root of 144', 'what is 2 to the power of 10', "what's 1250 divided by 5"],
    patterns: [/^(?:whats|what is|calculate|compute|how much is)\s+(.*(?:\d\s*(?:\+|-|\*|\/|\^|x|times|plus|minus|divided by|multiplied by|over|percent of|to the power of|squared|cubed|mod)|square root of|cube root of).*)$/, /^(\d[\d.\s]*(?:\+|-|\*|\/|\^|x|times|plus|minus|divided by|multiplied by)\s*[\d.(][\d.\s()+\-*/^]*)$/],
    resolve: (m) => tool('math.calculate', { expression: m[1].replace(/\?$/, '') }) }),

  // ---------- memory ----------
  cmd({ id: 'memory.list', category: 'Memory', tool: 'memory.list', description: 'List what Clickyy has been asked to remember.', examples: ['what do you remember about me', 'what do you know about me'],
    patterns: [/what do you (remember|know) about me|what have you (saved|remembered)|show (my )?memories/], resolve: () => tool('memory.list') }),
  cmd({ id: 'memory.save', category: 'Memory', tool: 'memory.save', description: 'Explicitly save a preference or fact.', examples: ['remember that I prefer dark roast coffee', 'remember my project is called Atlas'],
    patterns: [/^(please )?remember (that )?(.+)$/], resolve: (m) => tool('memory.save', { text: m[3] }) }),
  cmd({ id: 'memory.forget', category: 'Memory', tool: 'memory.forget', description: 'Delete saved memories matching words.', examples: ['forget about my coffee preference'],
    patterns: [/^forget (about |that |what i said about )?(.{2,})$/],
    // "forget about it" means never mind, not "delete a memory called it".
    resolve: (m) => (/^(?:it|that|this|them|him|her|everything i just said|what i just said)$/.test(m[2].trim()) ? builtin('cancel') : tool('memory.forget', { query: m[2].replace(/^my /, '') })) }),

  // ---------- productivity ----------
  cmd({ id: 'timer.cancel', category: 'Productivity', tool: 'reminders.cancel', description: 'Cancel a timer, reminder or focus session.', examples: ['cancel the timer', 'cancel my reminder', 'stop the focus session', 'cancel all timers'],
    patterns: [/(cancel|stop|delete|remove|clear) (the |my |all )?(last )?(timers?|reminders?|focus session|pomodoro|alarms?)/],
    resolve: (_m, text) => tool('reminders.cancel', { target: /\ball\b/.test(text) ? 'all' : /focus|pomodoro/.test(text) ? 'focus' : /timer|alarm/.test(text) ? 'timer' : /reminder/.test(text) ? 'reminder' : 'last' }) }),
  cmd({ id: 'timer.list', category: 'Productivity', tool: 'reminders.list', description: 'List reminders and timers.', examples: ['what reminders do I have', 'how long is left on my timer'],
    patterns: [/(what|which|any|list|show)( are)?( my)? (reminders|timers)|how (long|much time) is left|(summarize|what are) (today'?s|my) tasks/], resolve: () => tool('reminders.list') }),
  cmd({ id: 'focus.start', category: 'Productivity', tool: 'timers.create', description: 'Start a focus (pomodoro) session.', examples: ['start a 25 minute focus session', 'start a study session', 'begin pomodoro'],
    patterns: [/(start|begin|create)( a| an)?( (\d+) (minute|hour)s?)? (focus|pomodoro|study|deep work)( session| timer| block)?/, /^(focus|pomodoro) (session|time|mode)$/],
    resolve: (_m, text) => tool('timers.create', { seconds: parseDuration(text) ?? 25 * 60, label: 'Focus', focus: true }) }),
  cmd({ id: 'timer.create', category: 'Productivity', tool: 'timers.create', description: 'Set a countdown timer.', examples: ['set a timer for 10 minutes', '5 minute timer', 'timer for 90 seconds'],
    patterns: [/(set|start|create|make)( me)?( a| an)? timer( for)?(.*)$/, /^(\d+.*(minute|second|hour)s?) timer$/, /^timer( for)? (.+)$/],
    resolve: (_m, text) => {
      const s = parseDuration(text);
      return s ? tool('timers.create', { seconds: s, label: 'Timer' }) : clarify('For how long?', { commandId: 'timer.create', slot: 'seconds', partial: {} });
    },
    fill: (answer) => { const s = parseDuration(answer); return s ? tool('timers.create', { seconds: s, label: 'Timer' }) : null; } }),
  cmd({ id: 'reminder.create', category: 'Productivity', tool: 'reminders.create', description: 'Create a reminder at a time or after a delay.', examples: ['remind me in 20 minutes', 'remind me to call mom in 1 hour', 'create a reminder for tomorrow morning', 'remind me at 5 pm to stretch'],
    patterns: [/^(remind me|set a reminder|create a reminder|add a reminder)(.*)$/],
    resolve: (m) => {
      const rest = m[2].trim();
      const textMatch = rest.match(/(?:^|\s)(?:to|about|that)\s+(.+?)(?=\s+(?:in \d|at \d|tomorrow|tonight|this (?:morning|afternoon|evening))|$)/);
      const what = textMatch?.[1]?.trim() || 'Reminder';
      const secs = /\bin \d/.test(rest) ? parseDuration(rest) : null;
      if (secs) return tool('reminders.create', { text: what, inSeconds: secs });
      const at = parseClockTime(rest);
      if (at) return tool('reminders.create', { text: what, at: at.toISOString() });
      return clarify('When should I remind you?', { commandId: 'reminder.create', slot: 'when', partial: { text: what } });
    },
    fill: (answer, partial) => {
      const secs = parseDuration(answer);
      if (secs) return tool('reminders.create', { text: partial.text ?? 'Reminder', inSeconds: secs });
      const at = parseClockTime(answer);
      return at ? tool('reminders.create', { text: partial.text ?? 'Reminder', at: at.toISOString() }) : null;
    } }),

  // ---------- power (destructive, confirmed) ----------
  cmd({ id: 'power.abort', category: 'System', tool: 'power.abort', description: 'Cancel a pending shutdown or restart.', examples: ['cancel shutdown', 'abort the restart'],
    patterns: [/(cancel|abort|stop) (the )?(shut ?down|restart|reboot)/], resolve: () => tool('power.abort') }),
  cmd({ id: 'power.action', category: 'System', tool: 'power.action', description: 'Shut down, restart or sign out (always confirmed).', examples: ['shut down my computer', 'restart the pc', 'sign me out'],
    patterns: [/^(shut ?down|turn off|power off|restart|reboot|sign out|log out|log off)( my| the)?( computer| pc| laptop| system| windows)?$/, /^sign me out$/],
    resolve: (_m, text) => tool('power.action', { action: /restart|reboot/.test(text) ? 'restart' : /sign|log/.test(text) ? 'signout' : 'shutdown' }) }),
  cmd({ id: 'system.lock', category: 'System', tool: 'system.lock', description: 'Lock the workstation.', examples: ['lock my pc', 'lock the screen'],
    patterns: [/^lock( my| the)?( pc| computer| screen| laptop| workstation| windows)?$/], resolve: () => tool('system.lock') }),

  // ---------- system info ----------
  cmd({ id: 'system.time', category: 'System', tool: 'system.time', description: 'Current time and date.', examples: ['what time is it', "what's the date", 'what day is it'],
    patterns: [/what(s| is)? the time|what time is it|^time$|^(what(s| is) )?(the |today'?s )?date( today)?$|what day is (it|today)|what(s| is) today/], resolve: () => tool('system.time') }),
  cmd({ id: 'system.battery', category: 'System', tool: 'system.battery', description: 'Battery level and charging.', examples: ['how much battery do I have', 'is my laptop charging'],
    patterns: [/battery|\b(is|am) (it|i|my (laptop|pc|computer|device))( currently)? charging|plugged in/], resolve: () => tool('system.battery') }),
  cmd({ id: 'system.processes', category: 'System', tool: 'system.processes', description: 'Processes using the most memory.', examples: ["what's using my memory", 'show running processes'],
    patterns: [/(top|running|show( me)?)( the)? processes|what(s| is) using (my |the )?(memory|ram|cpu)/], resolve: () => tool('system.processes') }),
  cmd({ id: 'system.resources', category: 'System', tool: 'system.resources', description: 'CPU and RAM usage.', examples: ['how much ram is being used', 'show cpu usage'],
    patterns: [/\b(cpu|processor)\b/, /\b(ram|memory)\b.*\b(use|usage|used|left|free|available)\b|how much (ram|memory)/, /system (load|performance|resources)/],
    resolve: (_m, text) => tool('system.resources', { focus: /cpu|processor/.test(text) && !/ram|memory/.test(text) ? 'cpu' : /ram|memory/.test(text) && !/cpu|processor/.test(text) ? 'memory' : 'both' }) }),
  cmd({ id: 'system.disk', category: 'System', tool: 'system.disk', description: 'Free disk space.', examples: ['how much disk space is available', 'how much storage do I have left'],
    patterns: [/disk space|storage (space|left)|free space|drive space|how much (storage|space)/], resolve: (_m, text) => tool('system.disk', { drive: (text.match(/\b([a-z]) drive\b/)?.[1] ?? 'c').toUpperCase() }) }),
  cmd({ id: 'system.network', category: 'System', tool: 'system.network', description: 'Internet and Wi-Fi status.', examples: ['is the internet connected', 'am i online', 'what wifi am i on'],
    patterns: [/(is|am) (the |my )?(internet|wifi|network|i)( connection)? (connected|working|online|up|down)|am i (online|connected)|what wifi|which wifi|network status|connectivity/], resolve: () => tool('system.network') }),
  cmd({ id: 'system.uptime', category: 'System', tool: 'system.uptime', description: 'System uptime.', examples: ["what's my system uptime", 'how long has my pc been on'],
    patterns: [/uptime|how long (has|have) (my |the )?(pc|computer|laptop|system|it) been (on|running|up)/], resolve: () => tool('system.uptime') }),
  cmd({ id: 'system.audio_devices', category: 'System', tool: 'system.audio_devices', description: 'Active audio devices.', examples: ['which audio device is active', "what's my default microphone"],
    patterns: [/which (audio|sound|output|playback) device|what(s| is) (my |the )?(default )?(speakers?|audio device|output device|microphone|mic)|which (speaker|microphone) (is|am)/], resolve: () => tool('system.audio_devices') }),
  cmd({ id: 'system.task_manager', category: 'System', tool: 'system.task_manager', description: 'Open Task Manager.', examples: ['open task manager'],
    patterns: [/task manager/], resolve: (_m, text) => (/^(close|quit|exit|minimi[sz]e|bring|focus|switch|restart|force|kill|end|snap|maximi[sz]e|move|hide)\b/.test(text) ? null : tool('system.task_manager')) }),
  cmd({ id: 'system.settings', category: 'System', tool: 'system.open_settings', description: 'Open a Windows Settings page.', examples: ['open windows settings', 'open bluetooth settings', 'open sound settings'],
    patterns: [/^(open|show|go to|launch)( the| my)? (windows )?settings$/, /^(open|show|go to|take me to)( the| my)? (.+?) (settings?|options)$/],
    resolve: (m) => {
      if (!m[3] || /^windows ?$/.test(m[3])) return tool('system.open_settings', { page: 'home' });
      const page = findSettingsPage(m[3]);
      return page ? tool('system.open_settings', { page: page.id }) : clarify(`I don't have a shortcut to ${m[3].trim()} settings. Should I open Windows Settings instead?`, { commandId: 'system.settings', slot: 'confirm', partial: {} });
    },
    fill: (answer) => (YES.test(answer) ? tool('system.open_settings', { page: 'home' }) : null) }),
  // ---------- audio ----------
  cmd({ id: 'audio.set', category: 'Audio', tool: 'audio.set_volume', description: 'Set the volume to a level.', examples: ['set volume to 30 percent', 'lower the volume to 30 percent', 'volume 50', 'put the volume at 20'],
    patterns: [/\bvolume (?:to |at )?(\d{1,3})(?: percent)?$/, /(?:set|change|put|turn|lower|raise|increase|decrease|reduce|bring)(?: the| my)? (?:volume|sound)(?: down| up)? (?:to|at) (\d{1,3})(?: percent)?/, /(?:set|turn) (?:it|the sound) (?:to|at) (\d{1,3}) percent/],
    resolve: (m) => tool('audio.set_volume', { level: pct(m[1]) }) }),
  cmd({ id: 'audio.adjust', category: 'Audio', tool: 'audio.set_volume', description: 'Raise or lower the volume.', examples: ['turn the volume down a little', 'louder', 'volume up', 'turn it up by 20'],
    patterns: [/(?:turn|bring) (?:the |my )?(?:volume|sound|music|it) (up|down)(?: a (?:little|bit|lot|tad))?(?: by (\d{1,3})(?: percent)?)?/, /\b(louder|quieter|softer)\b/, /(?:volume|sound) (up|down)(?: by (\d{1,3}))?/, /(raise|increase|lower|decrease|reduce)(?: the| my)? (?:volume|sound)(?: a (?:little|bit|lot))?(?: by (\d{1,3})(?: percent)?)?/],
    resolve: (m, text) => {
      const up = /\b(up|louder|raise|increase)\b/.test(text);
      const by = text.match(/by (\d{1,3})/)?.[1];
      const amount = by ? parseInt(by, 10) : /a lot/.test(text) ? 20 : /little|bit|tad/.test(text) ? 5 : 10;
      return tool('audio.set_volume', { delta: up ? amount : -amount });
    } }),
  cmd({ id: 'audio.unmute', category: 'Audio', tool: 'audio.mute', description: 'Unmute the speakers.', examples: ['unmute', 'unmute my computer', 'turn the sound back on'],
    patterns: [/^unmute( my| the)?( computer| pc| sound| audio| volume| speakers)?$/, /turn (the )?sound (back )?on/], resolve: () => tool('audio.mute', { mute: false }) }),
  cmd({ id: 'audio.mute', category: 'Audio', tool: 'audio.mute', description: 'Mute the speakers.', examples: ['mute my computer', 'mute', 'turn the sound off'],
    patterns: [/^mute( my| the)?( computer| pc| laptop| system| device| sound| audio| volume| speakers| everything)?$/, /turn (the )?sound off/], resolve: () => tool('audio.mute', { mute: true }) }),
  cmd({ id: 'audio.restore', category: 'Audio', tool: 'audio.restore_volume', description: 'Restore the previous volume.', examples: ['restore the previous volume', 'put the volume back'],
    patterns: [/(restore|reset|put back|go back to)( the)? (previous |last |old )?volume|volume back/], resolve: () => tool('audio.restore_volume') }),
  cmd({ id: 'audio.get', category: 'Audio', tool: 'audio.get_volume', description: 'Read the current volume.', examples: ["what's the volume", 'how loud is it', 'is my sound muted'],
    patterns: [/what(s| is)( the)? (current )?volume|current volume|how loud|is (my |the )?(sound|audio|computer) muted/], resolve: () => tool('audio.get_volume') }),

  // ---------- media ----------
  cmd({ id: 'media.now', category: 'Media', tool: 'media.now_playing', description: "What's currently playing.", examples: ["what's playing", 'what song is this'],
    patterns: [/what(s| is) (playing|this song|on)|what song is (this|playing)|who sings this/], resolve: () => tool('media.now_playing') }),
  cmd({ id: 'media.pause', category: 'Media', tool: 'media.control', description: 'Pause playback.', examples: ['pause the music', 'pause'],
    patterns: [/^pause( the| my)?( music| song| video| playback| track| media| spotify)?$/], resolve: () => tool('media.control', { action: 'pause' }) }),
  cmd({ id: 'media.play', category: 'Media', tool: 'media.control', description: 'Resume playback.', examples: ['resume playback', 'play music', 'continue the song'],
    patterns: [/^(resume|unpause|continue)( the| my)?( music| song| video| playback| track| media)?$/, /^(?:start|put|turn|get) (?:the |my )?(?:music|song|playback) (?:back up|back on|again)$/, /^play( the| some| my)?( music| song| video| media)?$/], resolve: () => tool('media.control', { action: 'play' }) }),
  cmd({ id: 'media.next', category: 'Media', tool: 'media.control', description: 'Next track.', examples: ['skip this track', 'next song'],
    patterns: [/^(skip|next)( this| the)?( track| song| one)?$|^(play|go to) the next (track|song)$/], resolve: () => tool('media.control', { action: 'next' }) }),
  cmd({ id: 'media.previous', category: 'Media', tool: 'media.control', description: 'Previous track.', examples: ['play the previous track', 'previous song'],
    patterns: [/^(previous|last|go back a)( track| song)?$|(play|go to) the (previous|last) (track|song)/], resolve: () => tool('media.control', { action: 'previous' }) }),
  cmd({ id: 'media.stop', category: 'Media', tool: 'media.control', description: 'Stop playback.', examples: ['stop the music', 'stop playback'],
    patterns: [/^stop( the| my)? (music|song|video|playback|media|spotify)$/], resolve: () => tool('media.control', { action: 'stop' }) }),
  cmd({ id: 'media.spotify', category: 'Media', tool: 'media.spotify_search', description: 'Search Spotify for music.', examples: ['play my focus playlist', 'play lofi on spotify', 'find taylor swift on spotify'],
    patterns: [/^(?:play|find|search for|look for|put on)(?: my| the| some)? (.+?)(?: playlist)? on spotify$/, /^(?:play|put on)(?: my| the)? (.+?) playlist$/],
    resolve: (m) => tool('media.spotify_search', { query: `${m[1].trim()}${/playlist/.test(m[0]) ? ' playlist' : ''}` }) }),

  cmd({ id: 'web.open', category: 'Web', tool: 'web.open', description: 'Open a website.', examples: ['open youtube.com', 'go to github.com', 'open the official website of python.org'],
    patterns: [/^(?:open|go to|visit|browse to|navigate to)(?: the)?(?: official)?(?: website| site| page)?(?: of| for)? ((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/],
    resolve: (m, _t, ctx) => openSite(m[1], m[1].replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0], ctx) }),

  // ---------- windows ----------
  cmd({ id: 'windows.list', category: 'Windows', tool: 'windows.list', description: 'List open apps.', examples: ['show me my open applications', 'what apps are open'],
    patterns: [/what (apps|applications|windows|programs)( are| do i have)? open|show (me )?(my )?open (apps|applications|windows|programs)|list (my )?(open )?windows/], resolve: () => tool('windows.list') }),
  cmd({ id: 'windows.show_desktop', category: 'Windows', tool: 'windows.show_desktop', description: 'Minimize everything / restore everything.', examples: ['minimize everything', 'show the desktop', 'restore all windows'],
    patterns: [/minimi[sz]e (everything|all( (the )?windows)?)|show (me )?(the )?desktop/, /(restore|bring back) (all|every) (the )?windows|undo minimi[sz]e all/],
    resolve: (_m, text) => tool('windows.show_desktop', { undo: /restore|bring back|undo/.test(text) }) }),
  cmd({ id: 'windows.previous', category: 'Windows', tool: 'windows.previous', description: 'Switch to the previous window.', examples: ['switch to the previous window', 'go back to the last window'],
    patterns: [/(switch|go( back)?) to the (previous|last|other) (window|app)/], resolve: () => tool('windows.previous') }),
  cmd({ id: 'windows.arrange', category: 'Windows', tool: 'windows.arrange', description: 'Minimize, maximize, restore or snap windows.', examples: ['minimize the current window', 'maximize this window', 'put the browser on the left', 'move the editor to the right'],
    patterns: [/^(minimi[sz]e|maximi[sz]e|restore)(?: the| this| that| my)?(?: current)?(?: (.+?))?(?: window)?$/, /^(?:put|move|snap|place) (?:the |my )?(.+?) (?:on |to )(?:the )?(left|right)(?: side| half)?$/, /^snap (?:this|the current) window (left|right)$/],
    resolve: (m, text) => {
      const snap = text.match(/(left|right)/);
      if (/^(put|move|snap|place)/.test(text) && snap) {
        const q = m[1] && !/^(left|right)$/.test(m[1]) && !/^(this|it|the current)( window)?$/.test(m[1]) ? m[1] : undefined;
        return tool('windows.arrange', { action: snap[1] === 'left' ? 'snap_left' : 'snap_right', ...(q ? { query: q } : {}) });
      }
      const verb = m[1].startsWith('minim') ? 'minimize' : m[1].startsWith('maxim') ? 'maximize' : 'restore';
      const q = m[2]?.replace(/ window$/, '').trim();
      return tool('windows.arrange', { action: verb, ...(q && !/^(current|this|that|window|app)$/.test(q) ? { query: q } : {}) });
    } }),
  cmd({ id: 'windows.close', category: 'Windows', tool: 'windows.close', description: 'Close a window (confirmed; the app may ask to save).', examples: ['close this window', 'close it', 'close notepad'],
    patterns: [/^close(?: the| this| that| my)?(?: current)?(?: (.+?))?(?: window| app)?$/],
    resolve: (m) => {
      const q = m[1]?.trim();
      if (q && /^(conversation|chat|session)$/.test(q)) return builtin('new_session');
      return tool('windows.close', q && !/^(current|this|that|window|app)$/.test(q) ? { query: q } : {});
    } }),
  cmd({ id: 'windows.focus', category: 'Windows', tool: 'windows.focus', description: 'Bring an app window to the front.', examples: ['switch to the browser', 'bring my code editor to the front', 'go to spotify'],
    patterns: [/^(?:switch|go|change|flip) (?:back )?to (?:the |my )?(.+?)(?: window| app)?$/, /^bring (?:the |my )?(.+?) (?:to the front|forward|up)$/, /^focus(?: on)? (?:the |my )?(.+)$/, /^show (?:me )?(?:the |my )?(.+?) window$/],
    resolve: (m) => (m[1] === 'it' && !m[0].includes('mode') ? tool('windows.focus', { query: 'it' }) : tool('windows.focus', { query: m[1].trim() })) }),

  cmd({ id: 'system.folder', category: 'System', tool: 'system.open_folder', description: 'Open a standard folder in File Explorer.', examples: ['show my downloads', 'open my documents', 'open my project folder', 'open the last approved workspace'],
    patterns: [/^(open|show)( me)?( my| the)? (downloads|documents|desktop|pictures|videos|home)( folder)?$/, /^(open|show)( me)?( my| the)? (project folder|workspace|last approved workspace)$/, /^(open )?(file explorer|explorer)$/],
    resolve: (m, text) => tool('system.open_folder', { folder: /explorer/.test(text) ? 'home' : /project|workspace/.test(text) ? 'workspace' : m[4] }) }),

  // ---------- web ----------
  cmd({ id: 'web.search', category: 'Web', tool: 'web.search', description: 'Search the web in your browser.', examples: ['search for the latest node documentation', 'look up electron security checklist', 'google best pizza near me'],
    patterns: [/^(?:search the web|search the internet|search online|search|google|look up|bing|find (?:information|info|out) (?:on|about))(?: for| about)? (.+)$/, /^(?:find|search for) (?:the )?(?:official )?(?:installation guide|docs|documentation|website) (?:for|of) (.+)$/],
    resolve: (m) => tool('web.search', { query: m[1] }),
    fill: (answer) => tool('web.search', { query: answer }) }),

  // ---------- apps (generic, last) ----------
  // Lowest priority before "open <app>": find my file, missing routine, plain "play X".
  ...BLUEPRINT_LAST,
  cmd({ id: 'apps.open', category: 'Apps', tool: 'apps.open', description: 'Open an approved application or alias.', examples: ['open chrome', 'launch spotify', 'open vs code', 'start notepad', 'open it again'],
    patterns: [/^(?:open|launch|start|run|fire up|load)(?: up)? (.+)$/, /^(?:open|launch|start)$/],
    resolve: (m, _t, ctx) => openTarget(m[1] ?? '', ctx),
    fill: (answer, p, ctx) => {
      if (typeof p.query === 'string') {
        if (YES.test(answer)) return tool('web.search', { query: p.query });
        if (NO.test(answer)) return builtin('cancel');
        return null;
      }
      return openTarget(answer, ctx);
    } }),
];

/** Handlers that only answer a question Clickyy asked (never matched on their own). */
export const FOLLOW_UPS: CommandDef[] = [
  cmd({ id: 'web.browser', category: 'Web', description: 'Answer to "Chrome or Edge?" (say "always Chrome" to remember).', examples: ['chrome', 'edge', 'always chrome', 'the default one'],
    patterns: [], fillFirst: true, resolve: () => null,
    fill: (answer, p) => {
      const b = answer.match(BROWSER_WORD);
      const remember = /\b(always|from now on|every time|remember( that)?|by default|all the time|forever)\b/.test(answer);
      const browser: BrowserId | null = b ? browserId(b[1]) : /\b(default|any|either|whatever|you (choose|pick|decide)|doesnt matter|dont care|normal)\b/.test(answer) || YES.test(answer) ? 'default' : null;
      if (!browser) return NO.test(answer) ? builtin('cancel') : null;
      return builtin('open_with_browser', { tool: p.tool, args: p.args, browser, remember });
    } }),
];

export const CATALOG_BY_ID = new Map([...CATALOG, ...FOLLOW_UPS].map((c) => [c.id, c]));
