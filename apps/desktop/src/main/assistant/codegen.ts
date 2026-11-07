/** Prompts and parsers for code, study and comparison tasks the language model does for the user. */

export interface Lang { id: string; label: string; ext: string; run: (file: string) => string; multi?: boolean }

export const LANGS: Lang[] = [
  { id: 'python', label: 'Python', ext: 'py', run: (f) => `python "${f}"` },
  { id: 'javascript', label: 'JavaScript', ext: 'js', run: (f) => `node "${f}"` },
  { id: 'typescript', label: 'TypeScript', ext: 'ts', run: (f) => `npx tsx "${f}"` },
  { id: 'cpp', label: 'C++', ext: 'cpp', run: (f) => `g++ -O2 -o app "${f}" && app` },
  { id: 'java', label: 'Java', ext: 'java', run: (f) => `java "${f}"` },
  { id: 'web', label: 'HTML, CSS and JavaScript', ext: 'html', run: (f) => `open "${f}" in your browser`, multi: true },
  { id: 'bash', label: 'Bash', ext: 'sh', run: (f) => `bash "${f}" (in Git Bash or WSL)` },
  { id: 'powershell', label: 'PowerShell', ext: 'ps1', run: (f) => `powershell -File "${f}" after reading it` },
  { id: 'sql', label: 'SQL', ext: 'sql', run: (f) => `sqlite3 my.db < "${f}"` },
  { id: 'rust', label: 'Rust', ext: 'rs', run: (f) => `rustc "${f}" && the resulting exe` },
  { id: 'csharp', label: 'C#', ext: 'cs', run: () => 'dotnet run inside a console project' },
  { id: 'go', label: 'Go', ext: 'go', run: (f) => `go run "${f}"` },
];

const LANG_WORDS: Array<[RegExp, string]> = [
  [/\bpython\b/, 'python'], [/\btypescript\b|\bts\b/, 'typescript'], [/\bhtml(?:\s*\/\s*css(?:\s*\/\s*js)?)?\b|\bweb page\b|\bwebsite\b/, 'web'],
  [/\bjavascript\b|\bnode(?:\.?js)?\b|\bjs\b/, 'javascript'], [/\bc\+\+|\bcpp\b/, 'cpp'], [/\bjava\b/, 'java'], [/\bbash\b|\bshell script\b/, 'bash'],
  [/\bpowershell\b/, 'powershell'], [/\bsql\b/, 'sql'], [/\brust\b/, 'rust'], [/\bc#|\bc sharp\b/, 'csharp'], [/\bgolang\b|\bgo\b(?= (?:program|script|code|project|app))/, 'go'],
];

export function findLang(text: string): Lang | null {
  for (const [re, id] of LANG_WORDS) if (re.test(text)) return LANGS.find((l) => l.id === id)!;
  return null;
}

export type CodeMode = 'write' | 'scaffold' | 'document';

export function codePrompt(mode: CodeMode, lang: Lang, task: string): string {
  const what = mode === 'scaffold'
    ? `Create a small, modular ${lang.label} project for: ${task}. Include a README.md, the source split into sensible modules, and unit tests${lang.id === 'python' ? ' using pytest' : ''}. Keep it under 8 files.`
    : mode === 'document'
      ? `Write a clean ${lang.label} implementation of: ${task}. Add thorough docstrings/comments to every function and class, then explain in 3 short sentences how it works.`
      : `Write a complete, working ${lang.label} ${lang.multi ? 'page (index.html, style.css, script.js)' : 'program'} for: ${task}. Handle errors sensibly and use only the standard library unless a common package is essential (say which).`;
  return `${what}

Format your answer exactly like this, with nothing else:
SUMMARY: one or two plain sentences saying what you built and how to use it.
FILE: relative/path.${lang.ext}
\`\`\`
...file contents...
\`\`\`
(repeat FILE blocks for more files)

Never include code that deletes files outside its own folder, changes system settings, or downloads and runs other programs.`;
}

export interface GeneratedFile { path: string; content: string }

/** Pulls FILE blocks (or bare code blocks) out of a model answer. */
export function parseCodeFiles(text: string, lang: Lang, fallbackName: string): { summary: string; files: GeneratedFile[] } {
  const summary = text.match(/SUMMARY:\s*([^\n]+(?:\n(?!FILE:|```)[^\n]+)*)/i)?.[1]?.trim() ?? '';
  const files: GeneratedFile[] = [];
  const re = /FILE:\s*`?([^\n`]+?)`?\s*\n+```[^\n]*\n([\s\S]*?)```/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const path = m[1].trim().replace(/\\/g, '/').replace(/^\.?\/+/, '');
    if (path && !path.includes('..') && !/^[a-z]:/i.test(path)) files.push({ path, content: m[2].replace(/\s+$/, '\n') });
  }
  if (!files.length) {
    const blocks = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)].map((b) => b[1]);
    if (blocks.length) files.push({ path: `${fallbackName}.${lang.ext}`, content: blocks.sort((a, b) => b.length - a.length)[0].replace(/\s+$/, '\n') });
  }
  return { summary, files };
}

/** A short file stem from a task description: "REST API client with retry…" → "rest_api_client". */
export function taskSlug(task: string): string {
  const words = task.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w && !['a', 'an', 'the', 'for', 'with', 'and', 'that', 'of', 'to', 'by', 'my'].includes(w));
  return words.slice(0, 4).join('_') || 'program';
}

export function flashcardPrompt(topic: string): string {
  return `Make 15 study flashcards about ${topic}. Plain text only, one card per pair of lines, exactly:
Q: question
A: short answer

Then a blank line between cards. No introduction.`;
}

export function comparisonPrompt(topic: string): string {
  return `Compare ${topic} with its main traditional alternatives (2 to 4 of them) across 6 to 8 criteria such as cost, speed, maturity, typical use cases, strengths and weaknesses.
Reply with JSON only, no prose, in this shape:
{"criteria": ["Criterion 1", ...], "options": [{"name": "${topic}", "values": ["...", ...]}, {"name": "Alternative", "values": ["...", ...]}]}
Each values array has one short entry (under 12 words) per criterion.`;
}

/** Turns the comparison JSON into spreadsheet columns and rows (criteria down, options across). */
export function parseComparison(text: string): { columns: string[]; rows: string[][] } | null {
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try {
    const data = JSON.parse(json) as { criteria?: unknown; options?: Array<{ name?: unknown; values?: unknown }> };
    const criteria = Array.isArray(data.criteria) ? data.criteria.map(String).slice(0, 20) : [];
    const options = (Array.isArray(data.options) ? data.options : []).filter((o) => typeof o?.name === 'string' && Array.isArray(o.values)).slice(0, 6);
    if (criteria.length < 2 || options.length < 2) return null;
    const columns = ['Criterion', ...options.map((o) => String(o.name).slice(0, 40))];
    const rows = criteria.map((c, i) => [c.slice(0, 80), ...options.map((o) => String((o.values as unknown[])[i] ?? '').slice(0, 200))]);
    return { columns, rows };
  } catch {
    return null;
  }
}

export function messagePrompt(channel: 'email' | 'whatsapp', name: string, topic: string, userName?: string): string {
  return channel === 'email'
    ? `Write a short, friendly, professional email to ${name} about ${topic}. Reply in this format only:
SUBJECT: subject line
BODY:
the email body (3 to 6 sentences, sign off${userName ? ` as ${userName}` : ' with a placeholder name'}).
Use placeholders like [date] for facts you don't know.`
    : `Write a short, friendly WhatsApp message (1 to 3 sentences) to ${name} about ${topic}. Use placeholders like [time] for facts you don't know. Reply with the message only.`;
}

export function parseEmail(text: string, topic: string): { subject: string; body: string } {
  const subject = text.match(/SUBJECT:\s*([^\n]+)/i)?.[1]?.trim() ?? topic;
  const body = text.match(/BODY:\s*([\s\S]+)/i)?.[1]?.trim() ?? text.trim();
  return { subject: subject.slice(0, 150), body: body.slice(0, 1800) };
}
