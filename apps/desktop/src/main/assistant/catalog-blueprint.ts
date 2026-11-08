/**
 * Commands from the product blueprint's example catalogue (see docs/AUDIT.md) that were missing or misrouted,
 * plus honest answers for integrations Clickyy does not have (smart home, email, calendar). Those answers
 * matter: without them the request reaches the language model, which has no tool for it and could claim
 * success ("the lights are off") that never happened.
 */
import type { Builtin, CommandDef, Resolution } from './catalog';

const tool = (t: string, args: Record<string, unknown> = {}): Resolution => ({ kind: 'tool', tool: t, args });
const builtin = (b: Builtin, params?: Record<string, unknown>): Resolution => ({ kind: 'builtin', builtin: b, params });
const say = (text: string) => builtin('say', { text });
const cmd = (def: CommandDef) => ({ atomic: true, ...def });

const ROOM = '(?:bedroom|living room|kitchen|bathroom|hall|hallway|office|study|desk|ceiling|porch|garden|outside|dining room|kids room|room)';
const DEVICE = '(?:lights?|lamps?|fans?|plugs?|smart plugs?|ac|air conditioner|heater|thermostat|tv|television|bulbs?)';

const NO_SMART_HOME = (what: string) =>
  say(`I'm not connected to any smart-home devices, so I can't control or check ${what}. Nothing was changed. Smart-home control (for example through Home Assistant) isn't built into Clickyy yet.`);

/** Matched before the conversation and window commands: narrow, fully anchored phrases. */
export const BLUEPRINT_FIRST: CommandDef[] = [
  cmd({ id: 'windows.previous_used', category: 'Windows', tool: 'windows.previous', description: 'Go back to the window you were just using.', examples: ['switch to the window i was using', 'go back to the app i was just in'],
    patterns: [/^(?:switch|go)(?: back)? to (?:the )?(?:window|app) i was (?:just )?(?:using|in|on|working (?:in|on))$/], resolve: () => tool('windows.previous') }),
  cmd({ id: 'screen.screenshot_show', category: 'Screen', tool: 'screen.save', description: 'Take a screenshot and open it.', examples: ['take a screenshot and show it to me', 'take a screenshot and open it'],
    patterns: [/^(?:take|grab|capture)(?: me)? (?:a |the )?screen ?shot (?:and|then) (?:show|open|display) it(?: to me)?$/], resolve: () => tool('screen.save', { open: true }) }),
  cmd({ id: 'windows.close_saved', category: 'Windows', tool: 'windows.close', description: 'Close the current app; it asks to save unsaved work first.', examples: ['close this app after saving my work'],
    patterns: [/^close (?:this|the|my) (?:app|window|program) (?:after saving|and save)(?: my work| it| everything)?$/],
    resolve: () => tool('windows.close', {}) }),
  cmd({ id: 'smarthome.none', category: 'Smart home', description: 'Smart-home requests (explains that no smart-home devices are connected, instead of pretending).', examples: ['turn off the bedroom lights', 'set the desk lamp to 40 percent', 'lock the front door', 'is the front door locked'],
    patterns: [
      new RegExp(`^(?:turn|switch) (?:on|off) (?:all )?(?:the |my )?(?:${ROOM} )?(${DEVICE})$`),
      /^(?:turn|switch) (?:everything|all) (?:off|on) in (?:the |my )?(.+)$/,
      /^(?:turn|switch) (?:off|on) everything in (?:the |my )?(.+)$/,
      new RegExp(`^set (?:the |my )?(?:${ROOM} )?(${DEVICE})(?: brightness| speed| level)? to .+$`),
      /^set (?:the )?(?:room|house|home|ac|thermostat) (temperature|thermostat)? ?to \d+.*$/,
      /^(lock|unlock) (?:the )?(?:front|back|garage|main|side) (?:door|gate)$/,
      /^is (?:the )?(?:front|back|garage|main|side) (door|gate) (?:locked|open|closed|unlocked)$/,
      /^(?:show|open|view) (?:me )?(?:the )?(front door|doorbell|porch|garage|security|backyard|baby) cam(?:era)?$/,
    ],
    resolve: (m, text) => {
      if (/^(lock|unlock)/.test(text) || /door|gate/.test(text)) return say("I'm not connected to any smart locks, so I can't lock, unlock or check doors. Nothing was changed. Even once smart-home support exists, unlocking doors by voice alone will stay blocked for safety.");
      return NO_SMART_HOME(m[1] ? `the ${m[1]}` : 'that device');
    } }),
  cmd({ id: 'email.none', category: 'Communication', description: 'Reading or searching your inbox (explains that no email account is connected).', examples: ['find the latest email from the college', 'read my emails', 'send this email to the selected recipient'],
    patterns: [
      /^(?:find|read|check|show|open|search)(?: me)? (?:my |the )?(?:latest |last |newest |recent |new |unread )?(?:emails?|mails?|messages?) (?:from|about|by) .+$/,
      /^(?:read|check|show)(?: me)? (?:my )?(?:new |unread )?(?:emails?|inbox|mail)$/,
      /^send (?:this|that|the) (?:email|mail|reply|message)(?: .+)?$/,
    ],
    resolve: (_m, text) => (/^send/.test(text)
      ? say("I can't send email myself, and I never press Send for you. I open a draft in your mail app so you can check it and send it: try \"email Priya about the meeting\".")
      : say("I'm not connected to your email, so I can't read or search your inbox. Say \"open Gmail\" or \"open Outlook\" to look there. I can draft a new email for you to review: try \"email Priya about the meeting\".")) }),
  cmd({ id: 'calendar.none', category: 'Productivity', description: 'Calendar requests (explains that no calendar is connected and offers reminders).', examples: ['read my next calendar event', 'schedule a meeting for friday at 3 pm'],
    patterns: [
      /^(?:read|whats|what is|tell me|show)(?: me)? (?:my )?(?:next|upcoming|todays) (?:calendar )?(?:event|meeting|appointment)s?$/,
      /^(?:read|show|open|check) my calendar$/,
      /^(?:schedule|book|create|add|set up) (?:a |an )?(?:meeting|event|appointment|call)(?: (?:for|on|at|with) .+)?$/,
    ],
    resolve: (_m, text) => (/^(?:schedule|book|create|add|set up)/.test(text)
      ? say("I'm not connected to a calendar, so I can't create events. I can remind you instead: say \"remind me on Friday at 3 PM about the meeting\".")
      : say("I'm not connected to a calendar, so I can't read your events. Say \"what reminders do I have\" for the reminders and timers you've set with me.")) }),
  cmd({ id: 'agenda.today', category: 'Productivity', tool: 'reminders.list', description: 'What you have coming up (your Clickyy reminders and timers).', examples: ['what do i have today', 'what do i have on tomorrow'],
    patterns: [/^what (?:do i have|have i got|is on|s on)(?: on| planned| scheduled)?(?: for)? (?:today|tomorrow|this (?:morning|afternoon|evening))$/, /^what do i have (?:planned|scheduled|on)$/],
    resolve: () => tool('reminders.list') }),
  cmd({ id: 'undo.none', category: 'Conversation', description: 'Undo (explains what can and cannot be undone).', examples: ['undo the last action if possible', 'undo that'],
    patterns: [/^undo(?: (?:the|that|my|it))?(?: last)?(?: action| step| change| command| thing)?(?: if (?:possible|you can))?$/],
    resolve: () => say("I can't undo actions automatically. When I organise files I move them and never delete them, and the Activity panel shows where they went. Anything deleted goes to the Recycle Bin. For text in an app, press Control Z.") }),
  cmd({ id: 'shopping.add', category: 'Productivity', tool: 'notes.append', description: 'Add something to your shopping list (a local note).', examples: ['add milk to my shopping list', 'put eggs on the grocery list'],
    patterns: [/^(?:add|put) (.+?) (?:to|on) (?:my |the )?(?:shopping|grocery|groceries) list$/],
    resolve: (m) => tool('notes.append', { title: 'Shopping list', text: `- ${m[1].replace(/^(?:some|a|an|the)\s+/, '').trim()}` }) }),
  cmd({ id: 'shopping.read', category: 'Productivity', tool: 'notes.find', description: 'Read your shopping list.', examples: ["what's on my shopping list", 'read the grocery list'],
    patterns: [/^(?:whats|what is|read|show|tell me)(?: me)?(?: whats)?(?: on)? (?:my |the )?(?:shopping|grocery) list$/], resolve: () => tool('notes.find', { query: 'Shopping list' }) }),
  cmd({ id: 'conv.listen', category: 'Conversation', description: '"Listen to this" (answers that Clickyy is listening).', examples: ['listen to this', 'listen'],
    patterns: [/^listen(?: to (?:this|me|up))?$/], resolve: () => builtin('presence') }),
  cmd({ id: 'units.feet_inches', category: 'Utilities', description: 'Height in feet and inches to centimetres or metres.', examples: ['convert 5 feet 8 inches to centimetres', "what is 6 foot 2 in cm"],
    patterns: [/^(?:convert |what is |whats )?(\d+(?:\.\d+)?) (?:feet|foot|ft) (?:and )?(\d+(?:\.\d+)?) (?:(?:inches|inch) )?(?:to|in|into) (centimet(?:er|re)s?|cm|met(?:er|re)s?|m)$/],
    resolve: (m) => {
      const cm = parseFloat(m[1]) * 30.48 + parseFloat(m[2]) * 2.54;
      const metres = /^(?:m|met(?:er|re)s?)$/.test(m[3]); // not "centimetres", which also contains "met"
      const value = metres ? `${(cm / 100).toFixed(2)} metres` : `${Math.round(cm * 100) / 100} centimetres`;
      return say(`${m[1]} feet ${m[2]} inches is ${value}.`);
    } }),
];

/** Matched after every other command, just before the generic "open <app>". */
export const BLUEPRINT_LAST: CommandDef[] = [
  cmd({ id: 'files.find_mine', category: 'Files', tool: 'files.search', description: 'Find one of your files by name in the approved folders, newest first.', examples: ['find my latest project report', 'where is my resume'],
    patterns: [/^(?:find|locate|where is|wheres|search for|look for) my (latest |newest |most recent |last |recent )?(.+?)(?: file| document)?$/],
    resolve: (m) => {
      const name = m[2].trim();
      // Only file-like things: "find my phone" is not a file search.
      if (!m[1] && !/\b(report|file|document|doc|notes?|presentation|slides|spreadsheet|sheet|resume|cv|assignment|invoice|pdf|essay|thesis|homework|project|photo|picture|video|receipt|letter|certificate)s?\b/.test(name)) return null;
      return tool('files.search', { name, newestFirst: true });
    } }),
  cmd({ id: 'routine.missing', category: 'Automation', description: 'Asks for a routine that does not exist (explains how to create one).', examples: ['run my study routine'],
    patterns: [/^(?:run|start|do|begin|launch) (?:my |the )?(.+?) routine$/],
    resolve: (m) => say(`I don't have a routine called ${m[1]}. You can create one in Settings, Automation: give it a name, the phrases to say, and the steps to run.`) }),
  cmd({ id: 'music.play_any', category: 'Media', tool: 'music.play', description: 'Play a song, artist or mood ("play Alfaaz", "play something calm").', examples: ['play alfaaz', 'play something calm', 'play something like coldplay'],
    patterns: [/^play (.+)$/],
    resolve: (m) => {
      const q = m[1].trim();
      if (/^(?:a |some |the )?(?:game|games|video|videos|movie|movies|chess|cards|it|that|this)\b/.test(q) || /\bon (?:youtube|netflix|prime|hotstar)$/.test(q)) return null;
      const like = q.match(/^something (?:like|similar to) (.+)$/);
      const mood = q.match(/^something (.+)$/);
      const query = like ? `songs like ${like[1]}` : mood ? `${mood[1]} music` : q.replace(/^(?:some|the song)\s+/, '');
      return tool('music.play', { query: query.slice(0, 160) });
    } }),
];
