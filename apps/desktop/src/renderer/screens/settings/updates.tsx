import { useState } from 'react';
import type { Settings } from '@shared/settings';
import { Badge, Button, Row, Section, Toggle } from '../../components/ui';
import { notify, store, useStore } from '../../state/store';
import { call } from '../../api';
import type { Update } from '../Settings';

const STATE_LABEL: Record<string, { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' | 'gold' | 'cyan' }> = {
  idle: { text: 'not checked yet', tone: 'muted' }, checking: { text: 'checking…', tone: 'cyan' }, none: { text: 'up to date', tone: 'ok' },
  available: { text: 'update available', tone: 'gold' }, downloading: { text: 'downloading…', tone: 'cyan' }, ready: { text: 'ready to install', tone: 'gold' },
  installing: { text: 'installing…', tone: 'cyan' }, error: { text: 'problem', tone: 'danger' }, disabled: { text: 'off in Strict Offline', tone: 'muted' },
};

export function UpdatesSection({ s, update }: { s: Settings; update: Update }) {
  const u = useStore((x) => x.update);
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    try { store.set({ update: await call('updates:check'), updateDismissed: undefined }); }
    catch (e) { notify('error', (e as Error).message); }
    finally { setBusy(false); }
  };
  const st = STATE_LABEL[u?.state ?? 'idle'];
  const canInstall = u && ['available', 'ready', 'error'].includes(u.state) && !!u.latest && u.latest !== u.current;
  return (
    <>
      <Section title="Updates" description="Clickyy updates itself from its GitHub releases: it checks quietly, shows an Update button when a new version is out, and installs it in place (no admin prompt, settings and history kept). Every download is checked against the published SHA-256 checksum. You can also say “check for updates”.">
        <Row label="Installed version"><span className="selectable text-[0.9em]">{u?.current ?? '…'}</span></Row>
        <Row label="Status" hint={u?.message}>
          <Badge tone={st.tone}>{u?.latest && u.state !== 'none' ? `${st.text} · ${u.latest}` : st.text}</Badge>
        </Row>
        {u?.checkedAt && <Row label="Last checked"><span className="text-[0.85em] text-muted">{new Date(u.checkedAt).toLocaleString()}</span></Row>}
        {u?.notes && u.state === 'available' && <p className="selectable rounded-lg border border-line bg-surface2/50 p-2 text-[0.8em] text-muted">{u.notes}</p>}
        <Row label="Check automatically" hint="At start and every 6 hours. Never in Strict Offline mode.">
          <Toggle label="Check for updates automatically" checked={s.updates.autoCheck} onChange={(v) => void update({ updates: { autoCheck: v } })} />
        </Row>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void check()} disabled={busy || u?.state === 'downloading' || u?.state === 'installing'}>{busy ? 'Checking…' : 'Check for updates'}</Button>
          {canInstall && <Button variant="primary" onClick={() => void call('updates:install').catch((e) => notify('error', (e as Error).message))}>Update to {u!.latest}</Button>}
          {canInstall && u!.state === 'available' && <Button variant="ghost" onClick={() => void call('updates:skip').then((x) => store.set({ update: x }))}>Skip this version</Button>}
        </div>
      </Section>
      <Section title="About">
        <p className="text-[0.82em] text-muted">Clickyy AI, a private voice assistant for Windows. Built-in AI: Qwen3 1.7B (Apache License 2.0, Qwen team) running on llama.cpp (MIT License, ggml authors). Speech: Vosk, Whisper (faster-whisper) and Kokoro voices, all on this PC.</p>
        <div><Button variant="ghost" onClick={() => window.open('https://github.com/chinmoyy12/clickyy-ai/releases')}>Release notes on GitHub</Button></div>
      </Section>
    </>
  );
}
