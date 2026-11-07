import os from 'node:os';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Standard user folders. main.ts fills CLICKYY_DIR_* from Electron's app.getPath (handles OneDrive redirection). */
export const USER_FOLDERS = ['desktop', 'documents', 'downloads', 'pictures', 'music', 'videos'] as const;
export type UserFolder = (typeof USER_FOLDERS)[number];

export function userFolder(name: UserFolder | 'home'): string {
  if (name === 'home') return os.homedir();
  return process.env[`CLICKYY_DIR_${name.toUpperCase()}`] || join(os.homedir(), name[0].toUpperCase() + name.slice(1));
}

/** Where Clickyy saves what it makes: Documents\Clickyy\<kind>. Overridable for tests. */
export function outputDir(kind: 'Sheets' | 'Projects' | 'Notes' | 'Reports' | 'Backups' | 'Archives' | 'Screenshots' | 'Playlists'): string {
  return join(process.env.CLICKYY_OUTPUT_DIR || join(userFolder('documents'), 'Clickyy'), kind);
}

/** Safe file stem: letters, digits, spaces, dashes, underscores and dots only. */
export function safeStem(name: string, fallback = 'Untitled'): string {
  const s = name.replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80);
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s) || !s ? fallback : s;
}

/** A path in dir that doesn't exist yet: "Budget.xlsx", "Budget (2).xlsx", … Never overwrites. */
export function uniquePath(dir: string, stem: string, ext: string): string {
  let p = join(dir, `${stem}${ext}`);
  for (let i = 2; existsSync(p) && i < 1000; i++) p = join(dir, `${stem} (${i})${ext}`);
  return p;
}

export async function writeNew(dir: string, stem: string, ext: string, data: Buffer | string): Promise<string> {
  await mkdir(dir, { recursive: true });
  const p = uniquePath(dir, safeStem(stem), ext);
  await writeFile(p, data, { flag: 'wx' });
  return p;
}
