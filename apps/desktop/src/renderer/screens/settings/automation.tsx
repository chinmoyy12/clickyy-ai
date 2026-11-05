import { useEffect, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Download } from 'lucide-react';
import type { PermissionKey, Settings } from '@shared/settings';
import type { AppEntry, Routine, RoutineStep } from '@shared/types';
import { Badge, Button, Row, Section, Select, TextInput, Toggle, riskLabel, riskTone } from '../../components/ui';
import { notify } from '../../state/store';
import { call } from '../../api';
import type { Update } from '../Settings';

const PERMISSIONS: Array<{ key: PermissionKey; label: string; text: string; level: 1 | 2 | 3 }> = [
  { key: 'system', label: 'System status & settings pages', text: 'Battery, CPU, memory, disk, network, Task Manager, lock screen.', level: 1 },
  { key: 'media', label: 'Volume & media', text: 'Change volume, mute, control the active media player.', level: 1 },
  { key: 'apps', label: 'Open approved apps', text: 'Only apps listed under Approved apps.', level: 1 },
  { key: 'windows', label: 'Window management', text: 'Switch, minimize, maximize, snap. Closing a window always asks first.', level: 1 },
  { key: 'web', label: 'Open websites & search', text: 'Opens http(s) links in your default browser.', level: 1 },
  { key: 'files', label: 'Files in approved folders', text: 'List, search and read files only inside folders you approve. Creating files is allowed in your workspace; moves and deletions always ask.', level: 2 },
  { key: 'clipboard', label: 'Clipboard', text: 'Copy text to the clipboard. Reading it always asks first.', level: 2 },
  { key: 'automation', label: 'Keyboard automation', text: 'Press allowlisted shortcuts and type text you approve into the focused window.', level: 2 },
  { key: 'power', label: 'Shut down / restart / sign out', text: 'Always requires an explicit on-screen confirmation every time.', level: 3 },
  { key: 'screen', label: 'Look at my screen', text: 'When you ask "what\'s on my screen", Clickyy takes one screenshot (after you confirm) and sends it to your AI model. Never in the background, never saved.', level: 2 },
];

export function PermissionsSection({ s, update }: { s: Settings; update: Update }) {
  const pick = async (purpose: 'approved' | 'workspace') => {
    const dir = await call('folders:pick', { purpose });
    if (!dir) return;
    if (purpose === 'workspace') await update({ tools: { workspaceFolder: dir } });
    else if (!s.tools.approvedFolders.includes(dir)) await update({ tools: { approvedFolders: [...s.tools.approvedFolders, dir] } });
  };
  return (
    <>
      <Section title="Automation permissions" description="Each permission can be revoked at any time. Clickyy has no tool that runs shell commands or scripts.">
        {PERMISSIONS.map((p) => (
          <Row key={p.key} label={p.label} hint={<>{p.text} <Badge tone={riskTone(p.level)}>{riskLabel(p.level)}</Badge></>}>
            <Toggle label={p.label} checked={s.tools.permissions[p.key]} onChange={(v) => void update({ tools: { permissions: { [p.key]: v } } })} />
          </Row>
        ))}
      </Section>
      <Section title="Approved folders" description="File tools can only see these folders (and the workspace). Nothing else on your PC is scanned.">
        {s.tools.approvedFolders.length === 0 && <p className="text-[0.85em] text-muted">No folders approved.</p>}
        {s.tools.approvedFolders.map((f) => (
          <Row key={f} label={f}><Button variant="ghost" onClick={() => void update({ tools: { approvedFolders: s.tools.approvedFolders.filter((x) => x !== f) } })}>Remove</Button></Row>
        ))}
        <div><Button onClick={() => void pick('approved')}><Plus size={13} className="mr-1 inline" />Approve a folder</Button></div>
      </Section>
      <Section title="Workspace folder" description="Where Clickyy may create new files. Existing files are never overwritten.">
        <Row label={s.tools.workspaceFolder || 'Not set'}><Button onClick={() => void pick('workspace')}>Choose…</Button></Row>
      </Section>
      <Section title="Weather & web" description="Weather comes from Open-Meteo (free, no account). Unavailable in Strict Offline mode.">
        <Row label="Home city"><WeatherCity value={s.tools.weatherLocation} onSave={(v) => void update({ tools: { weatherLocation: v } })} /></Row>
        <Row label="Units"><Select label="Units" value={s.tools.units} onChange={(v) => void update({ tools: { units: v } })} options={[{ value: 'metric', label: 'Metric (°C, km/h)' }, { value: 'imperial', label: 'Imperial (°F, mph)' }]} /></Row>
        <Row label="Search engine"><Select label="Search engine" value={s.tools.searchEngine} onChange={(v) => void update({ tools: { searchEngine: v } })} options={[{ value: 'duckduckgo', label: 'DuckDuckGo' }, { value: 'bing', label: 'Bing' }, { value: 'google', label: 'Google' }]} /></Row>
      </Section>
    </>
  );
}

function WeatherCity({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <div className="flex gap-1"><TextInput label="Home city" value={v} onChange={setV} placeholder="e.g. London" className="w-40" /><Button onClick={() => onSave(v.trim())} disabled={v === value}>Save</Button></div>;
}

export function AppsSection() {
  const [apps, setApps] = useState<AppEntry[]>([]);
  const [draft, setDraft] = useState({ name: '', aliases: '', kind: 'exe' as AppEntry['kind'], target: '', processName: '' });
  const load = () => void call('apps:list').then(setApps);
  useEffect(load, []);
  const save = async () => {
    try {
      await call('apps:upsert', { name: draft.name, aliases: draft.aliases.split(',').map((a) => a.trim()).filter(Boolean), kind: draft.kind, target: draft.target, processName: draft.processName || undefined, enabled: true });
      setDraft({ name: '', aliases: '', kind: 'exe', target: '', processName: '' });
      load();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  return (
    <>
      <Section title="Approved apps" description="Clickyy can only open apps in this list. Detected apps were found at their standard install locations.">
        {apps.map((a) => (
          <div key={a.id} className="flex items-center gap-2 border-b border-line pb-2 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="text-[0.9em]">{a.name} {a.detected && <Badge tone="muted">detected</Badge>}</div>
              <div className="truncate text-[0.75em] text-muted" title={a.target}>{a.kind === 'uri' ? a.target : a.target.split('\\').slice(-2).join('\\')} · says: {a.aliases.join(', ') || '—'}</div>
            </div>
            <Toggle label={`Enable ${a.name}`} checked={a.enabled} onChange={(v) => void call('apps:upsert', { ...a, enabled: v }).then(load)} />
            <button aria-label={`Remove ${a.name}`} className="text-muted hover:text-danger" onClick={() => void call('apps:delete', { id: a.id }).then(load)}><Trash2 size={14} /></button>
          </div>
        ))}
        <div><Button onClick={() => void call('apps:detect').then((n) => { notify('info', n ? `Added ${n} app(s).` : 'No new apps found.'); load(); })}>Detect installed apps</Button></div>
      </Section>
      <Section title="Add an app">
        <Row label="Name"><TextInput label="App name" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} className="w-52" /></Row>
        <Row label="Spoken aliases" hint="Comma separated"><TextInput label="Aliases" value={draft.aliases} onChange={(v) => setDraft({ ...draft, aliases: v })} placeholder="editor, my ide" className="w-52" /></Row>
        <Row label="Type"><Select label="App type" value={draft.kind} onChange={(v) => setDraft({ ...draft, kind: v })} options={[{ value: 'exe', label: 'Executable (.exe)' }, { value: 'uri', label: 'App link (e.g. spotify:)' }, { value: 'appx', label: 'Store app ID' }]} /></Row>
        <Row label="Target" hint={draft.kind === 'exe' ? 'Full path to the .exe' : draft.kind === 'uri' ? 'Known app schemes only' : 'AppUserModelID, e.g. Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'}>
          <TextInput label="Target" value={draft.target} onChange={(v) => setDraft({ ...draft, target: v })} className="w-52" />
        </Row>
        <Row label="Process name" hint="Optional, lets Clickyy verify the window opened"><TextInput label="Process name" value={draft.processName} onChange={(v) => setDraft({ ...draft, processName: v })} placeholder="Code" className="w-52" /></Row>
        <div><Button variant="primary" disabled={!draft.name || !draft.target} onClick={() => void save()}>Add app</Button></div>
      </Section>
    </>
  );
}

const BLOCKS: Array<{ tool: string; label: string; fields: Array<{ key: string; label: string; type: 'text' | 'number' | 'select'; options?: string[] }> }> = [
  { tool: 'apps.open', label: 'Open app', fields: [{ key: 'app', label: 'App name', type: 'text' }] },
  { tool: 'system.open_folder', label: 'Open folder', fields: [{ key: 'folder', label: 'Folder', type: 'select', options: ['workspace', 'documents', 'downloads', 'desktop', 'pictures', 'music', 'videos', 'home'] }] },
  { tool: 'web.open', label: 'Open website', fields: [{ key: 'url', label: 'URL', type: 'text' }] },
  { tool: 'audio.set_volume', label: 'Set volume', fields: [{ key: 'level', label: 'Level %', type: 'number' }] },
  { tool: 'media.control', label: 'Media control', fields: [{ key: 'action', label: 'Action', type: 'select', options: ['play', 'pause', 'toggle', 'next', 'previous', 'stop'] }] },
  { tool: 'windows.arrange', label: 'Arrange window', fields: [{ key: 'action', label: 'Action', type: 'select', options: ['snap_left', 'snap_right', 'maximize', 'minimize', 'restore'] }, { key: 'query', label: 'App / window', type: 'text' }] },
  { tool: 'windows.focus', label: 'Switch to window', fields: [{ key: 'query', label: 'App / window', type: 'text' }] },
  { tool: 'timers.create', label: 'Focus timer', fields: [{ key: 'seconds', label: 'Minutes', type: 'number' }] },
  { tool: 'system.open_settings', label: 'Open settings page', fields: [{ key: 'page', label: 'Page', type: 'select', options: ['home', 'sound', 'display', 'bluetooth', 'wifi', 'focus', 'notifications'] }] },
];

function blockArgs(tool: string, raw: Record<string, unknown>): Record<string, unknown> {
  if (tool === 'timers.create') return { seconds: Math.round(Number(raw.seconds ?? 25) * 60), label: 'Focus', focus: true };
  if (tool === 'audio.set_volume') return { level: Number(raw.level ?? 30) };
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== ''));
}

export function RoutinesSection() {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [name, setName] = useState('');
  const [phrases, setPhrases] = useState('');
  const [steps, setSteps] = useState<Array<{ tool: string; raw: Record<string, unknown> }>>([]);
  const [editing, setEditing] = useState<string | undefined>();
  const [preview, setPreview] = useState<Array<{ title: string; risk: number; valid: boolean; error?: string; confirm: boolean }> | null>(null);
  const [importText, setImportText] = useState('');
  const load = () => void call('routines:list').then(setRoutines);
  useEffect(load, []);

  const payload = () => ({
    id: editing, name, phrases: phrases.split(',').map((p) => p.trim()).filter(Boolean), enabled: true,
    steps: steps.map((s) => ({ tool: s.tool, args: blockArgs(s.tool, s.raw), label: BLOCKS.find((b) => b.tool === s.tool)?.label })) as RoutineStep[],
  });
  const doPreview = async () => {
    try { setPreview(await call('routines:preview', payload())); } catch (e) { notify('error', (e as Error).message); }
  };
  const save = async () => {
    try {
      await call('routines:upsert', payload());
      notify('info', 'Routine saved.');
      setName(''); setPhrases(''); setSteps([]); setEditing(undefined); setPreview(null);
      load();
    } catch (e) {
      notify('error', (e as Error).message);
    }
  };
  const edit = (r: Routine) => {
    setEditing(r.id); setName(r.name); setPhrases(r.phrases.join(', '));
    setSteps(r.steps.map((s) => ({ tool: s.tool, raw: s.tool === 'timers.create' ? { seconds: Number(s.args.seconds) / 60 } : { ...s.args } })));
    setPreview(null);
  };
  const exportAll = () => {
    const blob = new Blob([JSON.stringify(routines.map(({ name: n, phrases: p, steps: st, enabled }) => ({ name: n, phrases: p, steps: st, enabled })), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'clickyy-routines.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async () => {
    try {
      const list = JSON.parse(importText) as Array<Omit<Routine, 'id' | 'updatedAt'>>;
      for (const r of Array.isArray(list) ? list : [list]) await call('routines:upsert', { name: r.name, phrases: r.phrases, steps: r.steps, enabled: r.enabled ?? true });
      setImportText('');
      notify('info', 'Routines imported. Each step was validated.');
      load();
    } catch (e) {
      notify('error', `Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <>
      <Section title="Your routines" description='Say a routine phrase (e.g. "coding mode") to run its steps in order. Each step is checked against its permissions and confirmations as it runs; failures are reported step by step.'>
        {routines.length === 0 && <p className="text-[0.85em] text-muted">No routines yet.</p>}
        {routines.map((r) => (
          <div key={r.id} className="flex items-center gap-2 border-b border-line pb-2 last:border-0">
            <div className="min-w-0 flex-1">
              <div className="text-[0.9em]">{r.name}</div>
              <div className="text-[0.75em] text-muted">“{r.phrases.join('”, “')}” · {r.steps.length} steps</div>
            </div>
            <Toggle label={`Enable ${r.name}`} checked={r.enabled} onChange={(v) => void call('routines:upsert', { ...r, enabled: v }).then(load)} />
            <Button variant="ghost" onClick={() => edit(r)}>Edit</Button>
            <button aria-label={`Delete ${r.name}`} className="text-muted hover:text-danger" onClick={() => void call('routines:delete', { id: r.id }).then(load)}><Trash2 size={14} /></button>
          </div>
        ))}
        {routines.length > 0 && <div><Button variant="ghost" onClick={exportAll}><Download size={13} className="mr-1 inline" />Export routines</Button></div>}
      </Section>
      <Section title={editing ? 'Edit routine' : 'New routine'}>
        <Row label="Name"><TextInput label="Routine name" value={name} onChange={setName} placeholder="Coding mode" className="w-52" /></Row>
        <Row label="Trigger phrases" hint="Comma separated"><TextInput label="Trigger phrases" value={phrases} onChange={setPhrases} placeholder="coding mode, start coding" className="w-52" /></Row>
        {steps.map((st, i) => {
          const block = BLOCKS.find((b) => b.tool === st.tool)!;
          return (
            <div key={i} className="rounded-xl border border-line p-2">
              <div className="mb-1.5 flex items-center gap-1 text-[0.85em]">
                <span className="text-muted">{i + 1}.</span> <span className="font-medium">{block.label}</span>
                <span className="ml-auto flex gap-0.5">
                  <button aria-label="Move up" disabled={i === 0} onClick={() => setSteps((s) => { const n = [...s]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} className="p-1 text-muted disabled:opacity-30"><ArrowUp size={13} /></button>
                  <button aria-label="Move down" disabled={i === steps.length - 1} onClick={() => setSteps((s) => { const n = [...s]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} className="p-1 text-muted disabled:opacity-30"><ArrowDown size={13} /></button>
                  <button aria-label="Remove step" onClick={() => setSteps((s) => s.filter((_, j) => j !== i))} className="p-1 text-muted hover:text-danger"><Trash2 size={13} /></button>
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {block.fields.map((f) => f.type === 'select' ? (
                  <Select key={f.key} label={f.label} value={String(st.raw[f.key] ?? f.options![0])} onChange={(v) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, raw: { ...x.raw, [f.key]: v } } : x)))} options={f.options!.map((o) => ({ value: o, label: o.replace('_', ' ') }))} />
                ) : (
                  <TextInput key={f.key} label={f.label} type={f.type} value={String(st.raw[f.key] ?? '')} placeholder={f.label} onChange={(v) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, raw: { ...x.raw, [f.key]: v } } : x)))} className="w-40" />
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap gap-1">
          {BLOCKS.map((b) => <Button key={b.tool} variant="ghost" onClick={() => setSteps((s) => [...s, { tool: b.tool, raw: b.fields[0].type === 'select' ? { [b.fields[0].key]: b.fields[0].options![0] } : {} }])}><Plus size={12} className="mr-0.5 inline" />{b.label}</Button>)}
        </div>
        {preview && (
          <ol className="rounded-xl border border-line p-2 text-[0.82em]">
            {preview.map((p, i) => (
              <li key={i} className="flex items-center gap-2 py-0.5">{i + 1}. {p.title} <Badge tone={riskTone(p.risk)}>{riskLabel(p.risk)}</Badge>{p.confirm && <Badge tone="warn">asks first</Badge>}{!p.valid && <span className="text-danger">{p.error}</span>}</li>
            ))}
          </ol>
        )}
        <div className="flex gap-2">
          <Button onClick={() => void doPreview()} disabled={!steps.length}>Preview</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!name || !phrases || !steps.length || !preview || preview.some((p) => !p.valid)}>Save routine</Button>
          {editing && <Button variant="ghost" onClick={() => { setEditing(undefined); setName(''); setPhrases(''); setSteps([]); setPreview(null); }}>Cancel edit</Button>}
        </div>
        <p className="text-[0.75em] text-muted">Preview first: saving is enabled once every step validates.</p>
      </Section>
      <Section title="Import routines" description="Paste exported JSON. Every step is validated against the tool registry; unknown actions are rejected.">
        <textarea aria-label="Routine JSON" value={importText} onChange={(e) => setImportText(e.target.value)} className="selectable h-24 w-full rounded-lg border border-line bg-surface2 p-2 font-mono text-[0.78em]" />
        <div><Button onClick={() => void doImport()} disabled={!importText.trim()}>Import</Button></div>
      </Section>
    </>
  );
}
