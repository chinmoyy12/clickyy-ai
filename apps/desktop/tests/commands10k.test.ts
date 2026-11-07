import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { route } from '../src/main/assistant/router';
import { CATALOG } from '../src/main/assistant/catalog';
import { detectApps } from '../src/main/tools/apps';
import { parseLoan, parseRow, powerAction, fileType, fileFolder, diagPlan, appName } from '../src/main/assistant/catalog-ext';
import { findLang, parseCodeFiles, parseComparison, taskSlug } from '../src/main/assistant/codegen';
import { findFeature, FEATURES } from '../src/main/assistant/knowledge/features';
import { findMetric } from '../src/main/assistant/knowledge/metrics';
import { amortizationRows, findSheetTemplate, SHEET_TEMPLATES } from '../src/main/assistant/knowledge/sheets';
import { buildPdf } from '../src/main/tools/pdf';
import { buildXlsx, colLetter, expandFormula } from '../src/main/tools/xlsx';
import { buildZip, crc32 } from '../src/main/tools/zip';
import { nextOccurrence } from '../src/main/scheduler';
import { parseClockTime } from '../src/main/assistant/normalize';
import type { AppEntry } from '../src/shared/types';

const apps: AppEntry[] = detectApps(() => true).map((a, i) => ({ ...a, id: `a${i}` }));
const ctx = { session: {}, apps, browser: 'default' as const, browsers: ['chrome', 'edge'] as ('chrome' | 'edge')[] };

/** 1,081 commands sampled evenly from every intent family of the 10,000-command list. */
const SAMPLES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'commands10k-sample.json'), 'utf8')) as Array<{ intent: string; text: string; expect: string }>;

describe('10,000-command list (sampled)', () => {
  it('covers every intent family', () => {
    expect(new Set(SAMPLES.map((s) => s.intent)).size).toBeGreaterThanOrEqual(190);
  });
  it.each(SAMPLES.map((s) => [s.text, s.expect] as const))('"%s" → %s', (text, want) => {
    const r = route(text, ctx);
    const got = r.kind === 'commands' ? r.steps.map((s) => s.commandId).join(' + ') : 'none';
    expect(got).toBe(want);
  });
  it('never splits a code request or a diagnostic report into pieces', () => {
    for (const s of SAMPLES) if (/^(code\.task|system\.diagnostic)$/.test(s.expect.split(' + ')[0])) expect(s.expect).not.toContain('+');
  });
  it('sends open-ended study requests to the language model', () => {
    for (const s of SAMPLES.filter((x) => x.intent.startsWith('SMART_AI') && !/FLASHCARD|EXCEL|DEMO/.test(x.intent))) expect(s.expect).toBe('none');
  });
  it('still splits two genuinely different commands', () => {
    const r = route('check my battery health and open spotify', ctx);
    expect(r.kind === 'commands' && r.steps.length).toBe(2);
  });
  it('every catalog id is unique', () => {
    const ids = CATALOG.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('builder parsers', () => {
  it('parses spoken and typed rows', () => {
    expect(parseRow('Rent, fixed, 15,000, 14500', 4)).toEqual(['Rent', 'fixed', '15000', '14500']);
    expect(parseRow('groceries 6000 5400', 3)).toEqual(['groceries', '6000', '5400']);
    expect(parseRow('car loan 5 lakh', 2)).toEqual(['car loan', '5 lakh']);
  });
  it('parses loans in Indian and plain units', () => {
    expect(parseLoan('25 lakh at 8.5 percent for 20 years')).toEqual({ principal: 2500000, rate: 8.5, months: 240, prepayment: 0 });
    expect(parseLoan('500000 9.5 60')).toMatchObject({ principal: 500000, rate: 9.5, months: 60 });
    expect(parseLoan('10 lakh at 9% for 5 years with a prepayment of 5000')?.prepayment).toBe(5000);
    expect(parseLoan('hello')).toBeNull();
  });
  it('amortization pays the loan off', () => {
    const rows = amortizationRows(100000, 12, 12, new Date(2026, 0, 1));
    expect(rows).toHaveLength(12);
    expect(Number(rows[11][rows[11].length - 1])).toBeLessThan(1);
  });
  it('finds sheet templates', () => {
    expect(SHEET_TEMPLATES.length).toBeGreaterThanOrEqual(30);
    expect(findSheetTemplate('monthly personal budget')?.id).toBeTruthy();
    expect(findSheetTemplate('an invoice for a client')?.id).toBe('invoice');
  });
});

describe('command helpers', () => {
  it('power actions', () => {
    expect(powerAction('put my laptop to sleep')).toBe('sleep');
    expect(powerAction('turn off the laptop monitor without sleeping')).toBe('display_off');
    expect(powerAction('shut down my laptop completely')).toBe('shutdown');
    expect(powerAction('sign out of my current user session')).toBe('signout');
  });
  it('file types and folders', () => {
    expect(fileType('find all pdf documents')).toBe('pdf');
    expect(fileType('png and jpg images')).toBe('images');
    expect(fileFolder('find all pdf documents in my desktop folder')).toBe('desktop');
    expect(fileFolder('back up all python scripts from projects to my backups folder')).toBe('projects');
  });
  it('app names', () => {
    expect(appName('Terminal / Command Prompt')).toBe('Terminal');
    expect(appName('pycharm ide')).toBe('pycharm');
  });
  it('diagnostic plans', () => {
    expect(diagPlan('export my cpu usage to a text log')?.output).toBe('file');
    expect(diagPlan('generate an excel table of ram')?.output).toBe('excel');
    expect(diagPlan('run a 10-second stress check on cpu')?.detail).toBe('sample');
    expect(diagPlan('check if any background app is spiking cpu')?.spike).toBe(true);
  });
  it('metrics and features', () => {
    expect(findMetric('cpu usage and core temperatures')).toBe('cpu');
    expect(findMetric('operating system deadlocks')).toBeNull();
    expect(FEATURES.length).toBeGreaterThanOrEqual(35);
    expect(findFeature('wi-fi')?.id).toBeTruthy();
    expect(findFeature('quantum computing')).toBeNull();
  });
});

describe('code generation parsing', () => {
  const py = findLang('python')!;
  it('finds languages', () => {
    expect(py.ext).toBe('py');
    expect(findLang('a rest api client')).toBeNull();
  });
  it('parses files and rejects paths that escape the project', () => {
    const text = 'SUMMARY: A tiny app.\nFILE: main.py\n```python\nprint(1)\n```\nFILE: ../evil.py\n```python\nx\n```\nFILE: C:/win.py\n```\ny\n```';
    const r = parseCodeFiles(text, py, 'app');
    expect(r.summary).toBe('A tiny app.');
    expect(r.files.map((f) => f.path)).toEqual(['main.py']);
  });
  it('makes safe slugs and parses comparisons', () => {
    expect(taskSlug('A REST API client with retry logic!')).toMatch(/^[a-z0-9_]+$/);
    const c = parseComparison('Sure: {"criteria": ["Speed", "Cost"], "options": [{"name": "A", "values": ["fast", "high"]}, {"name": "B", "values": ["slow", "low"]}]}');
    expect(c?.columns).toEqual(['Criterion', 'A', 'B']);
    expect(c?.rows[0]).toEqual(['Speed', 'fast', 'slow']);
    expect(parseComparison('no json here')).toBeNull();
  });
});

describe('file writers', () => {
  it('writes a valid PDF', () => {
    const pdf = buildPdf('Notes', 'Line one\nLine two '.repeat(200));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
  });
  it('writes a ZIP with correct CRCs', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
    const zip = buildZip([{ name: 'a.txt', data: 'hello' }]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
  });
  it('writes an xlsx with formulas', () => {
    expect(colLetter(0)).toBe('A');
    expect(colLetter(27)).toBe('AB');
    const cols = [{ header: 'Budgeted', type: 'money' as const }, { header: 'Actual', type: 'money' as const }, { header: 'Diff', type: 'money' as const, formula: '{Budgeted}-{Actual}' }];
    expect(expandFormula('{Budgeted}-{Actual}', cols, 3)).toBe('A3-B3');
    const x = buildXlsx({ title: 'Budget', columns: cols, rows: [[100, 80]] });
    expect(x.readUInt32LE(0)).toBe(0x04034b50);
  });
});

describe('schedules', () => {
  it('repeats reminders', () => {
    const mon9 = new Date(2026, 10, 2, 9, 0).getTime(); // Monday
    expect(new Date(nextOccurrence(mon9, 'daily', mon9 + 1)).getDate()).toBe(3);
    expect(new Date(nextOccurrence(mon9, 'weekly', mon9 + 1)).getDate()).toBe(9);
    const fri9 = new Date(2026, 10, 6, 9, 0).getTime();
    expect(new Date(nextOccurrence(fri9, 'weekdays', fri9 + 1)).getDay()).toBe(1);
  });
  it('understands weekday names', () => {
    const now = new Date(2026, 10, 4, 12, 0); // Wednesday
    const fri = parseClockTime('friday at 3 pm', now)!;
    expect(fri.getDay()).toBe(5);
    expect(fri.getHours()).toBe(15);
    expect(parseClockTime('next monday', now)!.getHours()).toBe(9);
  });
});
