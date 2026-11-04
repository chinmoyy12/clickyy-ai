// Generates docs/COMMANDS.md from the live command catalog and tool registry.
import { build } from 'esbuild';
import { writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(root, 'scripts/.catalog-entry.ts');
const out = resolve(root, 'scripts/.catalog.mjs');
writeFileSync(entry, `export { CATALOG } from '../src/main/assistant/catalog';\nexport { createRegistry } from '../src/main/tools';\n`);
await build({ entryPoints: [entry], outfile: out, bundle: true, platform: 'node', format: 'esm', alias: { '@shared': resolve(root, 'src/shared') }, logLevel: 'error' });
const { CATALOG, createRegistry } = await import(pathToFileURL(out).href);
rmSync(entry);
rmSync(out);

const reg = createRegistry();
const risk = (r) => (r === 3 ? 'L3 destructive' : r === 2 ? 'L2 sensitive' : 'L1 low');
const lines = [
  '# Command catalog',
  '',
  `Generated from source by \`npm run docs:commands\`. **${CATALOG.length} deterministic commands**, **${CATALOG.reduce((n, c) => n + c.examples.length, 0)} example phrasings** (every example is an automated test in \`tests/router.test.ts\`), backed by **${reg.list().length} registered tools**.`,
  '',
  'Deterministic commands work fully offline with no language model. Anything not matched here goes to the configured language model, which can only call the tools listed at the bottom.',
  '',
];
for (const cat of [...new Set(CATALOG.map((c) => c.category))]) {
  lines.push(`## ${cat}`, '', '| Command | Example phrasings | Tool | Risk | Permission | Confirmation |', '|---|---|---|---|---|---|');
  for (const c of CATALOG.filter((x) => x.category === cat)) {
    const t = c.tool ? reg.get(c.tool) : null;
    const confirm = !t ? '—' : t.risk === 3 || t.confirm === 'always' ? 'always' : typeof t.confirm === 'function' ? 'conditional' : t.risk === 2 ? 'when proposed by the model' : 'no';
    lines.push(`| ${c.description} | ${c.examples.map((e) => `“${e}”`).join('<br>')} | ${c.tool ? `\`${c.tool}\`` : 'built-in'} | ${t ? risk(t.risk) : '—'} | ${t?.permission ?? '—'} | ${confirm} |`);
  }
  lines.push('');
}
lines.push('## Tool registry', '', 'Every tool has a typed zod input schema, permission, confirmation policy, timeout and audit logging. The model sees tool names with `__` instead of `.`.', '', '| Tool | Description | Risk | Permission | Timeout | Works offline |', '|---|---|---|---|---|---|');
for (const t of reg.list()) lines.push(`| \`${t.name}\` | ${t.description.replace(/\|/g, '/')} | ${risk(t.risk)} | ${t.permission ?? '—'} | ${t.timeoutMs / 1000}s | ${t.offline ? 'yes' : 'no'} |`);
lines.push('');
writeFileSync(resolve(root, '../../docs/COMMANDS.md'), lines.join('\n'));
console.log(`wrote docs/COMMANDS.md (${CATALOG.length} commands, ${reg.list().length} tools)`);
