import type { AppEntry } from '@shared/types';
import type { SessionState } from '../tools/types';
import { findApp } from '../tools/apps';
import { parseClockTime, parseDuration } from './normalize';

export type Builtin =
  | 'greeting' | 'presence' | 'capabilities' | 'repeat' | 'slower' | 'faster' | 'stop_speaking' | 'cancel'
  | 'new_session' | 'end_conversation' | 'mode' | 'verbosity' | 'status_model' | 'status_offline' | 'status_mic'
  | 'identity' | 'thanks' | 'shortcuts' | 'ui' | 'mic_pause' | 'refuse_shell' | 'how_are_you' | 'continue';

export interface RouteCtx { session: SessionState; apps: AppEntry[] }

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
  fill?(answer: string, partial: Record<string, unknown>, ctx: RouteCtx): Resolution | null;
}

const tool = (t: string, args: Record<string, unknown> = {}): Resolution => ({ kind: 'tool', tool: t, args });
const builtin = (b: Builtin, params?: Record<string, unknown>): Resolution => ({ kind: 'builtin', builtin: b, params });
const clarify = (question: string, pending?: PendingSlot): Resolution => ({ kind: 'clarify', question, pending });
const cmd = (def: CommandDef) => def;

const SETTINGS_WORDS: Record<string, string> = {
  wifi: 'wifi', bluetooth: 'bluetooth', sound: 'sound', audio: 'sound', display: 'display', screen: 'display', brightness: 'display',
  network: 'network', internet: 'network', battery: 'battery', power: 'power', sleep: 'power', notification: 'notifications', notifications: 'notifications',
  app: 'apps', apps: 'apps', startup: 'startup', privacy: 'privacy', microphone: 'microphone', mic: 'microphone', update: 'updates', updates: 'updates',
  'windows update': 'updates', accessibility: 'accessibility', 'ease of access': 'accessibility', personalization: 'personalization', wallpaper: 'personalization',
  background: 'personalization', theme: 'personalization', storage: 'storage', mouse: 'mouse', touchpad: 'mouse', keyboard: 'keyboard', date: 'date', time: 'date',
  language: 'language', region: 'language', 'default apps': 'defaultapps', focus: 'focus', 'do not disturb': 'focus',
};

const SITES: Record<string, string> = {
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', google: 'https://www.google.com', github: 'https://github.com', netflix: 'https://www.netflix.com',
  wikipedia: 'https://www.wikipedia.org', reddit: 'https://www.reddit.com', linkedin: 'https://www.linkedin.com', amazon: 'https://www.amazon.com',
  outlook: 'https://outlook.live.com', 'stack overflow': 'https://stackoverflow.com', stackoverflow: 'https://stackoverflow.com', 'chat gpt': 'https://chatgpt.com',
  claude: 'https://claude.ai', whatsapp: 'https://web.whatsapp.com', 'google maps': 'https://maps.google.com', maps: 'https://maps.google.com',
  'google drive': 'https://drive.google.com', 'google calendar': 'https://calendar.google.com', twitch: 'https://www.twitch.tv',
};

const FOLDERS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos', 'workspace'];

function openTarget(target: string, ctx: RouteCtx): Resolution {
  const t = target.replace(/^(up |the |my |a )+/, '').replace(/\s+(app|application|program)$/, '').trim();
  if (!t) return clarify('What should I open?', { commandId: 'apps.open', slot: 'app', partial: {} });
  if (/^(it|that)( again)?$/.test(t)) {
    return ctx.session.lastApp ? tool('apps.open', { app: ctx.session.lastApp.name }) : clarify('Which app do you mean?', { commandId: 'apps.open', slot: 'app', partial: {} });
  }
  if (/^(windows )?settings$/.test(t)) return tool('system.open_settings', { page: 'home' });
  const settings = t.match(/^(?:the )?(.+?) settings$/);
  if (settings && SETTINGS_WORDS[settings[1]]) return tool('system.open_settings', { page: SETTINGS_WORDS[settings[1]] });
  if (/^task manager$/.test(t)) return tool('system.task_manager');
  const folder = t.match(/^(?:(?:my|the) )?(desktop|documents|downloads|pictures|music|videos|workspace|home)(?: folder)?$/);
  if (folder && FOLDERS.concat('home').includes(folder[1]) && !(folder[1] === 'music' && findApp(ctx.apps, 'music').match)) return tool('system.open_folder', { folder: folder[1] });
  if (/^(my )?project( folder)?$|^(the )?last approved workspace$/.test(t)) return tool('system.open_folder', { folder: 'workspace' });
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/.test(t)) return tool('web.open', { url: t });
  const app = findApp(ctx.apps, t);
  if (app.match) return tool('apps.open', { app: app.match.name });
  if (app.candidates.length > 1) return clarify(`Do you mean ${app.candidates.slice(0, 3).map((a) => a.name).join(' or ')}?`, { commandId: 'apps.open', slot: 'app', partial: {} });
  if (SITES[t]) return tool('web.open', { url: SITES[t] });
  return tool('apps.open', { app: t }); // the tool explains that the app isn't approved
}

const pct = (s: string | undefined) => (s ? Math.max(0, Math.min(100, parseInt(s, 10))) : undefined);

/**
 * Ordered command catalog. The first matching pattern wins, so specific
 * commands come before generic ones ("open settings" before "open <app>").
 */
export const CATALOG: CommandDef[] = [
  // ---------- safety ----------
  cmd({ id: 'safety.refuse_shell', category: 'Safety', description: 'Refuses requests to run arbitrary shell commands or scripts.', examples: ['run powershell command', 'execute this script', 'open cmd and run del'],
    patterns: [/\b(run|execute|exec)\b.*\b(powershell|cmd|command prompt|bash|shell|script|terminal command)\b/, /\b(powershell|cmd)\b.*\b(rm|del|format|remove-item|reg delete)\b/, /\bformat (my )?(c|hard) ?(drive)?\b/, /\bdelete (system ?32|windows)\b/],
    resolve: () => builtin('refuse_shell') }),

  // ---------- conversation ----------
  cmd({ id: 'conv.stop', category: 'Conversation', description: 'Stop speaking immediately.', examples: ['stop talking', 'stop', 'quiet', 'be quiet'],
    patterns: [/^(stop|stop talking|stop speaking|quiet|be quiet|shh+|shut up|enough|hush|silence)$/], resolve: () => builtin('stop_speaking') }),
  cmd({ id: 'conv.cancel', category: 'Conversation', description: 'Cancel the current task.', examples: ['cancel that', 'never mind', 'forget it', 'go back'],
    patterns: [/^(cancel|never ?mind|forget it|abort|scratch that|go back)( that| it)?$/], resolve: () => builtin('cancel') }),
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
    patterns: [/what can you (do|help( me)? with)|^help( me)?$|what are your (skills|abilities|commands|features)|what commands/], resolve: () => builtin('capabilities') }),
  cmd({ id: 'conv.identity', category: 'Conversation', description: 'Who the assistant is (always honest that it is an AI).', examples: ['who are you', 'are you human', "what's your name"],
    patterns: [/^who are you$|what(s| is) your name|are you (a )?(human|real|person|robot|ai|bot)/], resolve: () => builtin('identity') }),
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
    patterns: [/(start )?(a )?new (conversation|chat|session)|let'?s start (over|fresh|again)|clear (the |this )?(conversation|chat)|reset (the )?conversation/], resolve: () => builtin('new_session') }),
  cmd({ id: 'conv.continue', category: 'Conversation', description: 'Resume the previous conversation.', examples: ["let's continue where we left off"],
    patterns: [/continue where we left off|pick up where we left off|resume (our|the) (last )?conversation/], resolve: () => builtin('continue') }),
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
    patterns: [/pause (voice recognition|listening)|(mute|turn off|disable) (the |your |my )?(microphone|mic)/], resolve: () => builtin('mic_pause') }),
  cmd({ id: 'ui.motion', category: 'Accessibility', description: 'Reduce or restore animations.', examples: ['reduce animations', 'turn animations back on'],
    patterns: [/(reduce|turn off|disable|less) (the )?(animations?|motion)/, /(turn on|enable|restore) (the )?(animations?|motion)/, /(animations?|motion) back on/],
    resolve: (m, text) => builtin('ui', { setting: 'reducedMotion', value: /reduce|off|disable|less/.test(text) ? 'on' : 'off' }) }),
  cmd({ id: 'ui.contrast', category: 'Accessibility', description: 'Toggle high-contrast mode.', examples: ['switch to high contrast mode', 'turn off high contrast'],
    patterns: [/high[ -]?contrast/], resolve: (_m, text) => builtin('ui', { setting: 'highContrast', value: !/(off|disable|normal)/.test(text) }) }),
  cmd({ id: 'ui.text_size', category: 'Accessibility', description: 'Change text size.', examples: ['increase the text size', 'make the text smaller'],
    patterns: [/(increase|bigger|larger|enlarge|decrease|smaller|reduce) (the )?(text|font)( size)?|(make )?(the )?(text|font) (bigger|larger|smaller)/],
    resolve: (_m, text) => builtin('ui', { setting: 'textScale', delta: /(increase|bigger|larger|enlarge)/.test(text) ? 0.1 : -0.1 }) }),

  // ---------- memory ----------
  cmd({ id: 'memory.list', category: 'Memory', tool: 'memory.list', description: 'List what Clickyy has been asked to remember.', examples: ['what do you remember about me', 'what do you know about me'],
    patterns: [/what do you (remember|know) about me|what have you (saved|remembered)|show (my )?memories/], resolve: () => tool('memory.list') }),
  cmd({ id: 'memory.save', category: 'Memory', tool: 'memory.save', description: 'Explicitly save a preference or fact.', examples: ['remember that I prefer dark roast coffee', 'remember my project is called Atlas'],
    patterns: [/^(please )?remember (that )?(.+)$/], resolve: (m) => tool('memory.save', { text: m[3] }) }),
  cmd({ id: 'memory.forget', category: 'Memory', tool: 'memory.forget', description: 'Delete saved memories matching words.', examples: ['forget about my coffee preference'],
    patterns: [/^forget (about |that |what i said about )?(.{2,})$/], resolve: (m) => tool('memory.forget', { query: m[2].replace(/^my /, '') }) }),

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
    patterns: [/task manager/], resolve: () => tool('system.task_manager') }),
  cmd({ id: 'system.settings', category: 'System', tool: 'system.open_settings', description: 'Open a Windows Settings page.', examples: ['open windows settings', 'open bluetooth settings', 'open sound settings'],
    patterns: [/^(open|show|go to|launch)( the| my)? (windows )?settings$/, /^(open|show|go to)( the| my)? (.+?) settings$/],
    resolve: (m) => (m[3] && SETTINGS_WORDS[m[3].trim()] ? tool('system.open_settings', { page: SETTINGS_WORDS[m[3].trim()] }) : m[3] && !/windows/.test(m[3]) ? clarify(`I don't have a shortcut to ${m[3]} settings. I can open Windows Settings instead.`) : tool('system.open_settings', { page: 'home' })) }),
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
    patterns: [/^mute( my| the)?( computer| pc| sound| audio| volume| speakers| everything)?$/, /turn (the )?sound off/], resolve: () => tool('audio.mute', { mute: true }) }),
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
    patterns: [/^(resume|unpause|continue)( the| my)?( music| song| video| playback| track| media)?$/, /^play( the| some| my)?( music| song| video| media)?$/], resolve: () => tool('media.control', { action: 'play' }) }),
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
    patterns: [/^(?:open|go to|visit|browse to|navigate to)(?: the)?(?: official)?(?: website| site| page)?(?: of| for)? ((?:https?:\/\/)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?)$/], resolve: (m) => tool('web.open', { url: m[1] }) }),

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
    patterns: [/^(?:search|search the web|search online|google|look up|bing|find (?:information|info|out) (?:on|about))(?: for| about)? (.+)$/, /^(?:find|search for) (?:the )?(?:official )?(?:installation guide|docs|documentation|website) (?:for|of) (.+)$/],
    resolve: (m) => tool('web.search', { query: m[1] }),
    fill: (answer) => tool('web.search', { query: answer }) }),

  // ---------- apps (generic, last) ----------
  cmd({ id: 'apps.open', category: 'Apps', tool: 'apps.open', description: 'Open an approved application or alias.', examples: ['open chrome', 'launch spotify', 'open vs code', 'start notepad', 'open it again'],
    patterns: [/^(?:open|launch|start|run|fire up|load)(?: up)? (.+)$/, /^(?:open|launch|start)$/],
    resolve: (m, _t, ctx) => openTarget(m[1] ?? '', ctx),
    fill: (answer, _p, ctx) => openTarget(answer, ctx) }),
];

export const CATALOG_BY_ID = new Map(CATALOG.map((c) => [c.id, c]));
