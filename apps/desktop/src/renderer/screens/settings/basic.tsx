import { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { VOICE_PROFILES, WAKE_PHRASES, WAKE_PHRASE_LABELS, type Settings } from '@shared/settings';
import { PROFILES } from '@shared/voiceProfiles';
import { Badge, Button, Row, Section, Select, Slider, TextInput, Toggle } from '../../components/ui';
import { useStore } from '../../state/store';
import { call } from '../../api';
import { waitForVoices, type VoiceInfo } from '../../audio/tts';
import type { ModelDownloadStatus, NeuralVoice } from '@shared/types';
import type { Update } from '../Settings';

type P = { s: Settings; update: Update };

export function GeneralSection({ s, update }: P) {
  const [name, setName] = useState(s.assistantName);
  const [address, setAddress] = useState(s.userAddress);
  const [g, setG] = useState(s.ui.globalShortcut);
  const [m, setM] = useState(s.ui.muteShortcut);
  return (
    <>
      <Section title="Identity">
        <Row label="Assistant name" hint="Used in replies and the system prompt. Wake phrases are configured separately.">
          <TextInput label="Assistant name" value={name} onChange={setName} className="w-40" />
        </Row>
        <Row label="How should I address you?" hint="Optional. Leave empty for no name.">
          <TextInput label="Preferred form of address" value={address} onChange={setAddress} placeholder="e.g. Alex" className="w-40" />
        </Row>
        <div><Button variant="primary" onClick={() => void update({ assistantName: name || 'Clickyy', userAddress: address })}>Save identity</Button></div>
      </Section>
      <Section title="Window & startup">
        <Row label="Always on top"><Toggle label="Always on top" checked={s.ui.alwaysOnTop} onChange={(v) => void update({ ui: { alwaysOnTop: v } })} /></Row>
        <Row label="Closing the window" hint="The tray icon menu always has Quit.">
          <Select label="Close behavior" value={s.ui.closeBehavior} onChange={(v) => void update({ ui: { closeBehavior: v } })} options={[{ value: 'tray', label: 'Hide to tray' }, { value: 'quit', label: 'Quit Clickyy' }]} />
        </Row>
        <Row label="Launch at sign-in" hint="Off by default. When on, Clickyy starts hidden in the tray. The microphone still only opens when you enable listening.">
          <Toggle label="Launch at sign-in" checked={s.ui.launchAtLogin} onChange={(v) => void update({ ui: { launchAtLogin: v } })} />
        </Row>
        <Row label="Start hidden in tray"><Toggle label="Start hidden" checked={s.ui.startHidden} onChange={(v) => void update({ ui: { startHidden: v } })} /></Row>
      </Section>
      <Section title="Proactive alerts" description="Clickyy speaks up on its own when something needs your attention. Everything is checked locally.">
        <Row label="Low battery warning"><div className="flex items-center gap-2"><Slider label="Battery threshold" value={s.proactive.batteryThreshold} min={5} max={50} step={5} onChange={(v) => void update({ proactive: { batteryThreshold: v } })} format={(v) => `${v}%`} /><Toggle label="Battery alert" checked={s.proactive.batteryAlert} onChange={(v) => void update({ proactive: { batteryAlert: v } })} /></div></Row>
        <Row label="High CPU warning" hint="After about 3 minutes above the threshold, at most every 30 minutes."><div className="flex items-center gap-2"><Slider label="CPU threshold" value={s.proactive.cpuThreshold} min={50} max={100} step={5} onChange={(v) => void update({ proactive: { cpuThreshold: v } })} format={(v) => `${v}%`} /><Toggle label="CPU alert" checked={s.proactive.cpuAlert} onChange={(v) => void update({ proactive: { cpuAlert: v } })} /></div></Row>
      </Section>
      <Section title="Keyboard shortcuts" description="Global shortcuts work from any app. Use Electron accelerator syntax, e.g. Control+Shift+Space. Inside the window: Esc stops everything, Ctrl+L focuses the text box.">
        <Row label="Show / hide Clickyy"><TextInput label="Show/hide shortcut" value={g} onChange={setG} className="w-44" /></Row>
        <Row label="Mute / unmute microphone"><TextInput label="Mute shortcut" value={m} onChange={setM} className="w-44" /></Row>
        <div><Button onClick={() => void update({ ui: { globalShortcut: g, muteShortcut: m } })}>Apply shortcuts</Button></div>
      </Section>
    </>
  );
}

export function VoiceSection({ s, update, onPreview }: P & { onPreview: (t: string) => void }) {
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [neural, setNeural] = useState<NeuralVoice[]>([]);
  const speech = useStore((x) => x.speech);
  useEffect(() => { void waitForVoices().then(setVoices); }, []);
  useEffect(() => { void call('tts:voices').then(setNeural).catch(() => setNeural([])); }, [speech.neural]);
  const local = voices.filter((v) => v.local);
  const female = neural.filter((v) => v.gender === 'female');
  return (
    <>
      <Section title="Voice engine" description="The neural voice runs fully offline and sounds close to human. Windows voices are a lighter offline fallback. A cloud voice sends the reply text to the provider.">
        <Row label="Speech output" hint={s.speech.ttsEngine === 'neural' && !speech.neural ? 'Neural voice model not installed, so Clickyy is using the Windows voice.' : undefined}>
          <Select label="Speech engine" value={s.speech.ttsEngine} onChange={(v) => void update({ speech: { ttsEngine: v } })}
            options={[{ value: 'neural', label: 'Neural voice (offline, natural)' }, { value: 'system', label: 'Windows voice (offline)' }, { value: 'cloud', label: 'Cloud voice (online)' }, { value: 'off', label: 'Off — text only' }]} />
        </Row>
        {s.speech.ttsEngine === 'neural' && neural.length > 0 && (
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
            {[...female, ...neural.filter((v) => v.gender !== 'female')].map((v) => (
              <button key={v.id} onClick={() => void update({ speech: { neuralVoice: v.id } }).then(() => onPreview(`Hi, I'm ${s.assistantName}. This is my ${v.accent.split(' ')[0]} voice.`))}
                aria-pressed={s.speech.neuralVoice === v.id}
                className={`rounded-lg border px-2 py-1.5 text-left text-[0.8em] ${s.speech.neuralVoice === v.id ? 'border-gold/70 bg-gold/10 text-gold' : 'border-line text-ink hover:border-gold/40'}`}>
                <div className="font-medium">{v.name}</div>
                <div className="text-[0.85em] text-muted">{v.gender} · {v.accent.replace(' English', '')}</div>
              </button>
            ))}
          </div>
        )}
        {s.speech.ttsEngine === 'cloud' && (
          <>
            <Row label="Cloud voice provider" hint="Uses that provider's key from Credentials.">
              <Select label="Cloud voice provider" value={s.speech.cloudTtsProvider} onChange={(v) => void update({ speech: { cloudTtsProvider: v } })}
                options={[{ value: 'openai', label: 'OpenAI' }, { value: 'openai_compatible', label: 'Custom OpenAI-compatible' }]} />
            </Row>
            <Row label="Cloud voice name" hint="Provider-specific, e.g. nova, shimmer, coral, sage.">
              <TextInput label="Cloud voice" value={s.speech.cloudVoice} onChange={(v) => void update({ speech: { cloudVoice: v.slice(0, 64) } })} className="w-32" />
            </Row>
          </>
        )}
        <Row label="Windows voice" hint={voices.length ? `${local.length} offline voice${local.length === 1 ? '' : 's'} installed. Add more in Windows Settings > Time & language > Speech.` : 'Loading voices…'}>
          <Select label="Voice" value={s.speech.voiceName || ''} onChange={(v) => void update({ speech: { voiceName: v } })}
            options={[{ value: '', label: 'Auto (prefer feminine voice)' }, ...voices.map((v) => ({ value: v.name, label: `${v.name.replace(/^Microsoft /, '')}${v.local ? '' : ' (online)'}` }))]} />
        </Row>
        <Row label="Speed"><Slider label="Speech speed" value={s.speech.rate} min={0.5} max={2} step={0.05} onChange={(v) => void update({ speech: { rate: v } })} format={(v) => `${v.toFixed(2)}×`} /></Row>
        <Row label="Pitch" hint="Supported by Windows voices; ignored by cloud voices."><Slider label="Pitch" value={s.speech.pitch} min={0.5} max={1.5} step={0.05} onChange={(v) => void update({ speech: { pitch: v } })} format={(v) => v.toFixed(2)} /></Row>
        <Row label="Volume"><Slider label="Speech volume" value={s.speech.volume} min={0} max={1} step={0.05} onChange={(v) => void update({ speech: { volume: v } })} format={(v) => `${Math.round(v * 100)}%`} /></Row>
        <Row label="Response chimes"><Toggle label="Chimes" checked={s.speech.chimes} onChange={(v) => void update({ speech: { chimes: v } })} /></Row>
        <div><Button variant="primary" onClick={() => onPreview(PROFILES[s.personality.profile].sample)}><Play size={13} className="mr-1 inline" />Preview current voice</Button></div>
      </Section>
      <Section title="Installed voices" description="Comparison of voices available on this PC. Feminine is a naming heuristic only.">
        <table className="w-full text-left text-[0.82em]">
          <thead className="text-muted"><tr><th className="py-1">Voice</th><th>Language</th><th>Offline</th><th /></tr></thead>
          <tbody>
            {voices.map((v) => (
              <tr key={v.name} className="border-t border-line">
                <td className="py-1.5">{v.name.replace(/^Microsoft /, '')} {v.feminine && <Badge tone="gold">feminine</Badge>}</td>
                <td>{v.lang}</td>
                <td>{v.local ? <Badge tone="ok">yes</Badge> : <Badge tone="warn">no</Badge>}</td>
                <td className="text-right"><Button variant="ghost" onClick={() => { void update({ speech: { voiceName: v.name } }).then(() => onPreview(`Hi, I'm ${s.assistantName}. This is how I sound with this voice.`)); }}>Try</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </>
  );
}

export function PersonalitySection({ s, update, onPreview }: P & { onPreview: (t: string) => void }) {
  return (
    <>
      <Section title="Personality profile" description="Profiles change wording and delivery (speed and pitch where the voice engine supports it). They never change confirmations or safety rules.">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {VOICE_PROFILES.map((id) => (
            <div key={id} className={`rounded-xl border p-2.5 ${s.personality.profile === id ? 'border-gold/70 bg-gold/5' : 'border-line'}`}>
              <div className="flex items-center justify-between">
                <button className="text-left" onClick={() => void update({ personality: { profile: id } })} aria-pressed={s.personality.profile === id}>
                  <div className="text-[0.9em] font-medium">{PROFILES[id].label}</div>
                  <div className="text-[0.78em] text-muted">{PROFILES[id].summary}</div>
                </button>
                <button aria-label={`Preview ${PROFILES[id].label}`} className="grid h-7 w-7 place-items-center rounded-lg text-muted hover:text-gold"
                  onClick={() => void update({ personality: { profile: id } }).then(() => onPreview(PROFILES[id].sample))}><Play size={13} /></button>
              </div>
            </div>
          ))}
        </div>
      </Section>
      <Section title="Style">
        <Row label="Response length"><Select label="Verbosity" value={s.personality.verbosity} onChange={(v) => void update({ personality: { verbosity: v } })} options={[{ value: 'brief', label: 'Brief' }, { value: 'normal', label: 'Normal' }, { value: 'detailed', label: 'Detailed' }]} /></Row>
        <Row label="Humor"><Select label="Humor" value={String(s.personality.humor) as '0' | '1' | '2'} onChange={(v) => void update({ personality: { humor: Number(v) } })} options={[{ value: '0', label: 'None' }, { value: '1', label: 'Light' }, { value: '2', label: 'Playful' }]} /></Row>
        <Row label="Formality"><Select label="Formality" value={s.personality.formality} onChange={(v) => void update({ personality: { formality: v } })} options={[{ value: 'casual', label: 'Casual' }, { value: 'balanced', label: 'Balanced' }, { value: 'formal', label: 'Formal' }]} /></Row>
        <Row label="Adaptive expression" hint="Adjusts tone to the situation (greeting, error, explanation). Based on conversation context only — Clickyy does not analyze your emotions.">
          <Toggle label="Adaptive expression" checked={s.personality.adaptiveExpression} onChange={(v) => void update({ personality: { adaptiveExpression: v } })} />
        </Row>
        <Row label="Companion mode" hint="Warmer, reflective conversation for the language model. Clickyy stays transparent that it is an AI.">
          <Toggle label="Companion mode" checked={s.personality.companionMode} onChange={(v) => void update({ personality: { companionMode: v } })} />
        </Row>
      </Section>
    </>
  );
}

function BestAccuracyModel() {
  const [m, setM] = useState<ModelDownloadStatus | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    let alive = true;
    const poll = () => void call('models:status').then((r) => { if (alive) setM(r); }).catch(() => {});
    poll();
    const t = setInterval(poll, 1000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  if (!m) return null;
  const gb = (n: number) => `${(n / 1e9).toFixed(2)} GB`;
  return (
    <Row label="Best accuracy model" hint={m.installed
      ? 'Installed: Whisper large-v3-turbo transcribes everything. Most accurate, but slower (about 8 s per sentence on an i5-11400H). Remove it to go back to the fast model.'
      : `Optional ${gb(m.total)} download from Hugging Face (pinned version, checked before use). Much better Hindi and Hinglish (measured 87% and 94% keyword accuracy against 75% and 59%), but about 3× slower: around 8 s per sentence on an i5-11400H.${m.error ? ` Last attempt: ${m.error}` : ''}`}>
      <div className="flex items-center gap-2">
        {m.downloading && <><Badge tone="warn">{Math.floor((m.done / m.total) * 100)}% of {gb(m.total)}</Badge><Button onClick={() => void call('models:cancel')}>Cancel</Button></>}
        {!m.downloading && !m.installed && <Button onClick={() => void call('models:download').then(setM)}>Download</Button>}
        {m.installed && !confirmRemove && <><Badge tone="ok">Installed</Badge><Button onClick={() => setConfirmRemove(true)}>Remove</Button></>}
        {m.installed && confirmRemove && <><span className="text-[0.8em] text-muted">Delete the {gb(m.total)} model?</span>
          <Button onClick={() => void call('models:remove', { confirm: true }).then(() => setConfirmRemove(false))}>Delete</Button>
          <Button onClick={() => setConfirmRemove(false)}>Keep</Button></>}
      </div>
    </Row>
  );
}

export function ListeningSection({ s, update }: P) {
  const speech = useStore((x) => x.speech);
  return (
    <>
      <Section title="Speech recognition engine" description="Vosk runs locally in a separate process. Audio never leaves this PC and is not stored.">
        <Row label="Status" hint={speech.message}>
          <div className="flex items-center gap-2">
            {speech.state === 'ready' ? <Badge tone="ok">{speech.engine ?? 'Vosk'} ready</Badge> : <Badge tone={speech.state === 'failed' ? 'danger' : 'warn'}>{speech.state}</Badge>}
            <Button onClick={() => void call('speech:restart')}>Restart</Button>
          </div>
        </Row>
        <Row label="Accurate recognition (Whisper)" hint={speech.accurate ? 'After you finish speaking, Whisper re-reads the audio for a near-perfect transcript (about half a second). Live captions still come from Vosk.' : 'Whisper model not installed.'}>
          <Toggle label="Accurate recognition" checked={s.speech.accurateStt} disabled={!speech.accurate} onChange={(v) => void update({ speech: { accurateStt: v } })} />
        </Row>
        <Row label="Languages" hint={speech.multilingual === false ? 'The installed Whisper model is English-only; Hindi needs the multilingual model.' : 'English + Hindi: speak either or mix them (Hinglish); detected per sentence, about 2–3 s per sentence on a laptop CPU. English only: about 1 s.'}>
          <Select label="Recognition language" value={s.speech.language} onChange={(v) => void update({ speech: { language: v } })}
            options={[{ value: 'auto', label: 'English + Hindi (auto)' }, { value: 'en', label: 'English only' }, { value: 'hi', label: 'Hindi only' }]} />
        </Row>
        <BestAccuracyModel />
      </Section>
      <Section title="Listening mode">
        <Row label="Mode">
          <Select label="Listening mode" value={s.listening.mode} onChange={(v) => void update({ listening: { mode: v }, ...(v === 'wake_word' ? { wake: { enabled: true } } : {}) })}
            options={[{ value: 'push_to_talk', label: 'Push to talk' }, { value: 'wake_word', label: 'Wake word' }, { value: 'conversation', label: 'Conversation' }]} />
        </Row>
        <p className="text-[0.8em] text-muted">
          {s.listening.mode === 'push_to_talk' && 'The microphone opens only while you hold (or click) the mic button.'}
          {s.listening.mode === 'wake_word' && 'The microphone stays open locally to detect your wake phrase. The "mic on" badge is shown the whole time. Mute any time with the mute button or shortcut.'}
          {s.listening.mode === 'conversation' && 'After each reply Clickyy listens again for the follow-up window. Say "that\'s all" or press Stop to end.'}
        </p>
        <Row label="Follow-up window" hint="How long to keep listening after a reply that expects an answer. 0 disables."><Slider label="Follow-up timeout" value={s.listening.followUpMs / 1000} min={0} max={30} step={1} onChange={(v) => void update({ listening: { followUpMs: v * 1000 } })} format={(v) => `${v}s`} /></Row>
        <Row label="Max command length"><Slider label="Command timeout" value={s.listening.commandTimeoutMs / 1000} min={2} max={30} step={1} onChange={(v) => void update({ listening: { commandTimeoutMs: v * 1000 } })} format={(v) => `${v}s`} /></Row>
        <Row label="Interrupt by wake phrase" hint="While speaking, saying the wake phrase stops speech and listens."><Toggle label="Interruptions" checked={s.listening.interruption === 'stop'} onChange={(v) => void update({ listening: { interruption: v ? 'stop' : 'ignore' } })} /></Row>
        <Row label="Interrupt just by talking" hint="Keeps the microphone open while Clickyy speaks (echo-cancelled). Start talking and it stops to listen. Works best with headphones.">
          <Toggle label="Barge-in" checked={s.listening.bargeIn} onChange={(v) => void update({ listening: { bargeIn: v } })} />
        </Row>
      </Section>
      <Section title="Wake phrases" description="Detected locally with a grammar-restricted Vosk recognizer. 'Clickyy' isn't in the model's dictionary, so it is matched through in-vocabulary sound-alikes; see docs/WAKE_WORDS.md for accuracy notes.">
        <Row label="Wake word detection"><Toggle label="Wake word enabled" checked={s.wake.enabled} onChange={(v) => void update({ wake: { enabled: v } })} /></Row>
        {WAKE_PHRASES.map((id) => (
          <Row key={id} label={`“${WAKE_PHRASE_LABELS[id]}”`} hint={speech.wakeSupport ? (speech.wakeSupport[id] ? 'Supported by the installed model' : 'Not supported by the installed model') : 'Engine not ready'}>
            <Toggle label={WAKE_PHRASE_LABELS[id]} checked={s.wake.phrases[id]} onChange={(v) => void update({ wake: { phrases: { [id]: v } } })} />
          </Row>
        ))}
        <Row label="Sensitivity" hint="Higher catches more. Below 40% Clickyy uses a strict check that almost never wakes by mistake but needs a clear “Clicky”."><Slider label="Wake sensitivity" value={s.wake.sensitivity} min={0} max={1} step={0.05} onChange={(v) => void update({ wake: { sensitivity: v } })} format={(v) => `${Math.round(v * 100)}%`} /></Row>
        <Row label="Double-check the wake word" hint={speech.wakeVerifier ? 'A second, more accurate recognizer confirms "Clicky" before Clickyy wakes, so similar words like "quickly" or "tricky" don\'t trigger it.' : 'Verifier model not installed.'}>
          <Toggle label="Verify wake word" checked={s.speech.verifyWake} disabled={!speech.wakeVerifier} onChange={(v) => void update({ speech: { verifyWake: v } })} />
        </Row>
        <Row label="Cooldown"><Slider label="Wake cooldown" value={s.wake.cooldownMs / 1000} min={0.5} max={10} step={0.5} onChange={(v) => void update({ wake: { cooldownMs: v * 1000 } })} format={(v) => `${v}s`} /></Row>
        <Row label="Activation chime"><Toggle label="Activation chime" checked={s.wake.chime} onChange={(v) => void update({ wake: { chime: v } })} /></Row>
      </Section>
    </>
  );
}

export function AppearanceSection({ s, update }: P) {
  return (
    <Section title="Appearance & accessibility" description="Clickyy is fully usable with keyboard and screen readers, and without a microphone.">
      <Row label="Reduce motion"><Select label="Reduce motion" value={s.ui.reducedMotion} onChange={(v) => void update({ ui: { reducedMotion: v } })} options={[{ value: 'system', label: 'Follow Windows' }, { value: 'on', label: 'Reduced' }, { value: 'off', label: 'Full' }]} /></Row>
      <Row label="High contrast"><Toggle label="High contrast" checked={s.ui.highContrast} onChange={(v) => void update({ ui: { highContrast: v } })} /></Row>
      <Row label="Text size"><Slider label="Text size" value={s.ui.textScale} min={0.8} max={1.6} step={0.1} onChange={(v) => void update({ ui: { textScale: Math.round(v * 10) / 10 } })} format={(v) => `${Math.round(v * 100)}%`} /></Row>
    </Section>
  );
}
