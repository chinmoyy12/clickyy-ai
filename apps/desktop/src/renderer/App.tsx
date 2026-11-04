import { useEffect, useMemo, useRef } from 'react';
import type { Settings } from '@shared/settings';
import type { AssistantEvent, AssistantReply, SpeechEvent } from '@shared/types';
import { prosody } from '@shared/voiceProfiles';
import { bridge, call } from './api';
import { notify, store, upsertTimeline, useStore } from './state/store';
import { Mic } from './audio/mic';
import { Speaker, chime } from './audio/tts';
import { VoiceController } from './voice/controller';
import { Orb, type OrbMode } from './components/Orb';
import { Composer, ConfirmCard, Conversation, Notices, StatusLine, TitleBar } from './components/MainView';
import { ActivityPanel } from './components/ActivityPanel';
import { SettingsScreen } from './screens/Settings';

function applyRootSettings(s: Settings) {
  const root = document.documentElement;
  root.dataset.contrast = s.ui.highContrast ? 'high' : 'normal';
  const systemReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  root.dataset.motion = s.ui.reducedMotion === 'on' || (s.ui.reducedMotion === 'system' && systemReduced) ? 'reduced' : 'full';
  root.style.setProperty('--text-scale', String(s.ui.textScale));
}

export function App() {
  const view = useStore((s) => s.view);
  const panelOpen = useStore((s) => s.panelOpen);
  const settings = useStore((s) => s.settings);
  const phase = useStore((s) => s.phase);
  const listening = useStore((s) => s.listening);
  const speaking = useStore((s) => s.speaking);
  const micMuted = useStore((s) => s.micMuted);
  const providers = useStore((s) => s.providers);
  const confirming = useStore((s) => s.confirmations.length > 0);
  const wakeFlash = useRef(0);

  const engine = useMemo(() => {
    const mic = new Mic();
    const speaker = new Speaker();
    mic.onFrame = (f) => bridge.sendAudio(f);
    mic.onLevel = (l) => store.set({ micLevel: l });
    mic.onLost = (reason) => { store.set({ micError: reason }); notify('error', reason); };
    speaker.onState = (v) => { store.set({ speaking: v }); bridge.ttsState(v); };
    speaker.onLevel = (l) => store.set({ speakLevel: l });

    const speak = async (reply: AssistantReply) => {
      const s = store.get().settings;
      if (!s || !reply.speech || s.speech.ttsEngine === 'off') return;
      const { rate, pitch } = prosody(s, reply.style);
      if (s.speech.ttsEngine === 'cloud') {
        try {
          const audio = await call('tts:cloud', { text: reply.speech });
          await speaker.playCloud(audio, s.speech.volume);
          return;
        } catch (e) {
          notify('warn', `Cloud voice unavailable (${(e as Error).message}). Using the Windows voice instead.`);
        }
      }
      try {
        await speaker.speakSystem(reply.speech, { voiceName: s.speech.voiceName, rate, pitch, volume: s.speech.volume, style: reply.style });
      } catch (e) {
        notify('warn', `${(e as Error).message} Showing text only.`);
      }
    };

    const controller = new VoiceController({
      settings: () => store.get().settings!,
      startSession: async (mode) => { await call('speech:start', { mode }); },
      stopSession: async () => { await call('speech:stop'); },
      cancelSession: async () => { await call('speech:cancel'); },
      micStart: async () => {
        try {
          await mic.start();
          store.set({ micError: null });
        } catch (e) {
          store.set({ micError: (e as Error).message });
          throw e;
        }
      },
      micStop: () => mic.stop(),
      submit: (text) => call('assistant:submit', { text, source: 'voice' }),
      speak,
      stopSpeaking: () => speaker.stop(),
      isSpeaking: () => speaker.isSpeaking,
      chime: (k) => { if (store.get().settings?.speech.chimes) chime(k); },
      onListening: (l) => store.set({ listening: l }),
      onPartial: (t) => store.set({ partial: t }),
      onError: (m) => notify('error', m),
    });
    return { mic, speaker, controller, speak };
  }, []);

  useEffect(() => {
    const { controller, speaker, speak } = engine;
    let voiceTurn = false;
    const offs = [
      bridge.on('assistant:event', (raw) => {
        const ev = raw as AssistantEvent;
        switch (ev.type) {
          case 'phase': store.set({ phase: ev.phase, phaseDetail: ev.detail, ...(ev.phase === 'idle' ? { progress: '' } : {}) }); break;
          case 'user':
            voiceTurn = ev.source === 'voice';
            store.set((s) => ({ lines: [...s.lines, { id: `u-${ev.turnId}`, role: 'user' as const, text: ev.text, at: Date.now() }].slice(-200), progress: '' }));
            break;
          case 'reply_delta':
            store.set((s) => {
              const id = `a-${ev.turnId}`;
              const existing = s.lines.find((l) => l.id === id);
              return { lines: existing ? s.lines.map((l) => (l.id === id ? { ...l, text: l.text + ev.text } : l)) : [...s.lines, { id, role: 'assistant', text: ev.text, at: Date.now(), streaming: true }] };
            });
            break;
          case 'reply': {
            const r = ev.reply;
            if (r.text) {
              store.set((s) => {
                const id = `a-${r.turnId}`;
                const line = { id, role: r.source === 'system' ? 'system' as const : 'assistant' as const, text: r.text, at: Date.now(), source: r.source, provider: r.providerLabel };
                return { lines: s.lines.some((l) => l.id === id) ? s.lines.map((l) => (l.id === id ? line : l)) : [...s.lines, line].slice(-200), progress: '' };
              });
            }
            // Voice turns hand speech + follow-up to the controller; typed turns and reminders are spoken directly.
            if (!voiceTurn || r.source === 'system') {
              if (r.source === 'system' || !speaker.isSpeaking) void speak(r);
            }
            break;
          }
          case 'progress': store.set({ progress: ev.text }); break;
          case 'tool': upsertTimeline(ev.call); break;
          case 'confirm': store.set((s) => ({ confirmations: [...s.confirmations, ev.request] })); break;
          case 'confirm_resolved': store.set((s) => ({ confirmations: s.confirmations.filter((c) => c.id !== ev.id) })); break;
          case 'speech_control': if (ev.action === 'stop') speaker.stop(); break;
          case 'network': store.set({ network: { active: ev.active, host: ev.host } }); break;
          case 'notice': notify(ev.level, ev.text); break;
          case 'session_reset': store.set({ lines: [], timeline: [], partial: '', progress: '' }); break;
        }
      }),
      bridge.on('speech:event', (raw) => {
        const ev = raw as SpeechEvent;
        if (ev.type === 'status') {
          store.set({ speech: ev.status });
          if (ev.status.state === 'ready') void controller.refresh();
          return;
        }
        if (ev.type === 'wake') {
          store.set({ phase: 'wake_detected' });
          wakeFlash.current = window.setTimeout(() => { if (store.get().phase === 'wake_detected') store.set({ phase: 'idle' }); }, 700);
        }
        void controller.handleSpeech(ev);
      }),
      bridge.on('settings:changed', (raw) => {
        const s = raw as Settings;
        store.set({ settings: s });
        applyRootSettings(s);
        void controller.refresh();
        void call('providers:status').then((p) => store.set({ providers: p })).catch(() => {});
      }),
      bridge.on('ui:command', (raw) => {
        const { cmd } = raw as { cmd: string };
        if (cmd === 'mic_mute') { store.set({ micMuted: true }); void controller.setMuted(true); }
        if (cmd === 'mic_toggle') { const m = !store.get().micMuted; store.set({ micMuted: m }); void controller.setMuted(m); notify('info', m ? 'Microphone muted' : 'Microphone on'); }
      }),
    ];

    const onSubmitText = (e: Event) => {
      const text = (e as CustomEvent<string>).detail;
      speaker.stop();
      void call('assistant:submit', { text, source: 'text' }).catch((err) => notify('error', (err as Error).message));
    };
    window.addEventListener('clickyy:submit-text', onSubmitText);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (store.get().view === 'settings') { store.set({ view: 'main' }); return; }
        void call('assistant:cancel');
        void controller.stop();
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'l') { e.preventDefault(); window.dispatchEvent(new Event('clickyy:focus-input')); }
    };
    window.addEventListener('keydown', onKey);

    void (async () => {
      try {
        const s = await call('settings:get');
        store.set({ settings: s });
        applyRootSettings(s);
        store.set({ speech: await call('speech:status') });
        store.set({ providers: await call('providers:status') });
        await controller.refresh();
      } catch (e) {
        notify('error', (e as Error).message);
      }
    })();
    const poll = setInterval(() => void call('providers:status').then((p) => store.set({ providers: p })).catch(() => {}), 30_000);

    return () => {
      offs.forEach((o) => o());
      window.removeEventListener('clickyy:submit-text', onSubmitText);
      window.removeEventListener('keydown', onKey);
      clearInterval(poll);
      clearTimeout(wakeFlash.current);
      controller.dispose();
    };
  }, [engine]);

  if (!settings) {
    return <div className="flex h-full items-center justify-center"><span className="wordmark text-xs text-gold">CLICKYY</span></div>;
  }

  const reduced = document.documentElement.dataset.motion === 'reduced';
  const orbMode: OrbMode =
    phase === 'error' ? 'error'
      : phase === 'confirming' ? 'confirming'
        : listening === 'command' ? 'listening'
          : speaking ? 'speaking'
            : phase !== 'idle' ? phase
              : micMuted ? 'muted'
                : providers && !providers.online && providers.active === 'none' ? 'offline'
                  : 'idle';

  return (
    <div className="flex h-full flex-col">
      <TitleBar />
      <Notices />
      {view === 'settings' ? (
        <SettingsScreen onPreview={(text) => void engine.speak({ turnId: 'preview', text, speech: text, style: 'warm', source: 'system', expectFollowUp: false })} />
      ) : (
        <>
          <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-hidden">
            <Orb mode={orbMode} reducedMotion={reduced} size={panelOpen || confirming ? 120 : 210} />
            <StatusLine mode={orbMode} />
            <Conversation />
          </main>
          <ConfirmCard />
          <Composer
            onTalk={() => void engine.controller.pressTalk()}
            onTalkEnd={() => void engine.controller.releaseTalk()}
            onStop={() => { void call('assistant:cancel'); void engine.controller.stop(); }}
            onToggleMute={() => { const m = !store.get().micMuted; store.set({ micMuted: m }); void engine.controller.setMuted(m); }}
            onConversation={() => void engine.controller.startConversation()}
          />
          {panelOpen && <ActivityPanel reducedMotion={reduced} />}
        </>
      )}
    </div>
  );
}
