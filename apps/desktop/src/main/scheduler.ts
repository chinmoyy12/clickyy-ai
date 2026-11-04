import type { Reminder } from '@shared/types';
import type { ReminderRepo } from './storage/repos';

const MAX_DELAY = 2_147_000_000; // setTimeout limit (~24.8 days)

/** Local, offline scheduler for reminders, timers and focus sessions. Survives restarts via SQLite. */
export class Scheduler {
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(private repo: ReminderRepo, private onFire: (r: Reminder, late: boolean) => void) {}

  restore() {
    for (const r of this.repo.pending()) this.schedule(r.id, r.dueAt);
  }

  schedule(id: string, dueAt: number) {
    this.cancel(id);
    const delay = dueAt - Date.now();
    const t = setTimeout(() => {
      this.timers.delete(id);
      if (dueAt - Date.now() > 1000) return this.schedule(id, dueAt); // long delays are chained
      const r = this.repo.pending().find((x) => x.id === id);
      if (!r) return;
      this.repo.setStatus(id, 'done');
      this.onFire(r, Date.now() - r.dueAt > 60_000);
    }, Math.max(0, Math.min(delay, MAX_DELAY)));
    this.timers.set(id, t);
  }

  cancel(id: string) {
    const t = this.timers.get(id);
    if (t) clearTimeout(t);
    this.timers.delete(id);
  }

  stopAll() {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }
}
