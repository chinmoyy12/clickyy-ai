import type { Reminder } from '@shared/types';
import type { ReminderRepo } from './storage/repos';

const MAX_DELAY = 2_147_000_000; // setTimeout limit (~24.8 days)

/** The next time a repeating reminder is due after `from`, never in the past. */
export function nextOccurrence(from: number, repeat: NonNullable<Reminder['repeat']>, now = Date.now()): number {
  const d = new Date(from);
  do {
    d.setDate(d.getDate() + (repeat === 'weekly' ? 7 : 1));
    if (repeat === 'weekdays') while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  } while (d.getTime() <= now);
  return d.getTime();
}

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
      if (r.repeat) {
        const next = nextOccurrence(r.dueAt, r.repeat);
        const n = this.repo.add(r.text, next, r.kind, r.repeat);
        this.schedule(n.id, n.dueAt);
      }
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
