import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { useStore, store, notify } from '../state/store';
import { call } from '../api';
import type { DeepPartial, Settings } from '@shared/settings';
import { GeneralSection, VoiceSection, PersonalitySection, ListeningSection, AppearanceSection } from './settings/basic';
import { AiSection, CredentialsSection } from './settings/ai';
import { AppsSection, RoutinesSection, PermissionsSection } from './settings/automation';
import { MemorySection, HistorySection, CommandsSection, DiagnosticsSection } from './settings/data';

export type Update = (patch: DeepPartial<Settings>) => Promise<void>;

const SECTIONS = [
  ['general', 'General'], ['voice', 'Voice & speech'], ['personality', 'Personality'], ['listening', 'Listening & wake word'],
  ['ai', 'AI & routing'], ['credentials', 'Credentials'], ['permissions', 'Permissions'], ['apps', 'Approved apps'],
  ['routines', 'Routines'], ['memory', 'Memory'], ['history', 'History & privacy'], ['appearance', 'Appearance & access'],
  ['commands', 'Commands'], ['diagnostics', 'Diagnostics'],
] as const;
export type SectionId = (typeof SECTIONS)[number][0];

export function SettingsScreen({ onPreview }: { onPreview: (text: string) => void }) {
  const settings = useStore((s) => s.settings)!;
  const [section, setSection] = useState<SectionId>('general');
  const update: Update = useMemo(() => async (patch) => {
    try {
      store.set({ settings: await call('settings:update', patch as Record<string, unknown>) });
    } catch (e) {
      notify('error', (e as Error).message);
    }
  }, []);
  useEffect(() => { document.getElementById('settings-body')?.scrollTo({ top: 0 }); }, [section]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 pb-2">
        <button aria-label="Back" onClick={() => store.set({ view: 'main' })} className="grid h-8 w-8 place-items-center rounded-lg text-muted hover:bg-surface2 hover:text-ink"><ArrowLeft size={16} /></button>
        <h2 className="text-[1em] font-semibold">Settings</h2>
        <select aria-label="Settings section" value={section} onChange={(e) => setSection(e.target.value as SectionId)}
          className="ml-auto rounded-lg border border-line bg-surface2 px-2 py-1 text-[0.85em] sm:hidden">
          {SECTIONS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
      </div>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Settings sections" className="hidden w-44 shrink-0 overflow-y-auto border-r border-line px-2 sm:block">
          {SECTIONS.map(([id, label]) => (
            <button key={id} onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}
              className={`mb-0.5 block w-full rounded-lg px-2.5 py-1.5 text-left text-[0.85em] ${section === id ? 'bg-surface2 text-gold' : 'text-muted hover:text-ink'}`}>{label}</button>
          ))}
        </nav>
        <div id="settings-body" className="min-w-0 flex-1 overflow-y-auto px-3 pb-6">
          {section === 'general' && <GeneralSection s={settings} update={update} />}
          {section === 'voice' && <VoiceSection s={settings} update={update} onPreview={onPreview} />}
          {section === 'personality' && <PersonalitySection s={settings} update={update} onPreview={onPreview} />}
          {section === 'listening' && <ListeningSection s={settings} update={update} />}
          {section === 'ai' && <AiSection s={settings} update={update} />}
          {section === 'credentials' && <CredentialsSection s={settings} />}
          {section === 'permissions' && <PermissionsSection s={settings} update={update} />}
          {section === 'apps' && <AppsSection />}
          {section === 'routines' && <RoutinesSection />}
          {section === 'memory' && <MemorySection />}
          {section === 'history' && <HistorySection s={settings} update={update} />}
          {section === 'appearance' && <AppearanceSection s={settings} update={update} />}
          {section === 'commands' && <CommandsSection />}
          {section === 'diagnostics' && <DiagnosticsSection />}
        </div>
      </div>
    </div>
  );
}
