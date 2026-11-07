import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, normalize, sep } from 'node:path';
import { defineTool, type ToolContext, type ToolDef } from './types';
import { buildXlsx, type SheetColumn } from './xlsx';
import { outputDir, safeStem, uniquePath, writeNew } from './output';

/** Functions a sheet formula may use. No HYPERLINK, WEBSERVICE, INDIRECT, external refs or DDE. */
const FORMULA_FUNCS = new Set(['SUM', 'AVERAGE', 'IF', 'IFERROR', 'ROUND', 'MIN', 'MAX', 'ABS', 'AND', 'OR', 'NOT', 'COUNT', 'COUNTA', 'TODAY', 'DAYS', 'PMT']);

export function safeFormula(f: string): boolean {
  if (f.length > 400 || /[|!\[\]@;$'\\]/.test(f)) return false;
  const stripped = f.replace(/\{[^{}]{1,60}\}/g, 'X').replace(/"[^"]{0,40}"/g, '""');
  if (!/^[A-Za-z0-9_ .,+\-*/()<>="%^]*$/.test(stripped)) return false;
  for (const m of stripped.matchAll(/([A-Za-z_][A-Za-z0-9_.]*)\s*\(/g)) if (!FORMULA_FUNCS.has(m[1].toUpperCase())) return false;
  // Bare identifiers other than X (a column) and function names would be cell references or names.
  for (const m of stripped.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b(?!\s*\()/g)) if (m[1] !== 'X') return false;
  return true;
}

const column = z.object({
  header: z.string().trim().min(1).max(60).regex(/^[^{}=+@\-][^{}]*$/, 'Header must not start with a formula character'),
  type: z.enum(['text', 'number', 'integer', 'money', 'percent', 'date']).default('text'),
  formula: z.string().max(400).optional(),
  total: z.enum(['sum', 'average', 'none']).optional(),
});
const cellValue = z.union([z.string().max(500), z.number(), z.null()]);

const CODE_EXT = ['py', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'html', 'css', 'json', 'sql', 'ps1', 'sh', 'rs', 'cpp', 'c', 'h', 'hpp', 'java', 'go', 'rb', 'php', 'cs', 'kt', 'swift', 'md', 'txt', 'csv', 'xml', 'yml', 'yaml', 'toml', 'ini', 'toml'] as const;

/** Opens a file in VS Code if it's registered, otherwise Notepad. Never "runs" the file. */
async function openInEditor(ctx: ToolContext, path: string, folder = false): Promise<string> {
  const code = ctx.repos.apps.list().find((a) => a.enabled && a.kind === 'exe' && /\\code\.exe$/i.test(a.target) && ctx.platform.fileExists(a.target));
  if (code) {
    await ctx.platform.spawnDetached(code.target, [path]);
    return 'VS Code';
  }
  if (folder) {
    await ctx.platform.spawnDetached(`${process.env.SystemRoot ?? 'C:\\Windows'}\\explorer.exe`, [path]);
    return 'File Explorer';
  }
  await ctx.platform.spawnDetached(`${process.env.SystemRoot ?? 'C:\\Windows'}\\System32\\notepad.exe`, [path]);
  return 'Notepad';
}

export const officeTools: ToolDef[] = [
  defineTool({
    name: 'sheet.create', title: 'Create Excel sheet',
    description: 'Create a formatted .xlsx spreadsheet in Documents\\Clickyy\\Sheets: bold frozen header, fitted columns, formulas that refer to columns as {Header} (SUM, AVERAGE, IF, ROUND, MIN, MAX, IFERROR), and a totals row. rows hold values for the non-formula columns in order. Opens it when done. Never overwrites.',
    category: 'Office', risk: 1, permission: null,
    input: z.object({
      title: z.string().trim().min(1).max(80),
      columns: z.array(column).min(1).max(40),
      rows: z.array(z.array(cellValue).max(40)).max(2000).default([]),
      minRows: z.number().int().min(0).max(200).default(0),
      totals: z.boolean().default(true),
      fileName: z.string().trim().max(80).optional(),
      open: z.boolean().default(true),
    }).strict(),
    confirm: 'never', timeoutMs: 20000, offline: true,
    describe: ({ title, rows }) => `Create the Excel sheet "${title}" with ${rows.length} row${rows.length === 1 ? '' : 's'}`,
    async run({ title, columns, rows, minRows, totals, fileName, open }, ctx) {
      const bad = columns.find((c) => c.formula && !safeFormula(c.formula));
      if (bad) return { ok: false, message: `The formula for ${bad.header} uses something I don't allow in sheets.` };
      const buf = buildXlsx({ title, columns: columns as SheetColumn[], rows, minRows, totals });
      const path = await writeNew(outputDir('Sheets'), fileName || title, '.xlsx', buf);
      let opened = '';
      if (open) {
        const err = await ctx.platform.openPath(path);
        opened = err ? ` I couldn't open it automatically (${err}).` : ' Opening it now.';
      }
      const computed = columns.filter((c) => c.formula).map((c) => c.header);
      const detail = `${path}\nColumns: ${columns.map((c) => c.header).join(', ')}${computed.length ? `\nCalculated: ${computed.join(', ')}` : ''}`;
      return { ok: true, data: { path, rows: rows.length }, message: `Your ${title} spreadsheet is saved as ${basename(path)} in Documents, Clickyy, Sheets, with ${rows.length ? `${rows.length} row${rows.length === 1 ? '' : 's'}` : 'blank rows ready to fill'}${computed.length ? ', live formulas' : ''}${totals ? ' and totals' : ''}.${opened}`, detail };
    },
  }),
  defineTool({
    name: 'document.save', title: 'Save a file you wrote',
    description: 'Save text you wrote (code, notes, flashcards, a script, a cheat sheet) as a new file in Documents\\Clickyy (Projects for code, Notes otherwise) and open it in VS Code or Notepad. It never runs the file and never overwrites.',
    category: 'Office', risk: 1, permission: null,
    input: z.object({
      name: z.string().trim().min(1).max(80),
      extension: z.enum(CODE_EXT).default('txt'),
      content: z.string().min(1).max(200_000),
      open: z.boolean().default(true),
    }).strict(),
    confirm: 'never', timeoutMs: 10000, offline: true,
    describe: ({ name, extension }) => `Save ${safeStem(name)}.${extension} in Documents\\Clickyy`,
    preview: async ({ content }) => content.slice(0, 1500),
    async run({ name, extension, content, open }, ctx) {
      const kind = ['txt', 'md', 'csv'].includes(extension) ? 'Notes' : 'Projects';
      const path = await writeNew(outputDir(kind), name, `.${extension}`, content);
      const editor = open ? await openInEditor(ctx, path) : '';
      return { ok: true, data: { path }, message: `Saved ${basename(path)} in Documents, Clickyy, ${kind}${editor ? `, and opened it in ${editor}` : ''}.`, detail: path };
    },
  }),
  defineTool({
    name: 'project.save', title: 'Save a code project',
    description: 'Save several files you wrote as a new project folder in Documents\\Clickyy\\Projects (relative paths like "src/app.py", "tests/test_app.py") and open it in VS Code (or File Explorer). Never runs anything and never overwrites.',
    category: 'Office', risk: 1, permission: null,
    input: z.object({
      name: z.string().trim().min(1).max(60),
      files: z.array(z.object({ path: z.string().trim().min(1).max(160), content: z.string().max(200_000) })).min(1).max(30),
      open: z.boolean().default(true),
    }).strict(),
    confirm: 'never', timeoutMs: 15000, offline: true,
    describe: ({ name, files }) => `Create project ${safeStem(name)} with ${files.length} files`,
    async run({ name, files, open }, ctx) {
      const root = outputDir('Projects');
      await mkdir(root, { recursive: true });
      const dir = uniquePath(root, safeStem(name, 'project'), '');
      for (const f of files) {
        const rel = normalize(f.path.replace(/\//g, sep));
        const ext = rel.split('.').pop()?.toLowerCase() ?? '';
        if (rel.startsWith('..') || /^[a-z]:/i.test(rel) || rel.startsWith(sep) || rel.split(sep).some((p) => !p || p !== safeStem(p, '') || p === '..')) return { ok: false, message: `The file name ${f.path} isn't allowed.` };
        if (!(CODE_EXT as readonly string[]).includes(ext) && !/^(readme|license|makefile|dockerfile|\.gitignore)$/i.test(basename(rel))) return { ok: false, message: `I don't save .${ext} files in projects.` };
        const p = join(dir, rel);
        if (!p.startsWith(dir + sep)) return { ok: false, message: `The file name ${f.path} isn't allowed.` };
        await mkdir(dirname(p), { recursive: true });
        if (existsSync(p)) continue;
        await writeFile(p, f.content, { flag: 'wx' });
      }
      const editor = open ? await openInEditor(ctx, dir, true) : '';
      return { ok: true, data: { path: dir, files: files.map((f) => f.path) }, message: `Created the ${basename(dir)} project with ${files.length} file${files.length === 1 ? '' : 's'} in Documents, Clickyy, Projects${editor ? `, and opened it in ${editor}` : ''}. I haven't run anything.`, detail: `${dir}\n${files.map((f) => `  ${f.path}`).join('\n')}` };
    },
  }),
];
