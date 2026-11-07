import type { ToolSpec } from '../providers/types';

/**
 * Small local models (1–8B) call the wrong tool when shown dozens of them, and long
 * tool lists slow them down on CPU. For those models we offer only the tools that
 * plausibly match the request, and none for plain questions.
 */
const TOPICS: Array<{ words: RegExp; tools: string[] }> = [
  { words: /\b(volume|sound|loud|louder|quiet|quieter|speakers?|mute|unmute|audio)\b/, tools: ['audio__set_volume', 'audio__mute', 'audio__get_volume', 'audio__restore_volume'] },
  { words: /\b(music|song|track|playlist|play|pause|resume|skip|spotify|media)\b/, tools: ['media__control', 'media__now_playing', 'media__spotify_search'] },
  { words: /\b(open|launch|start|run|app|application|program)\b/, tools: ['apps__open', 'system__open_folder', 'web__open'] },
  { words: /\b(window|windows|switch to|focus on|minimi[sz]e|maximi[sz]e|snap|(on|to) the (left|right)|arrange|desktop|close)\b/, tools: ['windows__focus', 'windows__arrange', 'windows__list', 'windows__close', 'windows__show_desktop', 'windows__previous'] },
  { words: /\b(battery|charging|cpu|processor|ram|memory|disk|storage|space|network|internet|wi-?fi|uptime|process(es)?|device)\b/, tools: ['system__battery', 'system__resources', 'system__disk', 'system__network', 'system__uptime', 'system__processes', 'system__audio_devices'] },
  { words: /\b(settings?|bluetooth|display|brightness|task manager|lock)\b/, tools: ['system__open_settings', 'system__task_manager', 'system__lock'] },
  { words: /\b(time|date|day|today)\b/, tools: ['system__time'] },
  { words: /\b(remind|reminder|timer|alarm|focus|pomodoro|schedule)\b/, tools: ['reminders__create', 'timers__create', 'reminders__list', 'reminders__cancel'] },
  { words: /\b(search|google|look up|website|site|browse|url|link|youtube|amazon|wikipedia|github|reddit|chrome|edge|firefox|browser)\b/, tools: ['web__search_site', 'web__search', 'web__open'] },
  { words: /\b(device manager|control panel|services|event viewer|disk management|registry|firewall|system information|recycle bin|folder)\b/, tools: ['system__open_tool', 'system__open_special_folder'] },
  { words: /\btime\b.*\bin\b|\btime zone|\bclock\b/, tools: ['clock__world'] },
  { words: /\b(coin|dice|die|random)\b/, tools: ['fun__random'] },
  { words: /\b(days? (until|till|to|since)|how long until|christmas|birthday|holiday|easter|new year)\b/, tools: ['date__until'] },
  { words: /\b(currency|exchange rate|dollars?|euros?|rupees?|pounds? sterling|yen|usd|inr|eur|gbp)\b/, tools: ['currency__convert'] },
  { words: /\b(weather|temperature|rain|forecast|umbrella|snow)\b/, tools: ['weather__current'] },
  { words: /\b(calculate|plus|minus|times|divided|percent|square root|math|\d+\s*[-+*/^x]\s*\d+)\b/, tools: ['math__calculate'] },
  { words: /\b(convert|miles?|km|kilometers?|pounds?|kg|celsius|fahrenheit|liters?|gallons?|inches|feet)\b/, tools: ['units__convert'] },
  { words: /\b(files?|folder|document|report|rename|move|notes?)\b/, tools: ['files__search', 'files__list', 'files__read_text', 'files__open', 'files__create', 'files__move'] },
  { words: /\b(clipboard|copy|copied|paste)\b/, tools: ['clipboard__copy', 'clipboard__read'] },
  { words: /\b(type|press|shortcut|keyboard)\b/, tools: ['keyboard__shortcut', 'keyboard__type'] },
  { words: /\b(shut ?down|restart|reboot|sign out|log off)\b/, tools: ['power__action', 'power__abort'] },
];

const QUESTION = /^(why|what is|what are|what's a|who|when did|where is|how (do|does|did|can|is|are)|explain|tell me|describe|define|write|compose|summari[sz]e|translate|give me (an?|some) (idea|example|joke|fact)|can you (explain|tell))\b/i;
const ACTION = /\b(open|launch|set|turn|mute|play|pause|skip|switch|close|minimi[sz]e|maximi[sz]e|remind|start|search|convert|calculate|lock|restart|shut|move|rename|create|copy|type|press)\b/i;

export function selectTools(text: string, tools: ToolSpec[], max = 6): ToolSpec[] {
  const t = text.toLowerCase();
  if (QUESTION.test(t.trim()) && !ACTION.test(t)) return [];
  // Round-robin across matched topics so one broad topic can't crowd out the others.
  const matched = TOPICS.filter((topic) => topic.words.test(t)).map((topic) => [...topic.tools]);
  const wanted: string[] = [];
  while (wanted.length < max && matched.some((q) => q.length)) {
    for (const q of matched) {
      const name = q.shift();
      if (name && !wanted.includes(name) && wanted.length < max) wanted.push(name);
    }
  }
  const byName = new Map(tools.map((x) => [x.name, x]));
  return wanted.map((n) => byName.get(n)).filter((x): x is ToolSpec => !!x);
}
