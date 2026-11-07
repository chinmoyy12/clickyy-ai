import { z } from 'zod';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, relative } from 'node:path';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { USER_FOLDERS, outputDir, uniquePath, userFolder, writeNew, type UserFolder } from './output';
import { buildZip, MAX_ZIP_BYTES } from './zip';

/** File kinds people ask for by name. */
export const FILE_TYPES: Record<string, { label: string; folder: string; ext: string[] }> = {
  pdf: { label: 'PDF documents', folder: 'PDFs', ext: ['.pdf'] },
  excel: { label: 'Excel spreadsheets', folder: 'Spreadsheets', ext: ['.xlsx', '.xls', '.xlsm', '.xlsb'] },
  csv: { label: 'CSV files', folder: 'CSV', ext: ['.csv', '.tsv'] },
  word: { label: 'Word documents', folder: 'Word documents', ext: ['.docx', '.doc', '.rtf', '.odt'] },
  powerpoint: { label: 'PowerPoint presentations', folder: 'Presentations', ext: ['.pptx', '.ppt', '.odp'] },
  text: { label: 'text files', folder: 'Text files', ext: ['.txt', '.log'] },
  markdown: { label: 'Markdown notes', folder: 'Markdown', ext: ['.md', '.markdown'] },
  python: { label: 'Python scripts', folder: 'Python', ext: ['.py', '.ipynb'] },
  zip: { label: 'ZIP archives', folder: 'Archives', ext: ['.zip', '.7z', '.rar', '.tar', '.gz'] },
  images: { label: 'images', folder: 'Images', ext: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.svg'] },
  videos: { label: 'videos', folder: 'Videos', ext: ['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv'] },
  audio: { label: 'audio files', folder: 'Audio', ext: ['.mp3', '.flac', '.wav', '.m4a', '.aac', '.ogg', '.opus'] },
  all: { label: 'files', folder: 'Sorted', ext: [] },
};
const TYPE_IDS = Object.keys(FILE_TYPES) as [string, ...string[]];

const MAX_SCAN = 20_000;
const MAX_BULK = 2000;
const SKIP_DIRS = /^(\.|node_modules$|AppData$|\$RECYCLE\.BIN$|System Volume Information$|Clickyy$)/i;

/** Standard folders, approved folders, or a named subfolder (e.g. Work_Reports) found inside them. */
export async function resolveFolder(name: string, ctx: ToolContext): Promise<string> {
  const n = name.trim().replace(/^(my|the)\s+/i, '').replace(/\s+folder$/i, '');
  const std = USER_FOLDERS.find((f) => f === n.toLowerCase());
  if (std) return userFolder(std as UserFolder);
  if (/^home$/i.test(n)) return userFolder('home');
  const approved = [...ctx.settings.tools.approvedFolders, ctx.settings.tools.workspaceFolder].filter(Boolean);
  const hit = approved.find((p) => basename(p).toLowerCase() === n.toLowerCase());
  if (hit) return hit;
  if (!/^[A-Za-z0-9 ._-]{1,60}$/.test(n)) throw new Error(`I can't use "${name}" as a folder name.`);
  const want = n.toLowerCase().replace(/[ _-]+/g, '');
  const bases = [userFolder('documents'), userFolder('desktop'), userFolder('home'), userFolder('downloads'), ...approved];
  for (const base of bases) {
    for (const depth of [0, 1]) {
      const found = await findDir(base, want, depth);
      if (found) return found;
    }
  }
  throw new Error(`I couldn't find a folder called ${n} in Documents, Desktop, Downloads or your home folder.`);
}

async function findDir(base: string, want: string, depth: number): Promise<string | null> {
  let entries;
  try { entries = await readdir(base, { withFileTypes: true }); } catch { return null; }
  for (const e of entries) {
    if (!e.isDirectory() || SKIP_DIRS.test(e.name)) continue;
    if (depth === 0 && e.name.toLowerCase().replace(/[ _-]+/g, '') === want) return join(base, e.name);
    if (depth > 0) { const r = await findDir(join(base, e.name), want, depth - 1); if (r) return r; }
  }
  return null;
}

/** Only the user's own folders: home (minus AppData) and approved folders. */
function assertUserPath(p: string, ctx: ToolContext) {
  const home = userFolder('home').toLowerCase();
  const lp = p.toLowerCase();
  const approved = [...ctx.settings.tools.approvedFolders, ctx.settings.tools.workspaceFolder].filter(Boolean).map((x) => x.toLowerCase());
  const okHome = lp.startsWith(home) && !lp.slice(home.length).split(/[\\/]/).some((s) => /^(appdata|\.)/i.test(s));
  const okStd = USER_FOLDERS.some((f) => lp.startsWith(userFolder(f).toLowerCase()));
  if (!okHome && !okStd && !approved.some((a) => lp.startsWith(a))) throw new Error('That folder is outside your personal folders, so I left it alone.');
}

export interface FileHit { path: string; size: number; mtime: number }

export async function scanFiles(dir: string, type: string, recursive: boolean): Promise<{ files: FileHit[]; truncated: boolean }> {
  const exts = new Set(FILE_TYPES[type]?.ext ?? []);
  const files: FileHit[] = [];
  const budget = { n: MAX_SCAN };
  const walk = async (d: string, depth: number) => {
    let entries;
    try { entries = await readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (--budget.n <= 0) return;
      if (e.isSymbolicLink()) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) { if (recursive && depth < 4 && !SKIP_DIRS.test(e.name)) await walk(p, depth + 1); continue; }
      if (exts.size && !exts.has(extname(e.name).toLowerCase())) continue;
      if (/^(desktop\.ini|thumbs\.db)$/i.test(e.name)) continue;
      const s = await stat(p).catch(() => null);
      if (s) files.push({ path: p, size: s.size, mtime: s.mtimeMs });
    }
  };
  await walk(dir, 0);
  return { files, truncated: budget.n <= 0 };
}

const mb = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const today = () => new Date().toISOString().slice(0, 10);
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
const folderArg = z.string().trim().min(1).max(80);
const plural = (n: number, w: string) => `${n} ${n === 1 ? w.replace(/s$/, '').replace(/ie$/, 'y') : w}`;

async function target(folder: string, ctx: ToolContext) {
  const dir = await resolveFolder(folder, ctx);
  assertUserPath(dir, ctx);
  if (!existsSync(dir)) throw new Error(`${folder} doesn't exist on this PC.`);
  return dir;
}

export const filePlusTools: ToolDef[] = [
  defineTool({
    name: 'files.by_type', title: 'Find files by type', description: `List, count, sort by date, find the largest, or find today's files of one type in a personal folder (Desktop, Documents, Downloads, Pictures, Music, Videos, or a named subfolder like Projects or Invoices). Searches subfolders too. Types: ${TYPE_IDS.join(', ')}.`,
    category: 'Files', risk: 1, permission: 'files',
    input: z.object({ folder: folderArg, type: z.enum(TYPE_IDS), action: z.enum(['list', 'count', 'largest', 'recent', 'sort']).default('list'), limit: z.number().int().min(1).max(50).default(10) }).strict(),
    confirm: 'never', timeoutMs: 30000, offline: true,
    describe: ({ folder, type, action }) => `${action === 'count' ? 'Count' : action === 'largest' ? 'Find the largest' : action === 'recent' ? "Find today's" : 'List'} ${FILE_TYPES[type].label} in ${folder}`,
    async run({ folder, type, action, limit }, ctx) {
      const dir = await target(folder, ctx);
      const { files, truncated } = await scanFiles(dir, type, true);
      const label = FILE_TYPES[type].label;
      const where = basename(dir);
      const more = truncated ? ' The folder is very large, so I stopped after 20,000 items.' : '';
      if (action === 'count') {
        const total = files.reduce((a, f) => a + f.size, 0);
        return { ok: true, data: { count: files.length, bytes: total, folder: dir }, message: `${where} has ${plural(files.length, label)}${files.length ? `, ${mb(total)} in total` : ''}.${more}` };
      }
      let list = files;
      if (action === 'recent') list = files.filter((f) => f.mtime >= startOfToday());
      if (action === 'largest') list = [...list].sort((a, b) => b.size - a.size);
      else list = [...list].sort((a, b) => b.mtime - a.mtime);
      const shown = list.slice(0, action === 'largest' ? limit : Math.max(limit, 30));
      const lines = shown.map((f) => `${relative(dir, f.path)}  —  ${mb(f.size)}, ${new Date(f.mtime).toLocaleString()}`);
      if (!list.length) return { ok: true, data: { count: 0, folder: dir }, message: action === 'recent' ? `No ${label} in ${where} were changed today.` : `I didn't find any ${label} in ${where}.${more}` };
      const head = action === 'largest' ? `The ${Math.min(limit, list.length)} largest ${label} in ${where}: ${shown.slice(0, 3).map((f) => `${basename(f.path)} at ${mb(f.size)}`).join(', ')}.`
        : action === 'recent' ? `${plural(list.length, label)} in ${where} changed today. The newest is ${basename(list[0].path)}.`
        : `I found ${plural(list.length, label)} in ${where}. Newest first: ${shown.slice(0, 3).map((f) => basename(f.path)).join(', ')}.`;
      return { ok: true, data: { count: list.length, folder: dir, files: shown.map((f) => f.path) }, message: head + more, detail: lines.join('\n') };
    },
  }),
  defineTool({
    name: 'files.bulk', title: 'Organize files by type', description: "Do one thing to every file of a type in a personal folder: move them into a tidy subfolder (organize), add today's date to the front of their names (rename_date), compress them into a ZIP in Documents\\Clickyy\\Archives, or copy them to Documents\\Clickyy\\Backups. Nothing is ever deleted or overwritten.",
    category: 'Files', risk: 2, permission: 'files',
    input: z.object({ folder: folderArg, type: z.enum(TYPE_IDS), action: z.enum(['organize', 'rename_date', 'zip', 'backup']) }).strict(),
    confirm: (({ action }: { action: string }) => action === 'organize' || action === 'rename_date') as never,
    confirmLabel: ({ action, type }) => (action === 'organize' ? `Move ${FILE_TYPES[type].label}` : `Rename ${FILE_TYPES[type].label}`),
    timeoutMs: 300000, offline: true,
    describe: async ({ folder, type, action }, ctx) => {
      const label = FILE_TYPES[type].label;
      if (action === 'zip') return `Compress all ${label} in ${folder} into a new ZIP file`;
      if (action === 'backup') return `Copy all ${label} in ${folder} to Documents\\Clickyy\\Backups`;
      const dir = await target(folder, ctx);
      const { files } = await scanFiles(dir, type, false);
      const n = action === 'rename_date' ? files.filter((f) => !/^\d{4}-\d{2}-\d{2}/.test(basename(f.path))).length : files.length;
      return action === 'organize' ? `Move ${plural(n, label)} from ${basename(dir)} into ${basename(dir)}\\${FILE_TYPES[type].folder}. Files in subfolders stay where they are.`
        : `Rename ${plural(n, label)} in ${basename(dir)} to start with ${today()}. Files that already start with a date are skipped.`;
    },
    async run({ folder, type, action }, ctx) {
      const dir = await target(folder, ctx);
      const t = FILE_TYPES[type];
      const where = basename(dir);
      if (action === 'organize' || action === 'rename_date') {
        const { files } = await scanFiles(dir, type, false);
        let todo = files;
        if (action === 'rename_date') todo = files.filter((f) => !/^\d{4}-\d{2}-\d{2}/.test(basename(f.path)));
        if (!todo.length) return { ok: true, message: action === 'organize' ? `There are no ${t.label} directly in ${where}.` : `All ${t.label} in ${where} already start with a date.` };
        if (todo.length > MAX_BULK) return { ok: false, message: `That's ${todo.length} files, more than I'll change at once. Try a smaller folder.` };
        const dest = action === 'organize' ? join(dir, t.folder) : dir;
        await mkdir(dest, { recursive: true });
        let moved = 0;
        const failed: string[] = [];
        for (const f of todo) {
          const ext = extname(f.path);
          const stem = basename(f.path, ext);
          const to = uniquePath(dest, action === 'rename_date' ? `${today()} ${stem}` : stem, ext);
          try { await rename(f.path, to); moved++; } catch { failed.push(basename(f.path)); }
        }
        const fail = failed.length ? ` ${plural(failed.length, 'files')} couldn't be ${action === 'organize' ? 'moved' : 'renamed'}, probably because they are open: ${failed.slice(0, 3).join(', ')}.` : '';
        return { ok: moved > 0, data: { changed: moved, failed, folder: dest }, message: action === 'organize' ? `Moved ${plural(moved, t.label)} into ${where}, ${t.folder}.${fail}` : `Renamed ${plural(moved, t.label)} in ${where} with today's date.${fail}` };
      }
      const { files, truncated } = await scanFiles(dir, type, true);
      if (!files.length) return { ok: true, message: `There are no ${t.label} in ${where}.` };
      if (files.length > MAX_BULK) return { ok: false, message: `That's ${files.length} files, more than I'll copy at once. Try a smaller folder.` };
      const total = files.reduce((a, f) => a + f.size, 0);
      const stem = `${where} ${t.label} ${today()}`;
      if (action === 'zip') {
        if (total > MAX_ZIP_BYTES) return { ok: false, message: `Those files add up to ${mb(total)}, more than the 1 GB I'll put in one ZIP.` };
        const entries = [];
        for (const f of files) entries.push({ name: relative(dir, f.path).replace(/\\/g, '/'), data: await readFile(f.path), date: new Date(f.mtime) });
        const path = await writeNew(outputDir('Archives'), stem, '.zip', buildZip(entries));
        const size = (await stat(path)).size;
        return { ok: true, data: { path, files: files.length }, message: `Compressed ${plural(files.length, t.label)} (${mb(total)}) into a ${mb(size)} ZIP in Documents, Clickyy, Archives.${truncated ? ' The folder was very large, so some files may be missing.' : ''}`, detail: path };
      }
      const destRoot = uniquePath(outputDir('Backups'), stem, '');
      let copied = 0;
      for (const f of files) {
        const to = join(destRoot, relative(dir, f.path));
        await mkdir(dirname(to), { recursive: true });
        try { await copyFile(f.path, to); copied++; } catch { /* locked file: skipped */ }
      }
      return { ok: copied > 0, data: { folder: destRoot, files: copied }, message: `Backed up ${plural(copied, t.label)} (${mb(total)}) to Documents, Clickyy, Backups.${copied < files.length ? ` ${files.length - copied} were in use and skipped.` : ''}`, detail: destRoot };
    },
  }),
  defineTool({
    name: 'files.duplicates', title: 'Find duplicate files', description: 'Find files of a type in a personal folder that have exactly the same content. Read-only: nothing is deleted.', category: 'Files', risk: 1, permission: 'files',
    input: z.object({ folder: folderArg, type: z.enum(TYPE_IDS) }).strict(), confirm: 'never', timeoutMs: 120000, offline: true,
    describe: ({ folder, type }) => `Look for duplicate ${FILE_TYPES[type].label} in ${folder}`,
    async run({ folder, type }, ctx) {
      const dir = await target(folder, ctx);
      const { files } = await scanFiles(dir, type, true);
      const bySize = new Map<number, FileHit[]>();
      for (const f of files) if (f.size > 0) (bySize.get(f.size) ?? bySize.set(f.size, []).get(f.size)!).push(f);
      const groups: FileHit[][] = [];
      for (const same of bySize.values()) {
        if (same.length < 2) continue;
        const byHash = new Map<string, FileHit[]>();
        for (const f of same) {
          const h = await hashFile(f.path).catch(() => null);
          if (h) (byHash.get(h) ?? byHash.set(h, []).get(h)!).push(f);
        }
        for (const g of byHash.values()) if (g.length > 1) groups.push(g);
      }
      const label = FILE_TYPES[type].label;
      if (!groups.length) return { ok: true, data: { groups: 0 }, message: `No duplicate ${label} in ${basename(dir)}. I checked ${plural(files.length, 'files')}.` };
      const wasted = groups.reduce((a, g) => a + g[0].size * (g.length - 1), 0);
      const lines = groups.map((g) => g.map((f) => relative(dir, f.path)).join('  =  '));
      return { ok: true, data: { groups: groups.length, wastedBytes: wasted, sets: groups.map((g) => g.map((f) => f.path)) }, message: `I found ${plural(groups.length, 'sets')} of duplicate ${label} in ${basename(dir)}, wasting ${mb(wasted)}. For example ${basename(groups[0][0].path)} and ${basename(groups[0][1].path)} are identical. I haven't deleted anything.`, detail: lines.join('\n') };
    },
  }),
];

function hashFile(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1');
    createReadStream(p).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}
