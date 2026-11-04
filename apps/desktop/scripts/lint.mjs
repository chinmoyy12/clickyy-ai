// Security-focused lint. Fails the build on patterns Clickyy must never contain.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RULES = [
  { re: /nodeIntegration:\s*true/, msg: 'nodeIntegration must stay disabled' },
  { re: /contextIsolation:\s*false/, msg: 'contextIsolation must stay enabled' },
  { re: /sandbox:\s*false/, msg: 'renderer sandbox must stay enabled' },
  { re: /webSecurity:\s*false/, msg: 'webSecurity must stay enabled' },
  { re: /shell:\s*true/, msg: 'never spawn through a shell' },
  { re: /(?<![.\w])(exec|execSync|spawnSync)\s*\(|import\s*\{[^}]*\b(exec|execSync)\b[^}]*\}\s*from\s*['"](node:)?child_process['"]/, msg: 'use execFile/spawn with argument arrays (no shell strings)' },
  { re: /\beval\s*\(|new Function\s*\(/, msg: 'no dynamic code evaluation' },
  { re: /dangerouslySetInnerHTML|\.innerHTML\s*=/, msg: 'no raw HTML injection' },
  { re: /sk-ant-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{32,}/, msg: 'possible hardcoded API key' },
  { re: /Invoke-Expression|\biex\b|Start-Process\s+-Verb\s+RunAs/i, msg: 'no dynamic PowerShell or elevation' },
  { re: /exposeInMainWorld\([^)]*ipcRenderer\s*\)/, msg: 'never expose ipcRenderer directly' },
];
const exts = /\.(ts|tsx|mjs|js|ps1)$/;
const skip = /node_modules|dist|release|scripts[\\/]lint\.mjs$|public[\\/]pcm-worklet\.js$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip.test(p)) continue;
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (exts.test(name)) yield p;
  }
}

let problems = 0;
let files = 0;
for (const dir of ['src', 'resources', 'scripts']) {
  for (const file of walk(join(root, dir))) {
    files++;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/lint-ignore/.test(line)) return;
      for (const r of RULES) if (r.re.test(line)) { problems++; console.log(`${relative(root, file)}:${i + 1}  ${r.msg}\n    ${line.trim()}`); }
    });
  }
}
console.log(problems ? `\n${problems} problem(s) in ${files} files` : `security lint: ${files} files clean`);
process.exit(problems ? 1 : 0);
