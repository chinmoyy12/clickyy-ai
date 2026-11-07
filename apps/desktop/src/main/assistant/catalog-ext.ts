/**
 * Commands added from the 10,000-command analysis: music, the interactive Excel builder,
 * code generation, Windows features, power timers, diagnostics, app and window control,
 * files by type, web extras, productivity and messaging. Patterns run on normalized text
 * (lowercase, no quotes or commas, spoken numbers as digits).
 */
import type { Builtin, CommandDef, PendingSlot, Resolution, RouteCtx } from './catalog';
import { inBrowser } from './browserAsk';
import { parseClockTime, parseDuration } from './normalize';
import { findSearchSite, searchSiteUrl } from './knowledge/sites';
import { findFeature } from './knowledge/features';
import { findMetric, type MetricId } from './knowledge/metrics';
import { amortizationRows, findSheetTemplate, SHEET_BY_ID, type SheetTemplate } from './knowledge/sheets';
import { findLang, type CodeMode } from './codegen';

const tool = (t: string, args: Record<string, unknown> = {}): Resolution => ({ kind: 'tool', tool: t, args });
const builtin = (b: Builtin, params?: Record<string, unknown>): Resolution => ({ kind: 'builtin', builtin: b, params });
const clarify = (question: string, pending?: PendingSlot): Resolution => ({ kind: 'clarify', question, pending });
const say = (text: string) => builtin('say', { text });
const cmd = (def: CommandDef) => ({ atomic: true, ...def });
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clean = (s: string) => s.replace(/^(?:my|the|a|an)\s+/, '').trim();

const CANCEL = /^(cancel|stop|quit|exit|never ?mind|forget (it|about it)|abort)\b/;
/** Requests that try to smuggle something destructive into a "write code" or "Excel" request. */
const DESTRUCTIVE = /\b(del|rmdir|rm -rf|format [a-z]:|remove-item|reg delete|system ?32|bcdedit|diskpart|cipher \/w|ransom|keylogger|steal|malware|virus|exploit)\b/;

// ---------------------------------------------------------------- Excel builder
const inputColumns = (t: SheetTemplate) => t.columns.filter((c) => !c.formula);
const formulaColumns = (t: SheetTemplate) => t.columns.filter((c) => c.formula);

function sheetStart(t: SheetTemplate, firstRow?: string[]): Resolution {
  if (t.generator === 'loan') return clarify('For the EMI schedule, tell me the loan amount, the yearly interest rate and the term. For example: 25 lakh at 8.5 percent for 20 years. You can add "with a prepayment of 5000 a month".', { commandId: 'excel.build', slot: 'loan', partial: { tpl: t.id } });
  const ins = inputColumns(t).map((c) => c.header);
  const f = formulaColumns(t).map((c) => c.header);
  const rows = firstRow ? [firstRow] : [];
  const lead = firstRow ? `I started your ${t.title} with ${firstRow[0]}.` : `I'll build a ${t.title} in Excel.`;
  return clarify(`${lead} Columns: ${ins.join(', ')}${f.length ? `, and ${f.join(' and ')} worked out with formulas` : ''}. Tell me ${firstRow ? 'the next' : 'the first'} row, for example "${t.example}". Say "done" when you've finished, "undo" to remove the last row, or "blank" for an empty template.`,
    { commandId: 'excel.build', slot: 'rows', partial: { tpl: t.id, rows } });
}

const NUM_TOKEN = /^[₹$€£]?-?\d[\d.]*(?:k|l|cr|%)?$/i;
/** "Rent, fixed, 15,000, 14500" or "rent fixed 15000 14500" → cells for the input columns. */
export function parseRow(raw: string, columns: number): string[] {
  const s = raw.trim().replace(/(\d),(?=\d{3}\b)/g, '$1').replace(/[.!]+$/, '');
  if (/[,;|\t]/.test(s)) return s.split(/\s*[,;|\t]\s*/).map((x) => x.trim()).filter(Boolean).slice(0, columns);
  const out: string[] = [];
  let text: string[] = [];
  for (const tok of s.split(/\s+/)) {
    if (NUM_TOKEN.test(tok) || /^\d{4}-\d{2}-\d{2}$/.test(tok)) {
      if (text.length) { out.push(text.join(' ')); text = []; }
      out.push(tok);
    } else if (/^(lakh|lakhs|lac|crore|crores|thousand|k)$/i.test(tok) && out.length && NUM_TOKEN.test(out[out.length - 1])) {
      out[out.length - 1] += ` ${tok}`;
    } else text.push(tok);
  }
  if (text.length) out.push(text.join(' '));
  return out.slice(0, columns);
}

const AMOUNT = (s: string) => {
  const m = s.match(/(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|crores?|cr|k|thousand|million|m)?\b/);
  if (!m) return null;
  const mult = /^lakh|^lac/.test(m[2] ?? '') ? 1e5 : /^cr/.test(m[2] ?? '') ? 1e7 : /^(k|thousand)$/.test(m[2] ?? '') ? 1e3 : /^(million|m)$/.test(m[2] ?? '') ? 1e6 : 1;
  return parseFloat(m[1]) * mult;
};

export function parseLoan(text: string): { principal: number; rate: number; months: number; prepayment: number } | null {
  const t = text.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, '$1');
  const rate = t.match(/(\d+(?:\.\d+)?)\s*(?:percent|%|per cent)/);
  const term = t.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?)\b/);
  const before = t.split(/\bat\b|\d+(?:\.\d+)?\s*(?:percent|%)/)[0];
  const principal = AMOUNT(before);
  const pre = t.match(/prepay(?:ment|ing)?(?: of)? ([\d.]+\s*(?:k|lakh|thousand)?)/);
  if (!rate || !term || !principal) {
    // Bare form: "500000 9.5 60" (amount, rate, months).
    const nums = t.match(/\d+(?:\.\d+)?/g);
    if (nums && nums.length >= 3) return { principal: parseFloat(nums[0]), rate: parseFloat(nums[1]), months: Math.round(parseFloat(nums[2])), prepayment: 0 };
    return null;
  }
  const months = Math.round(parseFloat(term[1]) * (/^month/.test(term[2]) ? 1 : 12));
  if (principal <= 0 || months < 1 || months > 600 || parseFloat(rate[1]) > 50) return null;
  return { principal, rate: parseFloat(rate[1]), months, prepayment: pre ? AMOUNT(pre[1]) ?? 0 : 0 };
}

function buildSheet(t: SheetTemplate, rows: unknown[][], columns = t.columns): Resolution {
  return tool('sheet.create', { title: t.title, columns, rows, minRows: rows.length ? 0 : 15, totals: true, fileName: t.file });
}

function customColumns(spec: string) {
  return spec.split(/\s*(?:,|;|\band\b)\s*/).map((h) => h.trim()).filter(Boolean).slice(0, 20).map((h) => ({
    header: cap(h.replace(/^[=+@-]+/, '')).slice(0, 60),
    type: /amount|cost|price|salary|budget|total|value|fee|rent|income|expense|revenue|balance|paid/i.test(h) ? 'money' : /date|day|deadline|due/i.test(h) ? 'date' : /qty|quantity|count|number|hours|units|score|marks/i.test(h) ? 'number' : /percent|rate|%/i.test(h) ? 'percent' : 'text',
  }));
}

// ---------------------------------------------------------------- music
const SERVICE = /\s+(?:on|in|using|with|from) (spotify|youtube music|yt music)$/;

// ---------------------------------------------------------------- apps
/** "Terminal / Command Prompt" → "terminal", "PyCharm IDE" → "pycharm", "WhatsApp Desktop" → "whatsapp". */
export function appName(raw: string): string {
  return raw.split(/\s+\/\s+|\s+or\s+/)[0].replace(/^(?:the|my)\s+/, '').replace(/\s+(?:ide|desktop|app|application|program|window|windows)$/, '').replace(/\s+(?:on my (?:laptop|pc|computer|screen))$/, '').trim();
}
const NOT_AN_APP = /^(it|this|that|window|current window|all|everything|the window|laptop|pc|computer|screen|monitor|display|system|session|my laptop|my pc|my computer)$/;
const appArg = (raw: string) => {
  const a = appName(raw);
  return !a || NOT_AN_APP.test(a) || a.split(' ').length > 5 ? null : a;
};

// ---------------------------------------------------------------- power
type PowerAction = 'lock' | 'sleep' | 'hibernate' | 'shutdown' | 'restart' | 'signout' | 'display_off';
export function powerAction(text: string): PowerAction | null {
  if (/\b(turn|switch|shut) off (?:the )?(?:laptop |pc )?(monitor|display|screen)\b|\b(monitor|display|screen) off\b/.test(text)) return 'display_off';
  if (/\block\b/.test(text)) return 'lock';
  if (/\bhibernat/.test(text)) return 'hibernate';
  if (/\b(restart|reboot)\b/.test(text)) return 'restart';
  if (/\b(shut ?down|power off|turn off)\b/.test(text)) return 'shutdown';
  if (/\b(sign out|log ?out|log off|sign me out)\b/.test(text)) return 'signout';
  if (/\bsleep\b/.test(text)) return 'sleep';
  return null;
}
const DEVICE = /\b(laptop|pc|computer|system|machine|screen|monitor|display|workstation|session|windows)\b/;
/** Power phrases that are really about something else: a Windows feature, an app or a settings window. */
function notPower(text: string, a: PowerAction): boolean {
  if (/ \/ |\bsettings\b|\bcontrol panel\b|\btask manager\b|\bexplorer\b/.test(text)) return true;
  // "turn off" means shut down only when the laptop itself is the object.
  if (a === 'shutdown' && /^(?:turn|switch) off\b/.test(text) && !/^(?:turn|switch) off (?:my |the )?(?:laptop|pc|computer|system|machine)\b/.test(text)) return true;
  if (a === 'display_off' && !/^(?:turn|switch|shut) off (?:my |the )?(?:laptop |pc )?(?:monitor|display|screen)\b(?: without sleeping| now| for now)?(?: (?:in|after) .+)?$/.test(text) && !/\b(?:monitor|display|screen) off\b/.test(text)) return true;
  return false;
}
const POWER_START = /^(?:lock|put|send|hibernate|restart|reboot|shut ?down|sign (?:me )?out|log ?out|log off|turn off|switch off|power off|sleep)\b/;

// ---------------------------------------------------------------- files
const FILE_TYPE_WORDS: Array<[RegExp, string]> = [
  [/\bpdfs?\b/, 'pdf'], [/\bexcel\b|\bspreadsheets?\b|\bxlsx\b/, 'excel'], [/\bcsv\b/, 'csv'], [/\bword (?:documents?|files?|docs?)\b|\bdocx\b/, 'word'],
  [/\bpowerpoints?\b|\bpresentations?\b|\bslides?\b|\bpptx?\b/, 'powerpoint'], [/\bmarkdown\b|\b\.?md files?\b/, 'markdown'], [/\bpython\b/, 'python'],
  [/\bzips?\b|\barchives?\b|\brar\b/, 'zip'], [/\bimages?\b|\bphotos?\b|\bpictures\b(?! folder)|\bpngs?\b|\bjpe?gs?\b|\bscreenshots\b/, 'images'],
  [/\bvideos?\b(?! folder)|\bmp4s?\b|\bmovies\b/, 'videos'], [/\baudio files?\b|\bmp3s?\b|\bsongs\b/, 'audio'], [/\btext files?\b|\btxt\b/, 'text'],
];
export function fileType(text: string): string | null {
  for (const [re, id] of FILE_TYPE_WORDS) if (re.test(text)) return id;
  return null;
}
export function fileFolder(text: string): string | null {
  const m = text.match(/\b(?:in|from|inside|within|of|under) (?:my |the )?([a-z0-9 _.-]+?)(?: folder| directory)?(?= by | into | to | with | modified | changed | from | that |$)/g);
  for (const part of (m ?? []).reverse()) {
    const f = part.replace(/^(?:in|from|inside|within|of|under) (?:my |the )?/, '').replace(/ (?:folder|directory)$/, '').trim();
    if (f && !fileType(f) && !/^(all|any|the|it|them|today|newest|date)$/.test(f) && f.split(' ').length <= 3) return f;
  }
  const std = text.match(/\b(desktop|downloads|documents|pictures|music|videos)\b/);
  return std?.[1] ?? null;
}

// ---------------------------------------------------------------- diagnostics
interface DiagPlan { detail: 'brief' | 'assess' | 'sample'; output: string; note?: string; spike?: boolean; desktop?: boolean }
const DIAG_ACTIONS: Array<[RegExp, DiagPlan]> = [
  [/\bexport\b.*\b(text|txt) (log|file)\b|\barchive\b|\bsave\b.*\b(text|log) file\b/, { detail: 'brief', output: 'file' }],
  [/\bevery (hour|day|minute)\b|\bhourly\b|\blog\b.*\btoday\b/, { detail: 'brief', output: 'file', note: "I can't log on a schedule yet, so I saved one snapshot now. Ask again whenever you want another." }],
  [/\bexcel\b/, { detail: 'brief', output: 'excel' }],
  [/\bjson\b/, { detail: 'brief', output: 'json' }],
  [/\bclipboard\b/, { detail: 'brief', output: 'clipboard' }],
  [/\bwidget\b|\bhud\b|\boverlay\b/, { detail: 'brief', output: 'notify', note: "I can't pin a live widget to the desktop, so here it is as a notification." }],
  [/\bnotification\b|\bnotify\b|\btoast\b/, { detail: 'brief', output: 'notify' }],
  [/\bscreenshot\b|\bsnapshot\b(?!.*\bemail)/, { detail: 'brief', output: 'snapshot' }],
  [/\bemail\b|\bmail me\b/, { detail: 'brief', output: 'email' }],
  [/\bpin\b.*\bnotes?\b|\bto my notes\b/, { detail: 'brief', output: 'note' }],
  [/\bhistor(y|ical)\b|\btrend\b|\bover time\b/, { detail: 'brief', output: 'speak', note: "I don't keep a history of measurements yet, so this is the current reading." }],
  [/\blive\b|\bmonitor\b|\bwhile i\b|\bstress\b|\bstability\b|\b\d+[- ]second\b|\bsample\b/, { detail: 'sample', output: 'speak' }],
  [/\bspiking\b|\bculprit\b|\bwhich app\b|\bbackground app\b|\bhogging\b/, { detail: 'brief', output: 'speak', spike: true }],
  [/\bfree up\b|\breclaim\b/, { detail: 'assess', output: 'speak', note: "I don't close apps without asking. Say \"force quit\" and an app name if one is stuck." }],
  [/\bwarn\b|\bissue\b|\bsafe limits?\b|\bverify\b|\bvalidate\b|\baudit\b|\btroubleshoot\b|\bbottleneck\b|\bbefore i start\b|\bpreflight\b|\boptimi[sz]e\b|\bimprove\b|\bbaseline\b|\bdeep\b|\bmorning\b|\bhealth\b|\banomal/, { detail: 'assess', output: 'speak' }],
  [/\bcheck\b|\bshow\b|\bsummari[sz]e\b|\bread out\b|\baloud\b|\btell me\b|\bstatus\b|\breport\b|\brefresh\b|\bre-?scan\b|\bscan\b|\bprint\b|\btable\b|\bwhat(s| is)\b|\bhow\b|\bgive me\b|\blist\b|\bmeasure\b|\bget\b/, { detail: 'brief', output: 'speak' }],
];
export function diagPlan(text: string): DiagPlan | null {
  for (const [re, plan] of DIAG_ACTIONS) if (re.test(text)) return { ...plan, desktop: /\bdesktop\b/.test(text) && plan.output !== 'notify' };
  return null;
}
const SPIKE: Partial<Record<MetricId, MetricId>> = { cpu: 'cpu_top', gpu: 'cpu_top', ram: 'ram_top', diskio: 'cpu_top', netio: 'cpu_top' };

// ---------------------------------------------------------------- web
const PLATFORM = '(google scholar|google|youtube music|youtube|github|stack overflow|stackoverflow|wikipedia|reddit|medium|amazon|bing|duckduckgo|yt music)';

// ---------------------------------------------------------------- productivity
const TODO_LIST = /(?:to[- ]?do|todo|task|tasks)(?: list)?/;
const isoAt = (d: Date | null) => d?.toISOString();

/** Runs before the safety filter: these requests mention "run" or "script" but never execute anything. */
const CODE_FIRST_DEFS: CommandDef[] = [
  cmd({ id: 'ai.excel_compare', category: 'AI', description: 'Compare a topic with its alternatives in a new Excel sheet (needs a language model).', examples: ['compare quantum computing with traditional alternatives in an excel sheet', 'compare react and vue in a spreadsheet'],
    patterns: [/^(?:compare|make a comparison of) (.+?) (?:with|against|versus|vs|to|and) (?:its |the )?(?:traditional |common |main )?(.+?) (?:in|into|as) (?:an? )?(?:excel|spreadsheet|xlsx)(?: sheet| table| file)?$/],
    resolve: (m) => builtin('ai_task', { kind: 'excel_compare', topic: /alternatives?$/.test(m[2]) ? clean(m[1]) : `${clean(m[1])} and ${clean(m[2])}` }) }),
  cmd({ id: 'excel.habit_row', category: 'Excel', description: 'Start a habit scorecard in Excel with a habit already filled in.', examples: ['create an excel habit row for gym workout session'],
    patterns: [/^(?:create|add|make) (?:an? )?(?:excel |spreadsheet )habit (?:row|entry|line) for (?:my )?(.+)$/],
    resolve: (m) => sheetStart(SHEET_BY_ID.get('habit')!, [cap(clean(m[1]))]) }),
  cmd({ id: 'excel.build', category: 'Excel', tool: 'sheet.create', description: 'Interactive Excel builder: asks for your rows, then makes a formatted .xlsx with formulas and totals (30 templates: budget, invoice, EMI schedule, inventory, payroll and more).', examples: ['create an excel sheet for a monthly personal budget by asking me questions', 'build an invoice in excel', 'make an emi and loan amortization schedule in excel', 'start an interactive excel builder for a workout log'],
    patterns: [/\b(excel|spreadsheet|xlsx|workbook)\b/],
    resolve: (_m, text) => {
      if (DESTRUCTIVE.test(text) || findMetric(text) && /\b(table|report) of\b/.test(text)) return null;
      // "Draft an email about the Excel report" is a message, not a spreadsheet.
      if (/^(?:draft|write|send|compose|prepare)(?: me)?(?: an?)? (?:quick |short |formal )?(?:e-?mail|mail|whatsapp|message|text|msg)\b/.test(text)) return null;
      if (!/\b(create|build|make|generate|help|set up|setup|design|start|write|prepare|draft|export|launch|assemble|produce|construct|initiali[sz]e|compile|update|open|i need|i want|new)\b/.test(text)) return null;
      const t = findSheetTemplate(text);
      if (t) return sheetStart(t);
      if (/\b(budget|tracker|log|sheet|planner|calculator|register|list|schedule|report)\b/.test(text) || /^(create|make|build|start|open) (?:a |an )?(?:new )?(?:excel|spreadsheet)/.test(text)) {
        return clarify('What should the spreadsheet be for? For example a monthly budget, invoice, EMI schedule, inventory, attendance, gradebook or travel plan. Or say "use columns" and list them.', { commandId: 'excel.build', slot: 'kind', partial: {} });
      }
      return null;
    },
    fillFirst: true,
    fill: (answer, p, _ctx, raw) => {
      const r = raw ?? answer;
      if (CANCEL.test(answer)) return say("Okay, I've stopped building the spreadsheet. Nothing was saved.");
      if (p.slot === 'kind' || (!p.tpl && !p.custom)) {
        const cols = answer.match(/^(?:use |with )?(?:the )?columns? (.+)$/);
        if (cols) {
          const columns = customColumns(r.replace(/^(?:use |with )?(?:the )?columns?\s*/i, ''));
          return clarify(`Columns set: ${columns.map((c) => c.header).join(', ')}. Tell me the first row, or say "done".`, { commandId: 'excel.build', slot: 'rows', partial: { custom: columns, title: 'My Spreadsheet', rows: [] } });
        }
        const t = findSheetTemplate(answer);
        return t ? sheetStart(t) : clarify("I don't have a template for that yet. Say one like budget, invoice or inventory, or say \"use columns\" and list the column names.", { commandId: 'excel.build', slot: 'kind', partial: {} });
      }
      const t = p.tpl ? SHEET_BY_ID.get(String(p.tpl)) : undefined;
      const custom = p.custom as Array<{ header: string; type: string }> | undefined;
      const columns = custom ?? t?.columns ?? [];
      const title = t?.title ?? String(p.title ?? 'My Spreadsheet');
      const make = (rows: unknown[][]) => (t && !custom ? buildSheet(t, rows) : tool('sheet.create', { title, columns, rows, minRows: rows.length ? 0 : 15, totals: true }));
      if (t?.generator === 'loan') {
        const loan = parseLoan(r);
        if (!loan) return clarify('I need the amount, the yearly interest rate and the term, like "25 lakh at 8.5 percent for 20 years".', { commandId: 'excel.build', slot: 'loan', partial: p });
        return buildSheet(t, amortizationRows(loan.principal, loan.rate, loan.months, new Date(), loan.prepayment));
      }
      const rows = [...((p.rows as unknown[][]) ?? [])];
      const next = (q: string) => clarify(q, { commandId: 'excel.build', slot: 'rows', partial: { ...p, rows } });
      if (/^(done|finish(ed)?|that'?s (all|it|everything)|thats (all|it|everything)|no more|nothing else|create it|make it|build it|save it|complete|i'?m done|im done|all done|finish it)\b/.test(answer)) return make(rows);
      if (/^(blank|empty|skip|template only|no data|just (make|create|give me) (it|the (template|sheet|file)))\b/.test(answer)) return make([]);
      if (/^(undo|remove (the )?last( row)?|delete (the )?last( row)?|scratch that)\b/.test(answer)) {
        const gone = rows.pop();
        return next(gone ? `Removed ${(gone as string[]).join(', ')}. ${rows.length} row${rows.length === 1 ? '' : 's'} so far. Next row, or say "done".` : 'There are no rows yet. Tell me the first row.');
      }
      const cols = answer.match(/^(?:use |change (?:the )?)columns?(?: to)? (.+)$/);
      if (cols) {
        const columns2 = customColumns(r.replace(/^(?:use |change (?:the )?)columns?(?: to)?\s*/i, ''));
        return clarify(`Columns changed to ${columns2.map((c) => c.header).join(', ')}. I cleared the rows; tell me the first one.`, { commandId: 'excel.build', slot: 'rows', partial: { custom: columns2, title, rows: [] } });
      }
      const width = (custom ?? (t ? inputColumns(t) : [])).length || 10;
      const values = parseRow(r, width);
      if (!values.length) return null;
      if (rows.length >= 200) return make(rows);
      rows.push(values);
      return next(`Added: ${values.join(', ')}. That's ${rows.length} row${rows.length === 1 ? '' : 's'}. Next row, or say "done".`);
    } }),
  cmd({ id: 'code.task', category: 'Code', description: 'Write code, a whole project with tests, or a documented implementation, and save it in Documents\\Clickyy\\Projects. Clickyy never runs code; it tells you how. Needs a language model.', examples: ['write a python program for a rest api client with retry logic', 'create a modular typescript project for a websocket chat server with unit tests', 'write and run a python script for a duplicate file finder', 'explain and add docstrings to a java implementation of a binary search tree'],
    patterns: [
      /^(?:write|create|code|build|make|generate|give me)(?: and (?:run|execute|test))? (?:me )?(?:a |an )?(.+?) (program|script|app|application|tool|utility|implementation|module|function|class|simulation|demo|cli|page|website|code)(?: or (?:a |an )?\w+)? (?:for|that|to|which|illustrating|showing|about|demonstrating) (?:a |an )?(.+)$/,
      /^(?:create|scaffold|set up|start|generate|build) (?:a |an )?(?:new )?(?:modular |clean |small |complete )?(.+?) (project|repo|repository|package|codebase) for (?:a |an )?(.+?)$/,
      /^(?:explain and )?(?:add|write) (?:docstrings|comments|documentation) (?:to|for) (?:a |an |my )?(.+?) (implementation|program|code|script|module) (?:of|for) (?:a |an )?(.+)$/,
      /^(?:debug|fix|optimi[sz]e|refactor|review|improve)(?: and (?:optimi[sz]e|refactor|fix|debug|improve|clean up))? (?:my |the |this )(.+?) (code|program|script|implementation|project) (?:for|of) (?:a |an )?(.+)$/,
    ],
    resolve: (m, text) => {
      if (DESTRUCTIVE.test(text)) return null;
      const lang = findLang(m[1]) ?? (/\b(page|website)\b/.test(m[2]) ? findLang('html') : null);
      if (!lang || m[1].split(' ').length > 6) return null;
      const task = m[3].replace(/\s+(?:on my (?:laptop|pc|computer)|for me)$/, '').replace(/\s+with (?:unit )?tests$/, '').trim();
      if (/^(?:debug|fix|optimi|refactor|review|improve)/.test(text)) return builtin('code_task', { mode: 'debug', language: lang.id, task });
      const mode: CodeMode = /^(?:explain and )?(?:add|write) (?:docstrings|comments|documentation)/.test(text) ? 'document' : /\b(project|repo|repository|package|codebase)\b/.test(m[2]) ? 'scaffold' : 'write';
      return builtin('code_task', { mode, language: lang.id, task, run: /\band (run|execute|test)\b/.test(text), tests: /\btests?\b/.test(text) });
    },
    // A code request is one request however many "and"s its description has.
    absorbs: '*' }),
];
/** Code requests go first so "a Python program for an Excel report" is code, not the Excel builder. */
export const CODE_FIRST: CommandDef[] = [...CODE_FIRST_DEFS.filter((c) => c.id === 'code.task'), ...CODE_FIRST_DEFS.filter((c) => c.id !== 'code.task')];

/** Inserted after the conversation commands and before the older, broader patterns. */
export const EXTENDED: CommandDef[] = [
  // ---------------------------------------------------------------- music
  cmd({ id: 'music.next', category: 'Media', tool: 'media.control', description: 'Next track (more ways to say it).', examples: ['skip to the next track', 'go to the next song'],
    patterns: [/^(?:skip|go|jump|move|switch)(?: ahead| forward)? to (?:the )?next (?:track|song)$/, /^next (?:track|song) please$/], resolve: () => tool('media.control', { action: 'next' }) }),
  cmd({ id: 'music.previous', category: 'Media', tool: 'media.control', description: 'Previous track (more ways to say it).', examples: ['go back to the previous song', 'skip back a track'],
    patterns: [/^(?:go|skip|jump|move) back(?: to)?(?: the)? (?:previous|last) (?:track|song)$/, /^skip back(?: a| one)? (?:track|song)$/, /^(?:replay|restart) the (?:previous|last) (?:track|song)$/], resolve: () => tool('media.control', { action: 'previous' }) }),
  cmd({ id: 'music.stop_after', category: 'Media', tool: 'media.stop_after', description: 'Pause when the current song ends, or after some minutes (music sleep timer).', examples: ['pause after this song', 'pause playback automatically after the current song finishes', 'stop the music in 30 minutes'],
    patterns: [/\b(?:pause|stop)(?: the)?(?: playback| music| song)?(?: automatically)? (?:after|when|once) (?:the |this )?(?:current )?(?:.{0,40} )?(?:song|track)(?: finishes| ends| is over| is done)?$/, /^(?:pause|stop) (?:the )?(?:music|playback|song|spotify) in (\d+(?:\.\d+)?) (minutes?|hours?)$/],
    resolve: (m, text) => (m[1] ? tool('media.pause_in', { minutes: (parseDuration(text) ?? 600) / 60 }) : tool('media.stop_after', {})) }),
  cmd({ id: 'music.local', category: 'Media', tool: 'media.play_local', description: 'Play or shuffle the music files in your Music folder, optionally by an artist.', examples: ['shuffle all local mp3 songs by arijit singh', 'play my downloaded songs', 'shuffle my local music'],
    patterns: [/^(?:shuffle|play)(?: all)?(?: of)?(?: my)? (?:local|downloaded|offline|saved)(?: mp3| flac| mp3\/flac| music)*(?: songs| music| tracks| files)?(?: by| from| of)? ?(.*)$/],
    resolve: (m, text) => tool('media.play_local', { query: clean(m[1] ?? '').replace(/\bsongs?$/, '').trim(), shuffle: /shuffle/.test(text) || !m[1] }) }),
  cmd({ id: 'music.queue', category: 'Media', tool: 'music.play', description: 'Add a song to the queue (opens it; Spotify only lets you queue it yourself).', examples: ['add tum hi ho to my playback queue', 'queue blinding lights'],
    patterns: [/^(?:add|put) (.+?) (?:to|in|on|into) (?:my |the )?(?:playback |play |music |spotify )?queue$/, /^queue(?: up)? (.+)$/],
    resolve: (m) => tool('music.play', { query: clean(m[1]).replace(/^the song /, ''), hint: 'Right-click it and choose Add to queue; music apps don\'t let other programs change their queue.' }) }),
  cmd({ id: 'music.repeat', category: 'Media', tool: 'music.play', description: 'Play a song on repeat.', examples: ['play kesariya on single-track repeat', 'play believer on loop'],
    patterns: [/^(?:play|put) (.+?) on (?:single[- ]track |single song |)(?:repeat|loop)(?: mode)?$/, /^(?:loop|repeat) (?:the song )?(.+?)(?: on repeat| forever| all day)?$/],
    resolve: (m, text) => (/^(?:repeat|loop)$/.test(text) || /^(that|it|this|the last thing|after me)$/.test(m[1]) ? null : tool('music.play', { query: clean(m[1]).replace(/^the song /, ''), hint: 'Press the repeat button until it shows a 1 to loop just this song.' })) }),
  cmd({ id: 'music.lyrics', category: 'Media', tool: 'web.search', description: 'Find the lyrics of a song (opens a search; lyrics are copyrighted, so I don\'t save them).', examples: ['fetch and save synchronized lyrics for tum hi ho', 'show me the lyrics of shape of you'],
    patterns: [/\blyrics (?:for|of|to) (?:the song )?(.+)$/, /^(?:find|get|show me|search for) (?:the song )?(.+?) lyrics$/],
    resolve: (m, text) => tool('web.search', { query: `${clean(m[1])} lyrics${/synced|synchronized|lrc/.test(text) ? ' lrc synced' : ''}`, ...(/\bsave|download\b/.test(text) ? { note: "Lyrics are copyrighted, so I opened a search instead of saving them." } : {}) }) }),
  cmd({ id: 'music.alarm', category: 'Media', description: 'Using a song as an alarm (explains the limit and offers a reminder).', examples: ['set kesariya as my morning wake-up alarm audio'],
    patterns: [/^(?:set|use|make) (.+?) (?:as|for) my (?:morning |wake[- ]up |daily )*(?:alarm|ringtone)(?: audio| sound| tone)?$/],
    resolve: (m) => say(`Windows doesn't let apps choose a song for the Clock app's alarms, and my reminders speak instead of playing music. I can remind you at a set time every morning, then you say "play ${clean(m[1])}". Try "set a recurring daily alarm for wake up at 7 am".`) }),
  cmd({ id: 'music.variant', category: 'Media', tool: 'music.play', description: 'Find the acoustic, live, unplugged or remix version of a song.', examples: ['find the acoustic or unplugged version of alfaaz', 'play the live version of yellow'],
    patterns: [/^(?:find|play|search for|get) (?:me )?(?:the |an? )?((?:acoustic|unplugged|live|remix|slowed|lofi|lo-fi|instrumental|cover|karaoke|reverb)(?: or (?:acoustic|unplugged|live|remix|slowed|lofi|instrumental|cover))*) (?:version|versions|cover|mix) of (?:the song )?(.+?)(?:\s+on (spotify|youtube music|yt music))?$/],
    resolve: (m) => tool('music.play', { query: `${clean(m[2])} ${m[1].replace(/ or /g, ' ')}`, ...(m[3] ? { service: /spotify/.test(m[3]) ? 'spotify' : 'youtube_music' } : {}) }) }),
  cmd({ id: 'music.artist', category: 'Media', tool: 'music.play', description: 'Play an artist: their songs, latest album, top hits or a radio station.', examples: ['play songs by arijit singh', 'play the latest album by coldplay', 'play the top 10 hits of the weeknd', 'start an endless radio station based on a.r. rahman'],
    patterns: [
      /^play (?:some |all |the best )?(?:songs|music|tracks|hits) (?:by|from|of) (.+?)$/,
      /^play (?:the )?(?:latest|newest|new|last|most recent) album (?:by|from|of) (.+?)$/,
      /^play (?:the )?(?:top|best|greatest)(?: \d+)? (?:hits|songs|tracks) (?:of|by|from) (.+?)$/,
      /^(?:start|play|create)(?: an?)?(?: endless| infinite)? (?:radio|station|radio station|mix)(?: station)? (?:based on|for|of|like|from) (.+?)$/,
    ],
    resolve: (m, text) => {
      const svc = m[1].match(SERVICE);
      const artist = clean(m[1].replace(SERVICE, ''));
      const what = /album/.test(text) ? 'latest album' : /\b(top|best|greatest)\b/.test(text) ? 'top hits' : /radio|station|mix/.test(text) ? 'radio' : 'songs';
      return tool('music.play', { query: `${artist} ${what}`, ...(svc ? { service: /spotify/.test(svc[1]) ? 'spotify' : 'youtube_music' } : {}) });
    } }),
  cmd({ id: 'music.song', category: 'Media', tool: 'music.play', description: 'Play a specific song on Spotify (or YouTube Music when Spotify isn\'t installed).', examples: ['play the song kesariya', 'play the song blinding lights on spotify'],
    patterns: [/^play (?:the )?(?:song|track) (.+?)(?:\s+on (spotify|youtube music|yt music))?$/, /^play (.+?) on (youtube music|yt music)$/],
    resolve: (m) => tool('music.play', { query: clean(m[1]).replace(/^the song /, ''), ...(m[2] ? { service: m[2] === 'spotify' ? 'spotify' : 'youtube_music' } : {}) }) }),

  // ---------------------------------------------------------------- productivity
  cmd({ id: 'focus.timer_for', category: 'Productivity', tool: 'timers.create', description: 'Pomodoro, deep-work or countdown timer for a task.', examples: ['start a 25-minute pomodoro timer for team standup meeting', 'start a 45-minute deep work timer for study block', 'start a 60-minute countdown timer for my report'],
    patterns: [/^(?:start|set|begin|create|run)(?: me)? (?:a |an )?(\d+(?:\.\d+)?)[- ]?(minute|min|hour|second)s? (pomodoro|deep[- ]work|focus|study|countdown|work|break)?(?: session| timer| block)*(?: timer)?(?: for| on) (?:my |the )?(.+)$/],
    resolve: (m, text) => {
      const secs = Math.round(parseFloat(m[1]) * (m[2].startsWith('hour') ? 3600 : m[2].startsWith('sec') ? 1 : 60));
      const focus = /pomodoro|deep|focus|study|work/.test(m[3] ?? '') && !/countdown/.test(text);
      return tool('timers.create', { seconds: Math.max(5, Math.min(43200, secs)), label: cap(clean(m[4])), focus });
    } }),
  cmd({ id: 'todo.add', category: 'Productivity', tool: 'todo.add', description: 'Add something to your to-do list, optionally high priority.', examples: ["add 'client project review' to my high-priority to-do list", 'add buy milk to my to-do list', 'put call the bank on my task list'],
    patterns: [/^(?:add|put|place) (.+?) (?:to|on|in) (?:my |the )?(high[- ]priority |urgent |important |low[- ]priority )?(?:to[- ]?do|todo|task|tasks)(?: list)?$/],
    resolve: (m) => tool('todo.add', { text: cap(clean(m[1])), priority: /high|urgent|important/.test(m[2] ?? '') ? 'high' : /low/.test(m[2] ?? '') ? 'low' : 'normal' }) }),
  cmd({ id: 'todo.complete', category: 'Productivity', tool: 'todo.complete', description: 'Mark a to-do item done.', examples: ["mark 'team standup meeting' as completed on my to-do list", 'tick off buy milk', "i've finished the report"],
    patterns: [/^(?:mark|set) (.+?) as (?:done|completed|complete|finished)(?: on (?:my |the )?(?:to[- ]?do|todo|task)(?: list)?)?$/, /^(?:tick|check|cross) off (.+)$/, /^(?:complete|finish) (?:the )?(?:task|to[- ]?do|todo) (.+)$/, /^(?:ive|i have|i just|i) (?:finished|completed|done) (.+)$/],
    resolve: (m) => tool('todo.complete', { text: clean(m[1]) }) }),
  cmd({ id: 'todo.list', category: 'Productivity', tool: 'todo.list', description: 'Read your to-do list.', examples: ["what's on my to-do list", 'read my tasks', 'show my todo list'],
    patterns: [/^(?:whats|what is|read|show|list|tell me)(?: me)?(?: whats)?(?: on)? (?:my |the )?(?:to[- ]?do|todo|task)(?:s| list)$/], resolve: () => tool('todo.list') }),
  cmd({ id: 'todo.clear_done', category: 'Productivity', tool: 'todo.clear_done', description: 'Clear completed to-dos or sub-tasks.', examples: ['clear completed sub-tasks under client project review', 'clear my finished to-dos'],
    patterns: [/^(?:clear|remove|archive|delete) (?:all )?(?:my )?(?:the )?(?:completed|finished|done) (?:sub[- ]?tasks|tasks|to[- ]?dos|todos|items)(?: (?:under|for|in|from) (.+))?$/],
    resolve: (m) => tool('todo.clear_done', m[1] ? { query: clean(m[1]) } : {}) }),
  cmd({ id: 'todo.defer', category: 'Productivity', tool: 'todo.defer', description: "Move a task to next week's backlog.", examples: ["move code deployment check to next week's backlog", 'push the report to next week'],
    patterns: [/^(?:move|push|defer|postpone|shift) (.+?) to next weeks?(?: backlog| list| tasks)?$/, /^(?:move|put) (.+?) (?:in|into|to) (?:the |my )?backlog$/],
    resolve: (m) => tool('todo.defer', { text: cap(clean(m[1])) }) }),
  cmd({ id: 'note.create', category: 'Productivity', tool: 'notes.create', description: 'Create a note; Clickyy asks what to write.', examples: ["create a new note titled 'team standup meeting' and ask me what to write", 'take a note called ideas', 'new note'],
    patterns: [/^(?:(?:create|make|start|take|write)(?: me)? (?:a )?(?:new )?|new )note\b(?: (?:titled|called|named|about|for))? ?(.*?)(?: and ask me (?:what to write|for (?:the )?(?:content|text|details))| and let me dictate)?$/],
    resolve: (m) => {
      const title = cap(clean(m[1] ?? ''));
      return clarify(title ? `What should the note "${title}" say?` : 'What should the note say? Start with its title if you like, for example: "Groceries: milk, eggs and bread".', { commandId: 'note.create', slot: 'body', partial: { title } });
    },
    fillFirst: true,
    fill: (answer, p, _ctx, raw) => {
      if (CANCEL.test(answer)) return say("Okay, I didn't save a note.");
      const text = (raw ?? answer).trim();
      if (!text) return null;
      let title = String(p.title ?? '');
      let body = text;
      if (!title) { const m = text.match(/^(.{2,60}?):\s*(.+)$/s); title = m ? m[1] : text.split(/\s+/).slice(0, 5).join(' '); body = m ? m[2] : text; }
      return tool('notes.create', { title: cap(title), body });
    } }),
  cmd({ id: 'note.append', category: 'Productivity', tool: 'notes.append', description: 'Add to a note (asks what to add when you don\'t say).', examples: ["append a voice note to my 'client project review' file", 'add milk to my groceries note'],
    patterns: [/^(?:append|add)(?: a)?(?: voice)? (?:note|entry|line|text)? ?(?:to|in) (?:my |the )?(.+?)(?: note| file| notes)?$/, /^(?:add|append|write) (.+?) (?:to|in) (?:my |the )?(.+?) (?:note|notes|file)$/],
    resolve: (m, text) => {
      if (m[2]) return tool('notes.append', { title: cap(clean(m[2])), text: cap(m[1]) });
      if (TODO_LIST.test(m[1]) && !/note/.test(text)) return null;
      const title = cap(clean(m[1]));
      return clarify(`What should I add to ${title}?`, { commandId: 'note.append', slot: 'text', partial: { title } });
    },
    fillFirst: true,
    fill: (answer, p, _ctx, raw) => (CANCEL.test(answer) ? say('Okay, nothing added.') : tool('notes.append', { title: String(p.title), text: (raw ?? answer).trim() })) }),
  cmd({ id: 'note.find', category: 'Productivity', tool: 'notes.find', description: 'Find your notes about something.', examples: ['show me all notes related to client project review', 'find my notes about the budget', 'read my notes'],
    patterns: [/^(?:show|find|read|search|list|get)(?: me)?(?: all)? (?:my |the )?notes(?: (?:related to|about|on|for|mentioning|with) (.+))?$/],
    resolve: (m) => tool('notes.find', { query: m[1] ? clean(m[1]) : '' }) }),
  cmd({ id: 'note.export', category: 'Productivity', tool: 'notes.export', description: 'Export notes to a PDF, Markdown or text file, or pin a checklist to the desktop.', examples: ['export my notes on client project review to a clean pdf', 'pin the checklist for team standup meeting to my desktop'],
    patterns: [/^(?:export|save|convert) (?:all )?(?:my |the )?notes?(?: (?:on|about|for|from) (.+?))? (?:to|as|into) (?:a |an )?(?:clean |nice |neat )?(pdf|markdown|md|text file|txt|word)(?: file| document)?$/, /^pin (?:the |my )?(?:checklist|notes?|list) (?:for|about|of) (.+?) (?:to|on) (?:my |the )?desktop$/],
    resolve: (m, text) => tool('notes.export', { query: m[1] ? clean(m[1]) : '', format: /desktop/.test(text) ? 'desktop' : /markdown|\bmd\b/.test(m[2] ?? '') ? 'md' : /text|txt/.test(m[2] ?? '') ? 'txt' : 'pdf' }) }),
  cmd({ id: 'checklist.read', category: 'Productivity', tool: 'checklist.read', description: 'Read out the checklist for a task.', examples: ['read out my checklist for team standup meeting'],
    patterns: [/^(?:read(?: out)?|tell me|whats on|what is on|go through) (?:my |the )?(?:checklist|check list|steps) (?:for|of) (.+)$/], resolve: (m) => tool('checklist.read', { query: clean(m[1]) }) }),
  cmd({ id: 'notes.email', category: 'Productivity', tool: 'notes.email', description: 'Email the action items for a task (opens a draft with your notes and to-dos).', examples: ['email the action items from team standup meeting to my team'],
    patterns: [/^(?:email|send|mail) (?:the |my )?(?:action items|notes|to[- ]?dos|summary|minutes|tasks) (?:from|for|about|of) (.+?)(?: to (.+))?$/],
    resolve: (m) => tool('notes.email', { query: clean(m[1]), to: m[2] ? clean(m[2]) : '' }) }),
  cmd({ id: 'time.log', category: 'Productivity', tool: 'time.log', description: 'Log time spent on a task.', examples: ['log 1 hour spent on client project review in my time tracker sheet', 'log 30 minutes on emails'],
    patterns: [/^(?:log|record|track|add) (\d+(?:\.\d+)? (?:hours?|minutes?)(?: and \d+ minutes?)?)(?: spent| of work| worked)? (?:on|for) (?:my |the )?(.+?)(?: in (?:my |the )?time ?(?:tracker|log|sheet)(?: sheet)?)?$/],
    resolve: (m) => tool('time.log', { task: cap(clean(m[2])), minutes: (parseDuration(m[1]) ?? 3600) / 60 }) }),
  cmd({ id: 'time.summary', category: 'Productivity', tool: 'time.summary', description: 'Summarize your progress on a task this week.', examples: ['summarize my progress on client project review this week', 'how much time did i spend on study this week'],
    patterns: [/^(?:summari[sz]e|show|tell me|whats|what is) (?:my |the )?progress (?:on|for|with) (.+?)(?: this week| today| this month)?$/, /^how (?:much|long) (?:time )?(?:have i|did i) (?:spend|spent|work|worked) on (.+?)(?: this week| today)?$/],
    resolve: (m, text) => tool('time.summary', { task: clean(m[1]), days: /today/.test(text) ? 1 : /month/.test(text) ? 30 : 7 }) }),
  cmd({ id: 'stopwatch', category: 'Productivity', tool: 'stopwatch.control', description: 'Stopwatch for timing a task.', examples: ['set a stopwatch to measure how long team standup meeting takes', 'start a stopwatch', 'stop the stopwatch'],
    patterns: [/^(?:set|start|begin|run)(?: a| the)? stopwatch(?: (?:to (?:measure|time|see|check) how long|for) (?:my |the )?(.+?)(?: takes| lasts)?)?$/, /^(?:stop|end|pause)(?: the| my)? stopwatch$/, /^how long (?:has|is) (?:the |my )?stopwatch/],
    resolve: (m, text) => tool('stopwatch.control', /^(stop|end|pause)/.test(text) ? { action: 'stop' } : /^how long/.test(text) ? { action: 'status' } : { action: 'start', label: m[1] ? clean(m[1]) : 'stopwatch' }) }),
  cmd({ id: 'reminder.for_at', category: 'Productivity', tool: 'reminders.create', description: 'Reminder for an event at a time.', examples: ['set a reminder for my team standup meeting at 9:00 am tomorrow', 'set a reminder for dentist appointment on friday at 4 pm'],
    patterns: [/^(?:set|create|add|make)(?: me)? (?:a )?reminder (?:for|about) (?:my |the )?(.+?) (?:at|on|tomorrow|tonight|this|next|in) (.+)$/],
    resolve: (m, text) => {
      const rest = text.slice(text.indexOf(m[1]) + m[1].length);
      const secs = /\bin \d/.test(rest) ? parseDuration(rest) : null;
      if (secs) return tool('reminders.create', { text: cap(clean(m[1])), inSeconds: secs });
      const at = parseClockTime(rest);
      return at ? tool('reminders.create', { text: cap(clean(m[1])), at: isoAt(at) }) : null;
    } }),
  cmd({ id: 'calendar.event', category: 'Productivity', tool: 'reminders.create', description: 'Put an event on your schedule (as a Clickyy reminder; Outlook and Google Calendar are not connected).', examples: ['schedule team standup meeting on my calendar for friday at 3:00 pm', 'add dentist appointment to my calendar tomorrow at 10 am'],
    patterns: [/^(?:schedule|add|put|book) (?:my |the |a )?(.+?) (?:on|in|to) (?:my |the )?calendar(?: for| on| at)? ?(.*)$/],
    resolve: (m) => {
      const at = parseClockTime(m[2]);
      const note = "It's saved as a Clickyy reminder; I can't write to Outlook or Google Calendar yet.";
      if (!at) return clarify(`When is ${clean(m[1])}?`, { commandId: 'calendar.event', slot: 'when', partial: { text: cap(clean(m[1])), note } });
      return tool('reminders.create', { text: cap(clean(m[1])), at: isoAt(at), note });
    },
    fill: (answer, p) => { const at = parseClockTime(answer); return at ? tool('reminders.create', { text: p.text, at: isoAt(at), note: p.note }) : null; } }),
  cmd({ id: 'calendar.block', category: 'Productivity', tool: 'reminders.create', description: 'Hold time for a task (asks when it starts).', examples: ['block 2 hours on my calendar for client project review'],
    patterns: [/^(?:block|reserve|hold)(?: out)? (\d+(?:\.\d+)? (?:hours?|minutes?))(?: of time)? (?:on|in) (?:my |the )?calendar (?:for|to work on) (?:my |the )?(.+)$/],
    resolve: (m) => clarify(`I can't write to your calendar, but I can hold the time with a reminder. When should the ${m[1]} for ${clean(m[2])} start? Say "now" to start a focus session right away.`, { commandId: 'calendar.block', slot: 'when', partial: { task: cap(clean(m[2])), secs: parseDuration(m[1]) ?? 3600 } }),
    fill: (answer, p) => {
      if (/^(now|right away|start now|immediately)\b/.test(answer)) return tool('timers.create', { seconds: Math.min(43200, Number(p.secs)), label: String(p.task), focus: true });
      const at = parseClockTime(answer);
      return at ? tool('reminders.create', { text: `Time to start ${p.task} (${Math.round(Number(p.secs) / 60)} minutes blocked)`, at: isoAt(at) }) : null;
    } }),
  cmd({ id: 'reminder.repeat', category: 'Productivity', tool: 'reminders.repeat', description: 'Daily, weekday or weekly repeating reminder or alarm.', examples: ['set a recurring daily alarm for meditation at 7:30 am', 'set a recurring weekly reminder for laptop backup every monday', 'remind me to drink water every day at 11 am'],
    patterns: [/^(?:set|create|add|make)(?: me)? (?:a )?(?:recurring |repeating )?(daily|weekly|weekday|everyday|every day|every weekday)? ?(?:recurring |repeating )?(?:alarm|reminder) (?:for|about|to) (?:my |the )?(.+?) (?:at|every|on|each) (.+)$/, /^remind me (?:to |about )(.+?) every (day|weekday|morning|evening|night|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(.*)$/],
    resolve: (m, text) => {
      const isRemind = /^remind me/.test(text);
      const what = cap(clean(isRemind ? m[1] : m[2]));
      const when = isRemind ? `${m[2]}${m[3]}` : m[3];
      const repeat = /week ?day/.test(text) ? 'weekdays' : /weekly|every (monday|tuesday|wednesday|thursday|friday|saturday|sunday|week)/.test(text) ? 'weekly' : 'daily';
      const at = parseClockTime(when.replace(/^every /, '')) ?? parseClockTime(`at ${when}`) ?? (repeat === 'weekly' ? null : parseClockTime(/evening|night/.test(when) ? 'evening' : 'morning'));
      if (!/daily|weekly|weekday|every|recurring|repeating|alarm/.test(text)) return null;
      return at ? tool('reminders.repeat', { text: what, at: isoAt(at), repeat }) : clarify(`What time should I remind you about ${what}?`, { commandId: 'reminder.repeat', slot: 'when', partial: { text: what, repeat } });
    },
    fill: (answer, p) => { const at = parseClockTime(answer) ?? parseClockTime(`at ${answer}`); return at ? tool('reminders.repeat', { text: p.text, at: isoAt(at), repeat: p.repeat }) : null; } }),
  cmd({ id: 'reminder.snooze', category: 'Productivity', tool: 'reminders.snooze', description: 'Snooze a reminder.', examples: ['snooze my team standup meeting alert for 10 minutes', 'snooze for 5 minutes', 'snooze'],
    patterns: [/^snooze(?: (?:my |the )?(.+?)(?: alert| reminder| alarm)?)?(?: for (\d+(?:\.\d+)? (?:minutes?|hours?)))?$/],
    resolve: (m) => tool('reminders.snooze', { ...(m[1] && !/^(it|that|this)$/.test(m[1]) ? { query: clean(m[1]) } : {}), minutes: m[2] ? (parseDuration(m[2]) ?? 600) / 60 : 10 }) }),
  cmd({ id: 'reminder.cancel_named', category: 'Productivity', tool: 'reminders.cancel_named', description: 'Cancel a reminder by name.', examples: ['cancel the scheduled reminder for team standup meeting', 'delete my dentist reminder'],
    patterns: [/^(?:cancel|delete|remove|clear) (?:the |my )?(?:scheduled )?(?:reminder|alarm|alert) (?:for|about) (?:my |the )?(.+)$/, /^(?:cancel|delete|remove) (?:the |my )(.+?) (?:reminder|alarm|alert)$/],
    resolve: (m) => (/^(all|last|every)/.test(m[1]) ? null : tool('reminders.cancel_named', { query: clean(m[1]) })) }),
  cmd({ id: 'reminder.find', category: 'Productivity', tool: 'reminders.find', description: 'When is something scheduled.', examples: ['check when my next team standup meeting is scheduled', 'when is my dentist appointment'],
    patterns: [/^(?:check |tell me |find out )?when (?:is |s )?(?:my |the )?(?:next )?(.+?) (?:is )?(?:scheduled|due|happening|planned|set)$/, /^when is my (?:next )?(.+)$/],
    resolve: (m) => tool('reminders.find', { query: clean(m[1]).replace(/^next /, '') }) }),
  cmd({ id: 'reminder.reschedule', category: 'Productivity', tool: 'reminders.reschedule', description: 'Move a reminder to a new time.', examples: ['reschedule my team standup meeting to tomorrow evening at 6:00 pm', 'move my dentist appointment to friday at 5 pm'],
    patterns: [/^(?:reschedule|move|shift|push|change) (?:my |the )?(.+?) (?:to|for|until) ((?:tomorrow|today|tonight|this|next|on|at|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d).*)$/],
    resolve: (m) => {
      const at = parseClockTime(m[2]);
      if (!at || /\b(monitor|screen|left|right|backlog|folder|week)\b/.test(m[2])) return null;
      return tool('reminders.reschedule', { query: clean(m[1]), at: isoAt(at) });
    } }),
  cmd({ id: 'reminder.before', category: 'Productivity', tool: 'reminders.before', description: 'Early warning before an event.', examples: ['set a 15-minute warning before team standup meeting starts', 'warn me 10 minutes before the dentist appointment'],
    patterns: [/^(?:set|add|give me|create)(?: me)? (?:a |an )?(\d+)[- ]?(minute|hour)s? (?:warning|alert|heads up|reminder) before (?:my |the )?(.+?)(?: starts| begins)?$/, /^(?:warn|remind|alert) me (\d+) (minute|hour)s? before (?:my |the )?(.+?)(?: starts| begins)?$/],
    resolve: (m) => tool('reminders.before', { query: clean(m[3]), minutes: parseInt(m[1], 10) * (m[2] === 'hour' ? 60 : 1) }) }),
  cmd({ id: 'workspace.shortcut', category: 'Productivity', description: 'Desktop shortcut to a workspace (explains how routines do this instead).', examples: ['create a desktop shortcut to launch my team standup meeting workspace'],
    patterns: [/^(?:create|make|add) (?:a )?desktop shortcut (?:to|for)(?: launch| open)? (?:my |the )?(.+?)(?: workspace)?$/],
    resolve: (m) => say(`I can't make desktop shortcuts yet. A routine does the same job: in Settings, Routines, make one called "${clean(m[1])} workspace" with the apps and sites you need, then just say its name to open everything.`) }),

  // ---------------------------------------------------------------- battery, brightness, microphone
  cmd({ id: 'battery.alert', category: 'System', description: 'Spoken warning when the battery drops below a level (5 to 50 percent).', examples: ['alert me when laptop battery drops below 20 percent', 'enable battery saver mode if battery is at 15 percent'],
    patterns: [/\b(?:alert|warn|notify|tell|remind) me (?:when|if) (?:my |the )?(?:laptop |pc )?battery (?:drops|goes|falls|gets|is) (?:below|under|to|at|less than) (\d{1,3})/, /\b(?:enable|turn on|start|switch on|use) (?:the )?battery saver(?: mode)? (?:if|when|at|below) (?:the )?(?:battery )?(?:is |drops |goes |falls )?(?:at |below |under |to )?(\d{1,3})/],
    resolve: (m, text) => builtin('battery_alert', { threshold: parseInt(m[1], 10), saver: /saver/.test(text) }) }),
  cmd({ id: 'display.brightness', category: 'System', tool: 'display.brightness', description: 'Read or change the screen brightness.', examples: ['set laptop screen brightness to 40 percent', 'dim the display to 20 percent brightness', 'brightness up', "what's my screen brightness"],
    patterns: [/\bbrightness\b/, /^(?:dim|darken|brighten) (?:the |my )?(?:laptop )?(?:screen|display|monitor)\b/],
    resolve: (_m, text) => {
      const n = text.match(/(\d{1,3})(?: percent)?/);
      if (/\bby (\d{1,3})/.test(text)) return tool('display.brightness', { delta: (/(down|lower|decrease|reduce|dim)/.test(text) ? -1 : 1) * parseInt(text.match(/\bby (\d{1,3})/)![1], 10) });
      if (n) return tool('display.brightness', { level: Math.min(100, parseInt(n[1], 10)) });
      if (/\b(up|increase|raise|brighter|brighten|higher)\b/.test(text)) return tool('display.brightness', { delta: 10 });
      if (/\b(down|decrease|lower|dim|darker|darken|reduce)\b/.test(text)) return tool('display.brightness', { delta: -10 });
      return tool('display.brightness', {});
    } }),
  cmd({ id: 'audio.mic_level', category: 'Audio', tool: 'audio.mic_level', description: 'Read or set the microphone input level.', examples: ['set microphone input sensitivity to 60 percent', "what's my mic level"],
    patterns: [/\b(?:microphone|mic)(?: input)? (?:sensitivity|gain|level|volume|input level)\b/],
    resolve: (_m, text) => { const n = text.match(/(\d{1,3})(?: percent)?/); return tool('audio.mic_level', n ? { level: Math.min(100, parseInt(n[1], 10)) } : {}); } }),

  // ---------------------------------------------------------------- power timers
  cmd({ id: 'power.cancel_timer', category: 'Power', tool: 'power.cancel_scheduled', description: 'Cancel a timed lock, sleep, hibernate, screen-off, restart, shutdown or sign-out.', examples: ['cancel scheduled lock my laptop screen timer for 5 minutes', 'cancel the sleep timer', 'cancel the scheduled shutdown'],
    patterns: [/^(?:cancel|abort|stop|clear|remove) (?:the |my )?(?:scheduled |pending |timed )(.+?)(?: timer)?(?: for \d+(?:\.\d+)? (?:minutes?|hours?|seconds?))?$/, /^(?:cancel|abort|stop) (?:the |my )?(lock|sleep|hibernate|hibernation|screen off|display off|sign out|logout|restart|shutdown|shut down|power) timer$/],
    resolve: (m) => { const a = powerAction(m[1]) ?? (/power/.test(m[1]) ? 'all' : null); return a ? tool('power.cancel_scheduled', { action: a }) : null; } }),
  cmd({ id: 'power.timer', category: 'Power', tool: 'power.schedule', description: 'Lock, sleep, hibernate, screen off, restart, shut down or sign out after a delay.', examples: ['put my laptop to sleep in 30 minutes', 'shut down my laptop completely in 1 hour', 'lock my laptop screen in 5 minutes', 'turn off the laptop monitor without sleeping in 2 minutes'],
    patterns: [/^(.+?) (?:in|after) (\d+(?:\.\d+)? (?:minutes?|hours?|seconds?)(?: and \d+ minutes?)?)$/],
    resolve: (m) => {
      const a = powerAction(m[1]);
      if (!a || !POWER_START.test(m[1]) || (!DEVICE.test(m[1]) && m[1].split(' ').length > 2) || notPower(m[1], a)) return null;
      return tool('power.schedule', { action: a, minutes: Math.max(0.5, (parseDuration(m[2]) ?? 60) / 60) });
    } }),
  cmd({ id: 'power.now', category: 'Power', tool: 'power.now', description: 'Sleep, hibernate, lock or turn the screen off now (shutdown and restart are confirmed).', examples: ['put my laptop to sleep', 'hibernate my laptop now', 'turn off the laptop monitor without sleeping', 'lock my laptop screen', 'restart my laptop safely', 'sign out of my current user session'],
    patterns: [/^(?:lock|put|send|hibernate|restart|reboot|shut ?down|sign (?:me )?out|log ?out|log off|turn off|switch off|power off|sleep)\b.*$/],
    resolve: (_m, text) => {
      const a = powerAction(text);
      if (!a || (!DEVICE.test(text) && !/^(sleep|hibernate|put (it|me) to sleep)$/.test(text)) || notPower(text, a)) return null;
      // Short forms ("lock my pc", "restart the pc") stay with the original lock and power commands.
      if (/^lock( my| the)?( pc| computer| screen| laptop| workstation| windows)?$|^(shut ?down|turn off|power off|restart|reboot|sign out|log out|log off)( my| the)?( computer| pc| laptop| system| windows)?$/.test(text)) return null;
      if (findFeature(text.replace(/\b(laptop|pc|computer)\b/g, '')) && !/\b(screen|monitor|display)\b/.test(text)) return null;
      if (a === 'lock') return tool('system.lock');
      if (a === 'shutdown' || a === 'restart' || a === 'signout') return tool('power.action', { action: a });
      return tool('power.now', { action: a });
    } }),

  // ---------------------------------------------------------------- apps and windows
  cmd({ id: 'app.elevated', category: 'Apps', description: 'Running apps as administrator (explains why Clickyy never does).', examples: ['open google chrome as administrator'],
    patterns: [/^(?:open|run|start|launch) (.+?) (?:as|with) (?:an? )?(?:administrator|admin|elevated)(?: rights| privileges| mode)?$/],
    resolve: (m) => say(`I don't start apps as administrator, so nothing I run can change system files by accident. To do it yourself, press the Windows key, type ${appName(m[1])}, right-click it and choose "Run as administrator".`) }),
  cmd({ id: 'app.startup', category: 'Apps', tool: 'apps.startup', description: 'Start an app when you sign in, or stop it starting.', examples: ['enable startup launch for spotify', 'disable automatic startup for microsoft teams', 'stop discord from starting with windows'],
    patterns: [/^(enable|disable|add|remove|turn on|turn off)(?: the)? (?:automatic )?(?:startup|auto[- ]?start|launch at startup|startup launch|start ?up launch)(?: launch)? (?:for|of) (.+)$/, /^(?:stop|prevent) (.+?) (?:from )?(?:starting|launching|opening) (?:with windows|at startup|automatically|on startup)$/, /^(?:make|let) (.+?) (?:start|launch|open) (?:with windows|at startup|automatically|on startup)$/],
    resolve: (m, text) => { const a = appArg(m[2] ?? m[1]); return a ? tool('apps.startup', { app: a, enable: !/disable|remove|turn off|stop|prevent/.test(text) }) : null; } }),
  cmd({ id: 'app.cache', category: 'Apps', tool: 'apps.clear_cache', description: 'Clear an app\'s cache (opens the right place).', examples: ['clear temporary cache files for google chrome', 'clear the edge cache'],
    patterns: [/^(?:clear|clean|delete|empty|wipe) (?:the |all )?(?:temporary |temp )?(?:cache|cached files|cache files|browsing data)(?: files)? (?:for|of|in|from) (.+)$/, /^(?:clear|clean) (?:the |my )?(.+?) cache$/],
    resolve: (m) => { const a = appArg(m[1]); return a ? tool('apps.clear_cache', { app: a }) : null; } }),
  cmd({ id: 'app.info', category: 'Apps', tool: 'apps.status', description: 'Is an app running, how much memory and CPU it uses, its version, or where it is installed.', examples: ['check if google chrome is currently running', 'check how much ram and cpu spotify is using', 'check the installed version of vs code', 'show the installation folder path of zoom'],
    patterns: [
      /^(?:check |tell me |see )?(?:if|whether) (.+?) is (?:currently |still )?(?:running|open)$/, /^is (.+?) (?:currently |still )?(?:running|open)$/,
      /^(?:check |tell me |show )?how much (?:ram|memory|cpu|ram and cpu|cpu and ram|memory and cpu|resources) (.+?) is (?:using|taking|consuming)$/, /^how much (?:ram|memory|cpu) (?:is|does) (.+?) (?:using|use|take)$/,
      /^(?:check|tell me|show|whats|what is|find) (?:the )?(?:installed |current )?version (?:of|for) (.+)$/, /^what version (?:of (.+?) )?is installed$/,
      /^(?:show|tell me|find|where is|whats|what is|open) (?:the )?(?:installation|install) (?:folder|path|location|directory)(?: path)? (?:of|for) (.+)$/, /^where is (.+?) installed$/,
    ],
    resolve: (m, text) => {
      const a = appArg(m[1] ?? '');
      if (!a || findFeature(a) || /\b(wifi|wi-fi|bluetooth|battery|internet)\b/.test(a)) return null;
      return tool('apps.status', { app: a, info: /version/.test(text) ? 'version' : /install|where is/.test(text) ? 'location' : /how much/.test(text) ? 'usage' : 'running' });
    } }),
  cmd({ id: 'app.force_quit', category: 'Apps', tool: 'apps.force_quit', description: 'Force quit a frozen app (confirmed).', examples: ['force quit google chrome if it is frozen', 'force close zoom', 'end task notepad'],
    patterns: [/^(?:force[- ]?(?:quit|close|stop|exit)|end task(?: for| on)?|hard (?:close|quit)) (.+?)(?: if (?:it is|its|it's) (?:frozen|stuck|not responding|hanging|hung))?(?: right now| now)?$/],
    resolve: (m) => { const a = appArg(m[1]); return a ? tool('apps.force_quit', { app: a }) : null; } }),
  cmd({ id: 'app.restart', category: 'Apps', tool: 'apps.restart', description: 'Close an app and open it again (confirmed).', examples: ['restart google chrome', 'relaunch spotify'],
    patterns: [/^(?:restart|relaunch|reopen|reload) (?:the )?(.+?)(?: app| application)?$/],
    resolve: (m) => { const a = appArg(m[1]); return a && (!DEVICE.test(m[1]) || /\b(settings|control panel|manager|explorer)\b/.test(m[1])) && !/^(it|that|the timer|timer|music|song|video|playback)$/.test(a) ? tool('apps.restart', { app: a }) : null; } }),
  cmd({ id: 'app.close_all', category: 'Windows', tool: 'windows.close_app', description: 'Close an app (every window; confirmed).', examples: ['close all google chrome windows', 'close all background instances of microsoft teams', 'quit spotify'],
    patterns: [/^(?:close|quit|exit)(?: all)?(?: the)?(?: background)?(?: instances| windows| copies)?(?: of)? (.+?)(?: app| application| completely| entirely)?$/],
    resolve: (m, text) => {
      const a = appArg(m[1]);
      if (!a || /^(conversation|chat|session|tab|this tab|the tab|current window|window|it|that|this)$/.test(a)) return null;
      // A plain "close X" stays with windows.close (one window, confirmed); this is for every window of an app.
      if (!/\b(all|instances|background|quit|exit|completely|entirely)\b/.test(text)) return null;
      return tool('windows.close_app', { app: a });
    } }),
  cmd({ id: 'window.layout', category: 'Windows', tool: 'windows.manage', description: 'Center, resize, keep on top, move to another monitor, show only one app, or open a new window.', examples: ['center the google chrome window on my screen', 'resize spotify window to 1280x720', 'pin notepad to the always-on-top layer', 'unpin notepad from always-on-top', 'move vs code to my second monitor', 'hide all windows except google chrome', 'open a new window in microsoft edge'],
    patterns: [
      /^center (?:the |my )?(.+?)(?: window)?(?: on (?:my |the )?screen)?$/,
      /^resize (?:the |my )?(.+?)(?: window)? to (\d{3,4}) ?(?:x|by|\*) ?(\d{3,4})(?: pixels)?$/,
      /^(?:pin|keep|make|set) (?:the |my )?(.+?)(?: window)? (?:to the |on |always )?(?:always[- ]on[- ]top|on top|top ?most)(?: layer| of (?:other|all) windows)?$/,
      /^(?:unpin|stop keeping) (?:the |my )?(.+?)(?: window)? (?:from |on )?(?:always[- ]on[- ]top|on top|top ?most)(?: layer)?$/,
      /^(?:move|send|put|throw) (?:the |my )?(.+?)(?: window)? (?:to|on|onto) (?:my |the )?(?:second|other|next|external|2nd|another) (?:monitor|screen|display)$/,
      /^(?:hide|minimi[sz]e) (?:all|every|other)(?: other)? windows? (?:except|but) (?:the |my )?(.+)$/, /^(?:show|focus on) only (?:the |my )?(.+)$/,
      /^open (?:a )?new (?:window|instance) (?:in|of|for) (?:the |my )?(.+)$/,
    ],
    resolve: (m, text) => {
      const q = appArg(m[1]);
      const action = /^center/.test(text) ? 'center' : /^resize/.test(text) ? 'resize' : /^(unpin|stop keeping)/.test(text) ? 'topmost_off' : /top/.test(text) && /^(pin|keep|make|set)/.test(text) ? 'topmost_on' : /monitor|screen|display/.test(text) && /^(move|send|put|throw)/.test(text) ? 'next_monitor' : /except|but|only/.test(text) ? 'solo' : 'new_window';
      if (!q && action === 'new_window') return null;
      return tool('windows.manage', { action, ...(q && !/^(this|current|it)$/.test(q) ? { query: q } : {}), ...(action === 'resize' ? { width: parseInt(m[2], 10), height: parseInt(m[3], 10) } : {}) });
    } }),
  cmd({ id: 'window.snap_ext', category: 'Windows', tool: 'windows.arrange', description: 'Snap or maximize a named app window.', examples: ['snap google chrome to the left half of my screen', 'maximize spotify to full screen'],
    patterns: [/^(?:snap|dock) (?:the |my )?(.+?)(?: window)? to the (left|right)(?: half| side)?(?: of (?:my |the )?screen)?$/, /^(?:maximi[sz]e|expand) (?:the |my )?(.+?)(?: window)? (?:to )?(?:full ?screen|the whole screen|the full screen)$/, /^make (?:the |my )?(.+?) full ?screen$/],
    resolve: (m, text) => {
      const q = appArg(m[1]);
      const action = /left/.test(m[2] ?? '') ? 'snap_left' : /right/.test(m[2] ?? '') ? 'snap_right' : 'maximize';
      return tool('windows.arrange', { action, ...(q && !/^(this|current|it)$/.test(q) ? { query: q } : {}) });
    } }),
  cmd({ id: 'screen.screenshot', category: 'Screen', tool: 'screen.save', description: 'Save a screenshot of the whole screen.', examples: ['take a screenshot', 'capture my screen', 'screenshot'],
    patterns: [/^(?:take|grab|capture|save|get)(?: me)?(?: a| the)? (?:full |whole )?screen ?shot(?: of (?:my |the )?(?:whole |entire |full )?(?:screen|desktop))?$/, /^screen ?shot(?: please)?$/, /^(?:capture|save) (?:my |the )?(?:whole |entire |full )?screen$/],
    resolve: () => tool('screen.save', {}) }),
  cmd({ id: 'window.screenshot', category: 'Screen', tool: 'windows.screenshot', description: 'Save a screenshot of one app window.', examples: ['take a screenshot of just the google chrome window', 'screenshot the spotify window'],
    patterns: [/^(?:take|grab|capture|save) (?:a )?screenshot of (?:just |only )?(?:the |my )?(.+?)(?: window| app)?$/, /^screenshot (?:the |my )?(.+?) window$/],
    resolve: (m) => { const q = appArg(m[1]); return q && !/^(screen|whole screen|my screen|desktop|entire screen)$/.test(m[1]) ? tool('windows.screenshot', /^(this|current|it)$/.test(q) ? {} : { query: q }) : null; } }),
  cmd({ id: 'app.audio', category: 'Audio', tool: 'app.audio', description: 'Mute or unmute one app\'s sound.', examples: ['mute audio coming only from google chrome', 'unmute audio for spotify', 'mute discord'],
    patterns: [/^(mute|unmute|silence)(?: the)?(?: audio| sound)?(?: coming)?(?: only)? (?:from|for|of|in) (?:the |my )?(.+?)(?: only)?$/, /^(mute|unmute) (?:the |my )?(.+?)(?: app| tab| audio| sound)$/, /^(mute|unmute) ([a-z][a-z0-9]+)$/],
    resolve: (m) => {
      const a = appArg(m[2]);
      if (!a || /^(volume|sound|audio|system|speakers?|everything|all|me|yourself|notifications?|music|computer|laptop|pc|mic|microphone|video|tab|this|that|it)$/.test(a)) return null;
      return tool('app.audio', { app: a, mute: m[1] !== 'unmute' });
    } }),
  cmd({ id: 'window.toggle_focus', category: 'Windows', tool: 'windows.focus', description: 'Switch between an app and the last window.', examples: ['switch focus between google chrome and my last active window'],
    patterns: [/^(?:switch|toggle|flip) (?:focus )?between (?:the |my )?(.+?) and (?:my |the )?(?:last|previous|other)(?: active)? (?:window|app)$/],
    resolve: (m) => { const a = appArg(m[1]); return a ? tool('windows.focus', { query: a }) : null; } }),
  cmd({ id: 'app.start_on', category: 'Apps', tool: 'apps.open', description: 'Open an app (longer ways to say it).', examples: ['start google chrome on my laptop', 'open terminal / command prompt'],
    patterns: [/^(?:open|start|launch|run) (.+?) (?:on|in) (?:my |the )?(?:laptop|pc|computer|system)$/, /^(?:open|start|launch) (.+? \/ .+)$/],
    resolve: (m) => { const a = appArg(m[1]); return a ? tool('apps.open', { app: /^task manager$/.test(a) ? 'Task Manager' : a }) : null; } }),

  // ---------------------------------------------------------------- Windows features
  cmd({ id: 'system.feature', category: 'System', tool: 'system.feature', description: 'Turn a Windows feature on or off, toggle it, check it, reset it or open its settings (35 features: Wi-Fi, Bluetooth, dark mode, night light, hotspot, narrator, clipboard history and more).', examples: ['turn on bluetooth', 'turn off wi-fi', 'toggle dark mode', 'check if bluetooth is currently enabled', 'open the settings page for night light', 'reset hidden files visibility to default configuration', 'turn on high performance power plan'],
    patterns: [
      /^(?:turn on|enable|switch on|activate|start|show) (.+?)(?: on (?:my |the )?(?:laptop|pc|computer))?$/,
      /^(?:turn off|disable|switch off|deactivate|stop|hide) (.+?)(?: on (?:my |the )?(?:laptop|pc|computer))?$/,
      /^toggle (.+?)(?: on (?:my |the )?(?:laptop|pc|computer))?$/,
      /^(?:check|tell me|see|find out) (?:if|whether) (.+?) is (?:currently |turned |switched )?(?:enabled|on|active|disabled|off|working)$/, /^is (.+?) (?:currently |turned )?(?:on|enabled|off|disabled|active)$/,
      /^(?:open|show|go to|take me to) (?:the )?settings(?: page)? (?:for|of) (.+)$/,
      /^reset (.+?) to (?:the |its )?(?:windows )?(?:default|factory|original)(?: configuration| settings| state| value)?$/,
    ],
    resolve: (m, text) => {
      const f = findFeature(m[1]);
      if (!f || m[1].split(' ').length > 7) return null;
      const action = /^toggle/.test(text) ? 'toggle' : /^(check|tell me|see|find out|is) /.test(text) ? 'status' : /^(open|show|go to|take me to) (the )?settings/.test(text) ? 'settings' : /^reset/.test(text) ? 'reset' : /^(turn off|disable|switch off|deactivate|stop|hide)/.test(text) ? 'off' : 'on';
      return tool('system.feature', { feature: f.id, action });
    } }),

  // ---------------------------------------------------------------- files by type
  cmd({ id: 'files.by_type', category: 'Files', tool: 'files.by_type', description: 'Find, count, sort, or find the largest or newest files of one type in a folder.', examples: ['find all pdf documents in my desktop folder', 'count how many excel spreadsheets are inside my downloads folder', 'list the 5 largest png and jpg images in my pictures folder', 'find word documents in documents modified today', 'sort all csv data files in downloads by newest date'],
    patterns: [/^(?:find|list|show|search for|get|count|how many|sort|locate|which)\b.*$/],
    resolve: (_m, text) => {
      const type = fileType(text);
      const folder = fileFolder(text);
      if (!type || !folder || /\b(duplicate|duplicates|copies)\b/.test(text)) return null;
      const largest = text.match(/\b(?:(\d+) )?(?:largest|biggest|heaviest)\b/);
      const action = /^(count|how many)/.test(text) ? 'count' : largest ? 'largest' : /\b(today|recent|recently|modified|changed|new)\b/.test(text) && !/newest date/.test(text) ? 'recent' : /\bsort|newest|latest\b/.test(text) ? 'sort' : 'list';
      return tool('files.by_type', { folder, type, action, ...(largest?.[1] ? { limit: Math.min(50, parseInt(largest[1], 10)) } : {}) });
    } }),
  cmd({ id: 'files.duplicates', category: 'Files', tool: 'files.duplicates', description: 'Find duplicate files of a type in a folder (read-only).', examples: ['check for duplicate pdf documents inside downloads', 'find duplicate photos in my pictures folder'],
    patterns: [/\b(duplicate|duplicates|identical|same) (?:files?|copies|.*?)\b/],
    resolve: (_m, text) => { const type = fileType(text) ?? (/\bfiles?\b/.test(text) ? 'all' : null); const folder = fileFolder(text); return type && folder ? tool('files.duplicates', { folder, type }) : null; } }),
  cmd({ id: 'files.bulk', category: 'Files', tool: 'files.bulk', description: 'Organize files of a type into a subfolder, date-stamp their names, zip them, or back them up (never deletes or overwrites).', examples: ['move all pdf documents from desktop into an organized subfolder', 'compress all excel spreadsheets in documents into a zip archive', 'back up all python scripts from projects to my backups folder', "rename all csv data files in downloads with today's date prefix"],
    patterns: [/^(?:move|organi[sz]e|sort|tidy|compress|zip|archive|back ?up|copy|rename|date[- ]?stamp|prefix)\b.*$/],
    resolve: (_m, text) => {
      const type = fileType(text);
      const folder = fileFolder(text.replace(/\b(?:to|into) (?:my |the )?backups?(?: folder)?\b/, '').replace(/\binto (?:a |an )?(?:organi[sz]ed |new |tidy )?(?:sub ?folder|zip archive|zip file|zip|archive)\b/, ''));
      if (!type || !folder) return null;
      const action = /^(compress|zip)|\bzip\b|\barchive\b/.test(text) ? 'zip' : /^back ?up|backups?\b|^copy/.test(text) ? 'backup' : /^(rename|date|prefix)|\bdate prefix\b|todays date/.test(text) ? 'rename_date' : 'organize';
      return tool('files.bulk', { folder, type, action });
    } }),

  // ---------------------------------------------------------------- web extras
  cmd({ id: 'web.private', category: 'Web', tool: 'web.search_site', description: 'Search in a private (incognito) window.', examples: ['open google in incognito mode and search for cheap flights to delhi', 'search youtube privately for lofi music'],
    patterns: [new RegExp(`^(?:open |use )?${PLATFORM} (?:in|on|with) (?:an? )?(?:incognito|private|inprivate)(?: mode| window| tab)? (?:and |to )?(?:search|look up|find)(?: for)? (.+)$`), new RegExp(`^(?:search|look up) ${PLATFORM} (?:privately|in private|in incognito)(?: mode)? for (.+)$`), /^(?:search|look up)(?: for)? (.+?) (?:in|using) (?:an? )?(?:incognito|private|inprivate) (?:mode|window|tab)$/],
    resolve: (m) => {
      if (!m[2]) return tool('web.search', { query: m[1], private: true });
      const site = findSearchSite(m[1]);
      return site && site.name !== 'Google' ? tool('web.search_site', { site: site.name, query: m[2], private: true }) : tool('web.search', { query: m[2], private: true });
    } }),
  cmd({ id: 'web.new_tab_search', category: 'Web', tool: 'web.search_site', description: 'Open a site in a new tab and search it.', examples: ['open google in a new tab and look up python openpyxl tutorial', 'open youtube in a new tab and search for docker compose tutorial'],
    patterns: [new RegExp(`^(?:open|go to) ${PLATFORM} (?:in|on) (?:a )?new (?:tab|window) (?:and |to )?(?:look up|search(?: for)?|find)(?: for)? (.+)$`)],
    resolve: (m, _t, ctx) => {
      const site = findSearchSite(m[1]);
      if (!site) return null;
      return site.name === 'Google' ? tool('web.search', { query: m[2] }) : inBrowser('web.search_site', { site: site.name, query: m[2] }, site.name, ctx);
    } }),
  cmd({ id: 'web.summary', category: 'Web', description: 'Overview of a topic from the language model, with the live search opened next to it.', examples: ['summarize the top results on google about machine learning roadmap'],
    patterns: [new RegExp(`^(?:summari[sz]e|give me a summary of|sum up) (?:the )?(?:top |best |first )?(?:\\d+ )?(?:results|links|videos|answers|articles|posts) (?:on|from|in) ${PLATFORM} (?:about|on|for) (.+)$`)],
    resolve: (m) => builtin('ai_task', { kind: 'web_summary', site: findSearchSite(m[1])?.name ?? 'Google', topic: m[2] }) }),
  cmd({ id: 'web.save_links', category: 'Web', tool: 'document.save', description: 'Save search links for a topic to a text file.', examples: ['save the best links from github on react hooks documentation to a text file'],
    patterns: [new RegExp(`^(?:save|store|write|export) (?:the )?(?:best |top )?(?:links|results|urls|sources) (?:from|on) ${PLATFORM} (?:on|about|for) (.+?) (?:to|in|into) (?:a )?(?:text|txt|notes?) ?(?:file|document)?$`)],
    resolve: (m) => {
      const site = findSearchSite(m[1]);
      const google = `https://www.google.com/search?q=${encodeURIComponent(m[2])}`;
      const siteUrl = site ? searchSiteUrl(site, m[2]) : google;
      const content = `Links for: ${m[2]}\nSaved ${new Date().toLocaleString()}\n\n${site?.name ?? 'Google'} search: ${siteUrl}\n${siteUrl !== google ? `Google search: ${google}\n` : ''}\nI can't read search results, so these are the search pages. Paste the best links you find below.\n\n- \n- \n- \n`;
      return tool('document.save', { name: `Links ${m[2]}`.slice(0, 70), extension: 'txt', content });
    } }),

  // ---------------------------------------------------------------- messaging
  cmd({ id: 'message.email', category: 'Communication', tool: 'message.email', description: 'Draft an email (opens your mail app; you press Send).', examples: ['draft an email to rahul about the updated excel report', 'write an email to my manager about tomorrows leave'],
    patterns: [/^(?:draft|write|compose|prepare|send|start)(?: me)? (?:an? )?(?:quick |short |formal )?e-?mail (?:to|for) (.+?) (?:about|regarding|on|saying|re) (.+)$/, /^e-?mail (.+?) (?:about|regarding) (.+)$/],
    resolve: (m) => builtin('draft_message', { channel: 'email', name: m[1], topic: m[2] }) }),
  cmd({ id: 'message.whatsapp', category: 'Communication', tool: 'message.whatsapp', description: 'Prepare a WhatsApp message (you choose the chat and press Send).', examples: ['send a whatsapp message to priya about the project deadline extension', 'whatsapp amit that i am running late'],
    patterns: [/^(?:send|write|draft|compose)(?: a)? (?:whatsapp|whats app)(?: message| text| msg)? to (.+?) (?:about|regarding|saying|that|on) (.+)$/, /^(?:whatsapp|whats app) (.+?) (?:about|saying|that) (.+)$/],
    resolve: (m) => builtin('draft_message', { channel: 'whatsapp', name: m[1], topic: m[2] }) }),

  // ---------------------------------------------------------------- AI study helpers that make files
  cmd({ id: 'ai.flashcards', category: 'AI', description: 'Flashcards for a topic saved to a text file (needs a language model).', examples: ['generate flashcards for studying quantum computing and save to a text file'],
    patterns: [/^(?:generate|create|make|give me)(?: some| \d+)? flash ?cards (?:for|on|about)(?: studying| learning)? (.+?)(?: and (?:save|export|put) (?:them |it )?(?:to|in|into|as) (?:a )?(?:text|txt|notes?)(?: file)?)?$/],
    resolve: (m) => builtin('ai_task', { kind: 'flashcards', topic: m[1] }) }),

  // ---------------------------------------------------------------- diagnostics (last: broad)
  cmd({ id: 'system.diagnostic', category: 'System', tool: 'system.diagnostic', description: 'Measure and explain 25 system areas (CPU and temperature, memory, disks, disk speed, battery health, GPU, bandwidth, IP, Wi-Fi signal, top processes, ports, USB, Bluetooth, display, updates, crashes, latency, folder sizes, Recycle Bin…), check them against safe limits, sample for 10 seconds, or save, copy, notify, pin or email the report.', examples: ["check my laptop's cpu usage and core temperatures", 'warn me if there is any issue with battery health', 'export my laptops disk read and write io speeds to a text log', 'generate an excel table of connected usb devices and external drives', 'run a 10-second stress and stability check on ram memory consumption and swap usage', 'what is my public ip address'],
    patterns: [/./],
    resolve: (_m, text) => {
      // Web searches about a metric ("search google for how to fix high cpu") belong to the browser.
      if (/^(?:search|look up|google)\b/.test(text) || /\b(outside|weather|forecast)\b/.test(text)) return null;
      // Short everyday questions ("how much battery do i have", "whats using my memory") keep their simple answers.
      if (/^(?:how much|how long|whats|what is|is my|am i)\b/.test(text) && text.split(' ').length <= 7 && !/\b(report|health|temperatures?|speeds?|signal|ip|address|ports?|usb|bluetooth|gpu|vram|crash(es)?|updates?|latency|ping|recycle|resolution|refresh|version|bandwidth|swap|partitions?|drivers?)\b/.test(text)) return null;
      const metric = findMetric(text);
      if (!metric) return null;
      const plan = diagPlan(text);
      if (!plan) return null;
      // Short generic phrases ("battery", "cpu usage") stay with the simpler tools unless asked for a report.
      const generic = /^(?:whats|what is|check|show|how much|tell me)(?: me)?(?: my| the)? (?:cpu|processor|ram|memory|battery|disk space|storage|uptime)(?: usage| level| left| status)?$/.test(text);
      if (generic) return null;
      return tool('system.diagnostic', { metric: plan.spike ? SPIKE[metric] ?? metric : metric, detail: plan.detail, output: plan.output, ...(plan.note ? { note: plan.note } : {}), ...(plan.desktop ? { toDesktop: true } : {}) });
    },
    // "GPU utilization and VRAM memory usage" is one report, not a report plus a resources check.
    absorbs: ['system.diagnostic', 'system.resources', 'system.battery', 'system.storage', 'system.uptime', 'system.network', 'system.info'] }),
];
