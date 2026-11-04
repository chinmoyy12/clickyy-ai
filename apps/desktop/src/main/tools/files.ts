import { z } from 'zod';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { PathRejected, resolveApproved, validateFileName } from '../security/paths';

const TEXT_EXT = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log', '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.xml', '.yml', '.yaml', '.ini', '.toml']);
const MAX_READ = 200_000;
const MAX_LIST = 200;
const MAX_SCAN = 5000;

const roots = (ctx: ToolContext) => [...ctx.settings.tools.approvedFolders, ctx.settings.tools.workspaceFolder].filter(Boolean);
const safe = (p: string, ctx: ToolContext) => resolveApproved(p, roots(ctx));
const pathArg = z.string().trim().min(1).max(600);

async function walk(dir: string, match: (name: string) => boolean, out: string[], budget: { n: number }, depth = 0) {
  if (depth > 6 || budget.n <= 0 || out.length >= MAX_LIST) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (--budget.n <= 0 || out.length >= MAX_LIST) return;
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) await walk(full, match, out, budget, depth + 1);
    else if (match(e.name)) out.push(full);
  }
}

export const fileTools: ToolDef[] = [
  defineTool({
    name: 'files.list', title: 'List folder', description: 'List files in an approved folder (non-recursive).', category: 'Files', risk: 1, permission: 'files',
    input: z.object({ folder: pathArg.optional() }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ folder }) => `List ${folder ?? 'your first approved folder'}`,
    async run({ folder }, ctx) {
      const dir = safe(folder ?? roots(ctx)[0] ?? '', ctx);
      const entries = (await readdir(dir, { withFileTypes: true })).slice(0, MAX_LIST);
      const lines = entries.map((e) => `${e.isDirectory() ? '[folder] ' : ''}${e.name}`);
      return { ok: true, data: { folder: dir, entries: lines }, message: `${basename(dir)} has ${entries.length} item${entries.length === 1 ? '' : 's'}.`, detail: lines.join('\n') };
    },
  }),
  defineTool({
    name: 'files.search', title: 'Find files', description: 'Search file names (case-insensitive substring) inside approved folders only.', category: 'Files', risk: 1, permission: 'files',
    input: z.object({ name: z.string().trim().min(1).max(100), newestFirst: z.boolean().default(true) }).strict(), confirm: 'never', timeoutMs: 15000, offline: true,
    describe: ({ name }) => `Search approved folders for "${name}"`,
    async run({ name, newestFirst }, ctx) {
      const q = name.toLowerCase();
      const found: string[] = [];
      for (const r of roots(ctx)) {
        try {
          await walk(safe(r, ctx), (n) => n.toLowerCase().includes(q), found, { n: MAX_SCAN });
        } catch (e) {
          if (!(e instanceof PathRejected)) throw e;
        }
      }
      if (roots(ctx).length === 0) return { ok: false, message: 'No approved folders are set up yet. Add one in Settings, Permissions.' };
      const withTime = await Promise.all(found.map(async (f) => ({ f, t: (await stat(f).catch(() => null))?.mtimeMs ?? 0 })));
      if (newestFirst) withTime.sort((a, b) => b.t - a.t);
      const list = withTime.map((x) => x.f);
      if (list.length === 0) return { ok: true, data: [], message: `I didn't find any files matching ${name}.` };
      return { ok: true, data: list, message: `I found ${list.length} match${list.length === 1 ? '' : 'es'}. The ${newestFirst ? 'newest' : 'first'} is ${basename(list[0])}.`, detail: list.slice(0, 30).join('\n') };
    },
  }),
  defineTool({
    name: 'files.read_text', title: 'Read text file', description: 'Read a text file inside an approved folder (max 200 KB).', category: 'Files', risk: 1, permission: 'files',
    input: z.object({ path: pathArg }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ path }) => `Read ${path}`,
    async run({ path }, ctx) {
      const p = safe(path, ctx);
      if (!TEXT_EXT.has(extname(p).toLowerCase())) return { ok: false, message: "I only read plain-text files, and that isn't one." };
      const s = await stat(p);
      if (s.size > MAX_READ) return { ok: false, message: 'That file is too large for me to read in one go.' };
      const text = await readFile(p, 'utf8');
      return { ok: true, data: { path: p, text }, message: `I've read ${basename(p)}. It's ${text.split(/\r?\n/).length} lines long.`, detail: text.slice(0, 4000) };
    },
  }),
  defineTool({
    name: 'files.open', title: 'Open file or folder', description: 'Open an approved file or folder with its default Windows app.', category: 'Files', risk: 1, permission: 'files',
    input: z.object({ path: pathArg }).strict(),
    confirm: (({ path }: { path: string }) => /\.(exe|bat|cmd|ps1|vbs|js|msi|scr|lnk|com|hta|jar)$/i.test(path)) as never,
    timeoutMs: 8000, offline: true,
    describe: ({ path }) => `Open ${path}${/\.(exe|bat|cmd|ps1|vbs|js|msi|scr|lnk|com|hta|jar)$/i.test(path) ? '. This is an executable or script file.' : ''}`,
    async run({ path }, ctx) {
      const p = safe(path, ctx);
      if (!existsSync(p)) return { ok: false, message: "That file doesn't exist." };
      const err = await ctx.platform.openPath(p);
      return err ? { ok: false, message: `Windows couldn't open it: ${err}` } : { ok: true, message: `Opening ${basename(p)}.` };
    },
  }),
  defineTool({
    name: 'files.create', title: 'Create file', description: 'Create a new text file in the configured workspace folder. Never overwrites.', category: 'Files', risk: 2, permission: 'files',
    input: z.object({ name: z.string().trim().min(1).max(200), content: z.string().max(100_000).default('') }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ name, content }, ctx) => `Create ${name} in ${ctx.settings.tools.workspaceFolder || 'your workspace'} (${content.length} characters)`,
    preview: async ({ content }) => content.slice(0, 1500) || '(empty file)',
    async run({ name, content }, ctx) {
      const ws = ctx.settings.tools.workspaceFolder;
      if (!ws) return { ok: false, message: 'Set a workspace folder in Settings, Permissions first.' };
      const fileName = validateFileName(/\.[a-z0-9]{1,8}$/i.test(name) ? name : `${name}.txt`);
      const p = resolveApproved(join(ws, fileName), [ws]);
      if (existsSync(p)) return { ok: false, message: `${fileName} already exists, so I left it alone.` };
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, content, { flag: 'wx' });
      return { ok: true, data: { path: p }, message: `Created ${fileName}.` };
    },
  }),
  defineTool({
    name: 'files.move', title: 'Move or rename file', description: 'Move or rename a file within approved folders. Never overwrites an existing file.', category: 'Files', risk: 2, permission: 'files',
    input: z.object({ from: pathArg, to: pathArg }).strict(), confirm: 'always', timeoutMs: 10000, offline: true,
    confirmLabel: ({ from, to }) => `Move ${basename(from)} → ${basename(to)}`,
    describe: ({ from, to }, ctx) => `Move ${safe(from, ctx)} → ${safe(/[\\/]/.test(to) ? to : join(dirname(safe(from, ctx)), to), ctx)}`,
    async run({ from, to }, ctx) {
      const src = safe(from, ctx);
      const dst = safe(/[\\/]/.test(to) ? to : join(dirname(src), validateFileName(to)), ctx);
      if (!existsSync(src)) return { ok: false, message: "The source file doesn't exist." };
      if (existsSync(dst)) return { ok: false, message: 'Something already exists at the destination, so I stopped.' };
      await mkdir(dirname(dst), { recursive: true });
      await rename(src, dst);
      return { ok: existsSync(dst), message: `Moved to ${basename(dst)}.` };
    },
  }),
  defineTool({
    name: 'files.trash', title: 'Move file to Recycle Bin', description: 'Move a file in an approved folder to the Recycle Bin.', category: 'Files', risk: 3, permission: 'files',
    input: z.object({ path: pathArg }).strict(), confirm: 'always', timeoutMs: 10000, offline: true,
    confirmLabel: ({ path }) => `Move ${basename(path)} to Recycle Bin`,
    describe: ({ path }, ctx) => `Move ${safe(path, ctx)} to the Recycle Bin.`,
    async run({ path }, ctx) {
      const p = safe(path, ctx);
      if (!existsSync(p)) return { ok: false, message: "That file doesn't exist." };
      await ctx.platform.trashItem(p);
      return { ok: !existsSync(p), message: `${basename(p)} is in the Recycle Bin.` };
    },
  }),
];
