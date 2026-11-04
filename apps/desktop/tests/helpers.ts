import { Db } from '../src/main/storage/db';
import { createRepos, type Repos } from '../src/main/storage/repos';
import { FakeBridge } from '../src/main/windows/bridge';
import type { Platform, SessionState, ToolContext } from '../src/main/tools/types';
import { ConfirmationBroker } from '../src/main/tools/confirmations';
import { ToolExecutor } from '../src/main/tools/executor';
import { createRegistry } from '../src/main/tools';
import type { ConfirmationRequest, ToolCallRecord } from '../src/shared/types';
import type { DeepPartial, Settings } from '../src/shared/settings';

export class FakePlatform implements Platform {
  opened: string[] = [];
  spawned: Array<{ file: string; args: string[] }> = [];
  paths: string[] = [];
  trashed: string[] = [];
  notes: string[] = [];
  existing = new Set<string>();
  online = true;
  async openExternal(url: string) { this.opened.push(url); }
  async openPath(p: string) { this.paths.push(p); return ''; }
  async spawnDetached(file: string, args: string[]) { this.spawned.push({ file, args }); }
  async trashItem(p: string) { this.trashed.push(p); }
  notify(t: string, b: string) { this.notes.push(`${t}: ${b}`); }
  fileExists(p: string) { return this.existing.has(p) || this.existing.has('*'); }
  isOnline() { return this.online; }
}

export async function setup(patch: DeepPartial<Settings> = {}) {
  const db = await Db.open(null);
  const repos: Repos = createRepos(db);
  if (Object.keys(patch).length) repos.settings.update(patch);
  const bridge = new FakeBridge();
  const platform = new FakePlatform();
  const confirmations: ConfirmationRequest[] = [];
  const records: ToolCallRecord[] = [];
  let autoAnswer: boolean | null = null;
  const broker = new ConfirmationBroker(
    (req) => {
      confirmations.push(req);
      if (autoAnswer !== null) queueMicrotask(() => broker.respond(req.id, autoAnswer!));
    },
    () => {},
    500,
  );
  const registry = createRegistry();
  const executor = new ToolExecutor(registry, broker, (r) => records.push(r));
  const session: SessionState = {};
  const scheduled = new Map<string, number>();
  const ctx = (signal: AbortSignal = new AbortController().signal): ToolContext => ({
    settings: repos.settings.get(), bridge, repos, platform, signal, session,
    scheduler: { schedule: (id, at) => scheduled.set(id, at), cancel: (id) => scheduled.delete(id) },
  });
  return {
    db, repos, bridge, platform, broker, registry, executor, session, ctx, confirmations, records, scheduled,
    autoConfirm(v: boolean | null) { autoAnswer = v; },
  };
}
