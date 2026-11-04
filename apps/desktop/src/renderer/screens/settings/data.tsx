import { useEffect, useMemo, useState } from 'react';
import { Trash2, Pencil, Check, X } from 'lucide-react';
import type { Settings } from '@shared/settings';
import type { AuditEntry, CatalogEntry, ConversationSummary, Diagnostics, Memory, StoredMessage } from '@shared/types';
import { Badge, Button, Row, Section, Slider, TextInput, Toggle, riskLabel, riskTone } from '../../components/ui';
import { notify } from '../../state/store';
import { call } from '../../api';
import type { Update } from '../Settings';

export function MemorySection() {
  const [items, setItems] = useState<Memory[]>([]);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const load = (q = query) => void call('memory:list', q ? { query: q } : undefined).then(setItems);
  useEffect(() => load(''), []);
  return (
    <>
      <Section title="Saved memories" description='Clickyy only remembers what you explicitly ask it to ("remember that…") or add here. Memories stay on this PC unless cloud reasoning is allowed, in which case they are included in requests to your cloud provider.'>
        <div className="flex gap-1">
          <TextInput label="Search memories" value={query} onChange={(v) => { setQuery(v); load(v); }} placeholder="Search…" className="flex-1" />
          <Button variant="ghost" onClick={() => void call('memory:export')}>Export</Button>
        </div>
        {items.length === 0 && <p className="text-[0.85em] text-muted">Nothing saved.</p>}
        {items.map((m) => (
          <div key={m.id} className="flex items-center gap-2 border-b border-line pb-2 last:border-0">
            {editing?.id === m.id ? (
              <>
                <TextInput label="Edit memory" value={editing.text} onChange={(t) => setEditing({ id: m.id, text: t })} className="flex-1" />
                <button aria-label="Save" onClick={() => void call('memory:update', editing).then(() => { setEditing(null); load(); })} className="text-ok"><Check size={15} /></button>
                <button aria-label="Cancel" onClick={() => setEditing(null)} className="text-muted"><X size={15} /></button>
              </>
            ) : (
              <>
                <div className="selectable min-w-0 flex-1 text-[0.88em]">{m.text}<div className="text-[0.72em] text-muted">{new Date(m.updatedAt).toLocaleDateString()}</div></div>
                <button aria-label="Edit memory" onClick={() => setEditing({ id: m.id, text: m.text })} className="text-muted hover:text-ink"><Pencil size={13} /></button>
                <button aria-label="Delete memory" onClick={() => void call('memory:delete', { id: m.id }).then(() => load())} className="text-muted hover:text-danger"><Trash2 size={13} /></button>
              </>
            )}
          </div>
        ))}
        <div className="flex gap-1">
          <TextInput label="New memory" value={draft} onChange={setDraft} placeholder="Add something to remember" className="flex-1" />
          <Button variant="primary" disabled={!draft.trim()} onClick={() => void call('memory:add', { text: draft, category: 'note' }).then(() => { setDraft(''); load(); })}>Add</Button>
        </div>
        {items.length > 0 && <div><Button variant="danger" onClick={() => { if (confirm('Delete all saved memories?')) void call('memory:clear').then(() => load()); }}>Clear all memories</Button></div>}
      </Section>
    </>
  );
}

export function HistorySection({ s, update }: { s: Settings; update: Update }) {
  const [convos, setConvos] = useState<ConversationSummary[]>([]);
  const [open, setOpen] = useState<{ id: string; messages: StoredMessage[] } | null>(null);
  const [wipe, setWipe] = useState('');
  const load = () => void call('history:list').then(setConvos);
  useEffect(load, []);
  return (
    <>
      <Section title="Privacy">
        <Row label="Save conversation history" hint="Stored locally in SQLite. Credentials are redacted before saving."><Toggle label="Save history" checked={s.privacy.saveHistory} onChange={(v) => void update({ privacy: { saveHistory: v } })} /></Row>
        <Row label="Keep history for"><Slider label="Retention days" value={s.privacy.historyRetentionDays} min={1} max={365} step={1} onChange={(v) => void update({ privacy: { historyRetentionDays: v } })} format={(v) => `${v}d`} /></Row>
        <Row label="Action audit log" hint="Records which tools ran and their outcome (redacted, last 2000 entries)."><Toggle label="Audit log" checked={s.privacy.auditLog} onChange={(v) => void update({ privacy: { auditLog: v } })} /></Row>
        <p className="text-[0.78em] text-muted">Microphone audio is never recorded to disk and is never sent to the cloud.</p>
      </Section>
      <Section title="Conversation history">
        {convos.length === 0 && <p className="text-[0.85em] text-muted">No saved conversations.</p>}
        {convos.map((c) => (
          <div key={c.id} className="flex items-center gap-2 border-b border-line pb-2 last:border-0">
            <button className="min-w-0 flex-1 text-left" onClick={() => void call('history:get', { id: c.id }).then((m) => setOpen(open?.id === c.id ? null : { id: c.id, messages: m }))}>
              <div className="truncate text-[0.88em]">{c.title}</div>
              <div className="text-[0.72em] text-muted">{new Date(c.updatedAt).toLocaleString()} · {c.messageCount} messages</div>
            </button>
            <button aria-label="Delete conversation" onClick={() => void call('history:delete', { id: c.id }).then(load)} className="text-muted hover:text-danger"><Trash2 size={13} /></button>
          </div>
        ))}
        {open && (
          <div className="selectable max-h-60 overflow-y-auto rounded-xl border border-line p-2 text-[0.82em]">
            {open.messages.map((m) => <p key={m.id} className={m.role === 'user' ? 'text-gold/90' : ''}><b>{m.role === 'user' ? 'You' : 'Clickyy'}:</b> {m.text}</p>)}
          </div>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void call('history:export')}>Export history</Button>
          <Button variant="danger" disabled={!convos.length} onClick={() => { if (confirm('Delete all conversation history?')) void call('history:clear').then(load); }}>Delete all history</Button>
        </div>
      </Section>
      <Section title="Clear all data" description="Deletes history, memories, reminders, the audit log and stored API keys. Settings and approved apps are kept. Type DELETE to confirm.">
        <div className="flex gap-1">
          <TextInput label="Type DELETE" value={wipe} onChange={setWipe} placeholder="DELETE" className="w-28" />
          <Button variant="danger" disabled={wipe !== 'DELETE'} onClick={() => void call('data:clearAll', { confirm: 'DELETE' }).then(() => { setWipe(''); load(); notify('info', 'All personal data cleared.'); })}>Clear everything</Button>
        </div>
      </Section>
    </>
  );
}

export function CommandsSection() {
  const [items, setItems] = useState<CatalogEntry[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => void call('catalog:list').then(setItems), []);
  const groups = useMemo(() => {
    const f = q.toLowerCase();
    const filtered = items.filter((c) => !f || c.description.toLowerCase().includes(f) || c.examples.some((e) => e.includes(f)));
    return [...new Set(filtered.map((c) => c.category))].map((cat) => [cat, filtered.filter((c) => c.category === cat)] as const);
  }, [items, q]);
  const total = items.reduce((n, c) => n + c.examples.length, 0);
  return (
    <Section title="Command catalog" description={`${items.length} built-in commands with ${total} tested example phrasings. Anything else goes to the language model (if configured), which can only use these same tools.`}>
      <TextInput label="Search commands" value={q} onChange={setQ} placeholder="Search, e.g. volume" />
      {groups.map(([cat, list]) => (
        <div key={cat}>
          <h4 className="mb-1 mt-2 text-[0.8em] uppercase tracking-wider text-gold/80">{cat}</h4>
          {list.map((c) => (
            <div key={c.id} className="border-b border-line py-1.5 last:border-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[0.86em]">{c.description} {c.tool ? <Badge tone={riskTone(c.risk)}>{riskLabel(c.risk)}</Badge> : <Badge tone="muted">built-in</Badge>}{c.confirmation !== 'never' && <Badge tone="warn">{c.confirmation === 'always' ? 'asks first' : 'may ask'}</Badge>}{c.offline ? <Badge tone="ok">offline</Badge> : <Badge tone="cyan">needs internet</Badge>}</div>
              <div className="text-[0.76em] text-muted">“{c.examples.join('”, “')}”</div>
            </div>
          ))}
        </div>
      ))}
    </Section>
  );
}

export function DiagnosticsSection() {
  const [d, setD] = useState<Diagnostics | null>(null);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const load = () => { void call('diagnostics:get').then(setD); void call('audit:list').then(setAudit); };
  useEffect(load, []);
  if (!d) return null;
  return (
    <>
      <Section title="System">
        <dl className="selectable grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[0.82em]">
          <dt className="text-muted">Version</dt><dd>{d.appVersion} (Electron {d.electron})</dd>
          <dt className="text-muted">Platform</dt><dd>{d.platform}</dd>
          <dt className="text-muted">Data folder</dt><dd className="break-all">{d.dataDir}</dd>
          <dt className="text-muted">Database</dt><dd>{(d.db.sizeBytes / 1024).toFixed(1)} KB</dd>
          <dt className="text-muted">Windows bridge</dt><dd>{d.bridge.state}{d.bridge.lastError ? ` — ${d.bridge.lastError}` : ''}</dd>
          <dt className="text-muted">Speech</dt><dd>{d.speech.state}{d.speech.message ? ` — ${d.speech.message}` : ''}</dd>
          <dt className="text-muted">Main memory</dt><dd>{d.memoryMB} MB RSS</dd>
          <dt className="text-muted">Uptime</dt><dd>{Math.round(d.uptimeSec / 60)} min</dd>
        </dl>
        <div><Button onClick={load}>Refresh</Button></div>
      </Section>
      <Section title="Recent actions (audit log)">
        <div className="max-h-56 overflow-y-auto text-[0.78em]">
          {audit.map((a) => <div key={a.id} className="selectable border-b border-line py-1"><span className="text-muted">{new Date(a.at).toLocaleTimeString()}</span> {a.tool} <Badge tone={riskTone(a.risk)}>{a.outcome}</Badge> <span className="text-muted">{a.durationMs} ms</span></div>)}
        </div>
      </Section>
      <Section title="Logs" description="Secrets are redacted.">
        <pre className="code-block selectable max-h-64 overflow-y-auto">{d.logs.join('\n') || 'No log entries.'}</pre>
      </Section>
    </>
  );
}
