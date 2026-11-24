/** Second evaluation set, written after the brain's first release: guards against regressions in rules + brain together. */
import { expect, it } from 'vitest';
import { Brain } from '../src/main/assistant/brain';
import { normalize } from '../src/main/assistant/normalize';
import { route } from '../src/main/assistant/router';
const POS2: Array<[string, string]> = [
  ['how much power does my laptop have left', 'system.battery'], ['is my notebook plugged into the wall', 'system.battery'], ['what o clock is it', 'system.time'],
  ['what is the date', 'system.time'], ['capture my display', 'screen.screenshot'], ['take a quick screenshot of everything', 'screen.screenshot'],
  ['mute my speakers', 'audio.mute'], ['make the pc quiet', 'audio.mute'], ['turn my audio back on', 'audio.unmute'], ['what level is the sound at', 'audio.get'],
  ['what music is this', 'media.now'], ['who is singing right now', 'media.now'], ['pause this track', 'media.pause'], ['stop the song for now', 'media.pause'],
  ['start the music back up', 'media.play'], ['skip ahead to the next song', 'media.next'], ['play the earlier song again', 'media.previous'], ['switch the music off', 'media.stop'],
  ['lock my machine', 'system.lock'], ['how long has this pc been up', 'system.uptime'], ['is my wifi working', 'system.network'], ['how much room is left on my disk', 'system.disk'],
  ['which apps are hogging memory', 'system.processes'], ['open up task manager for me', 'system.task_manager'], ['list the windows i have open', 'windows.list'],
  ['be quiet now', 'conv.stop'], ['forget about it', 'conv.cancel'], ['clicky are you there', 'conv.presence'], ['thank you very much', 'conv.thanks'], ['bye bye', 'conv.end'],
  ['what kind of things can you do', 'conv.capabilities'], ['are you a real person', 'conv.identity'], ['repeat what you just said', 'conv.repeat'], ['talk a little slower', 'conv.slower'],
  ['shorter answers please', 'conv.brief'], ['start a brand new chat', 'conv.new'], ['show me my to do list', 'todo.list'], ['what have you remembered about me', 'memory.list'],
  ['run a health check on my computer', 'skill.system_report'], ['read out what i copied', 'skill.clipboard_read'], ['is the microphone on', 'status.mic'], ['stop the computer from restarting', 'power.abort'],
];
const NEG2 = [
  'how does a lithium battery work', 'what time is the cricket final', 'how do i screenshot on android', 'why is music good for the brain', 'who is the lead singer of coldplay',
  'what is the best lock for a bike', 'how long is a football match', 'what is a wifi router', 'how much space is in the universe', 'what are computer processes',
  'can you explain task management', 'write a thank you note for my teacher', 'how do i say goodbye in japanese', 'what can artificial intelligence do', 'are robots dangerous',
  'how do i speak more confidently', 'give me a short summary of the cold war', 'what should i add to my to do list today', 'what do elephants remember', 'how do i check my health at home',
  'how can i copy text on a phone', 'how do microphones work', 'what happens when a computer restarts', 'how many people live in mumbai', 'how big is the pacific ocean',
  'what is it like on mars', 'how much does a gaming pc cost', 'where is the nearest hospital', 'what is the population there', 'how loud is a jet engine',
];
it('rules and brain handle reworded commands without acting on questions', () => {
  const b = new Brain(); let rules = 0, brainRight = 0, brainWrong = 0, combined = 0; const miss: string[] = [];
  for (const [p, id] of POS2) {
    const r = route(p, { session: {}, apps: [] });
    const ruleOk = r.kind === 'commands' && r.steps[0].commandId === id;
    if (ruleOk) { rules++; combined++; continue; }
    if (r.kind === 'commands') { miss.push(`RULE-OTHER ${p} -> ${r.steps.map((s) => s.commandId)}`); continue; }
    const g = b.guess(normalize(p));
    if (g && g.confidence >= Brain.ACT) { if (g.commandId === id) { brainRight++; combined++; } else { brainWrong++; miss.push(`BRAIN-WRONG ${p} -> ${g.commandId}`); } }
    else miss.push(`unhandled ${p} -> ${g?.commandId} ${g?.confidence?.toFixed(2)}`);
  }
  let falseAct = 0; const fa: string[] = [];
  for (const q of NEG2) { const r = route(q, { session: {}, apps: [] }); if (r.kind !== 'none') continue; const g = b.guess(normalize(q)); if (g && g.confidence >= Brain.ACT) { falseAct++; fa.push(`FALSE ${q} -> ${g.commandId}`); } }
  expect(brainWrong, miss.join('\n')).toBe(0);
  expect(falseAct, fa.join('\n')).toBe(0);
  expect(combined).toBeGreaterThanOrEqual(28);
});
