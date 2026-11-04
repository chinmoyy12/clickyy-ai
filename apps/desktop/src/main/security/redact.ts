const PATTERNS: Array<[RegExp, string]> = [
  [/sk-ant-[A-Za-z0-9_-]{8,}/g, 'sk-ant-[REDACTED]'],
  [/sk-[A-Za-z0-9_-]{16,}/g, 'sk-[REDACTED]'],
  [/(?<=Bearer\s)[A-Za-z0-9._~+/=-]{12,}/gi, '[REDACTED]'],
  [/(?<=(?:api[_-]?key|token|password|secret)["'\s:=]+)[^\s"',}]{6,}/gi, '[REDACTED]'],
  [/AKIA[0-9A-Z]{16}/g, 'AKIA[REDACTED]'],
  [/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED-NUMBER]'],
];

/** Removes credentials and card-like numbers from free text before it is logged. */
export function redact(input: string, extraSecrets: string[] = []): string {
  let out = input;
  for (const s of extraSecrets) if (s && s.length >= 6) out = out.split(s).join('[REDACTED]');
  for (const [re, rep] of PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Shortens and redacts a value for audit summaries. */
export function auditSummary(value: unknown, max = 160): string {
  let s: string;
  try {
    s = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    s = String(value);
  }
  s = redact(s ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
