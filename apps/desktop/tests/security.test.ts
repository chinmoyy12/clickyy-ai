import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWebUrl, UrlRejected, isLoopbackHost, settingsUri, searchUrl } from '../src/main/security/url';
import { resolveApproved, PathRejected, validateFileName } from '../src/main/security/paths';
import { redact } from '../src/main/security/redact';
import { NetGuard, OfflinePolicyError } from '../src/main/security/netGuard';
import { EncryptedFileSecretStore, type SecretCipher } from '../src/main/security/secrets';

describe('URL validation', () => {
  it('accepts http(s) and bare domains', () => {
    expect(validateWebUrl('github.com').toString()).toBe('https://github.com/');
    expect(validateWebUrl('http://example.org/a?b=1').hostname).toBe('example.org');
  });
  it.each(['javascript:alert(1)', 'file:///C:/Windows/System32', 'ms-settings:privacy', 'vbscript:x', 'data:text/html,hi', 'https://user:pass@evil.com', 'https://nohost', '', 'https://exa mple.com'])('rejects %s', (u) => {
    expect(() => validateWebUrl(u)).toThrow(UrlRejected);
  });
  it('detects loopback hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('[::1]')).toBe(true);
    expect(isLoopbackHost('api.anthropic.com')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.evil.com')).toBe(false);
  });
  it('maps only allowlisted settings pages', () => {
    expect(settingsUri('bluetooth')).toBe('ms-settings:bluetooth');
    expect(() => settingsUri('../../evil')).toThrow();
  });
  it('encodes search queries', () => {
    expect(searchUrl('duckduckgo', 'a&b=c')).toBe('https://duckduckgo.com/?q=a%26b%3Dc');
  });
});

describe('path boundary enforcement', () => {
  const root = mkdtempSync(join(tmpdir(), 'clickyy-'));
  const approved = join(root, 'approved');
  const outside = join(root, 'outside');
  mkdirSync(approved);
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.txt'), 'x');

  it('allows paths inside approved roots', () => {
    expect(resolveApproved('notes.txt', [approved])).toBe(join(approved, 'notes.txt'));
    expect(resolveApproved(join(approved, 'sub', 'a.md'), [approved])).toBe(join(approved, 'sub', 'a.md'));
  });
  it.each(['..\\outside\\secret.txt', '../outside/secret.txt', 'sub\\..\\..\\outside\\secret.txt'])('blocks traversal %s', (p) => {
    expect(() => resolveApproved(p, [approved])).toThrow(PathRejected);
  });
  it('blocks absolute paths elsewhere, protected and UNC paths', () => {
    expect(() => resolveApproved(join(outside, 'secret.txt'), [approved])).toThrow(PathRejected);
    expect(() => resolveApproved('C:\\Windows\\System32\\config\\SAM', ['C:\\'])).toThrow(/protected/);
    expect(() => resolveApproved('\\\\server\\share\\x', [approved])).toThrow(PathRejected);
  });
  it('blocks prefix-sibling tricks', () => {
    mkdirSync(`${approved}-evil`, { recursive: true });
    expect(() => resolveApproved(`${approved}-evil\\x.txt`, [approved])).toThrow(PathRejected);
  });
  it('follows junctions out of the approved root and blocks them', () => {
    const link = join(approved, 'link');
    try {
      symlinkSync(outside, link, 'junction');
    } catch {
      return; // junction creation not permitted in this environment
    }
    expect(() => resolveApproved(join(link, 'secret.txt'), [approved])).toThrow(PathRejected);
  });
  it('requires configured roots', () => {
    expect(() => resolveApproved('a.txt', [])).toThrow(/No approved folders/);
  });
  it('validates file names', () => {
    expect(validateFileName('report.md')).toBe('report.md');
    for (const bad of ['CON', 'a/b', 'x:y', '..', 'name.', 'a\\b', 'nul.txt']) expect(() => validateFileName(bad)).toThrow(PathRejected);
  });
});

describe('secret redaction', () => {
  it('removes API keys, bearer tokens and card numbers', () => {
    const s = redact('key sk-ant-api03-abcdefghijklmnop and Bearer abcdefghijklmnopqrstuv and api_key=supersecret123 card 4111 1111 1111 1111');
    expect(s).not.toMatch(/abcdefghijklmnop|supersecret123|4111 1111/);
    expect(s).toContain('[REDACTED]');
  });
  it('removes explicitly known secrets', () => {
    expect(redact('value=my-custom-token-xyz', ['my-custom-token-xyz'])).toBe('value=[REDACTED]');
  });
});

describe('network guard', () => {
  const okFetch = (async () => new Response('ok')) as unknown as typeof fetch;
  it('blocks remote hosts in strict offline mode but allows loopback', async () => {
    const g = new NetGuard(() => 'strict_offline', () => {}, okFetch);
    await expect(g.fetchFor('test')('https://api.anthropic.com/v1/messages')).rejects.toBeInstanceOf(OfflinePolicyError);
    await expect(g.fetchFor('test')('http://127.0.0.1:11434/api/tags')).resolves.toBeInstanceOf(Response);
  });
  it('reports remote activity in online modes', async () => {
    const events: boolean[] = [];
    const g = new NetGuard(() => 'online_preferred', (a) => events.push(a.active), okFetch);
    await g.fetchFor('test')('https://api.example.com/x');
    expect(events).toEqual([true, false]);
  });
});

describe('secret store', () => {
  const cipher = (available: boolean): SecretCipher => ({
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(s.split('').reverse().join(''), 'utf8'),
    decryptString: (b) => b.toString('utf8').split('').reverse().join(''),
  });
  it('persists encrypted values and never writes plaintext', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'clickyy-sec-')), 's.json');
    const s = new EncryptedFileSecretStore(file, cipher(true));
    s.set('anthropic', 'sk-ant-secret-value-123');
    const raw = (await import('node:fs')).readFileSync(file, 'utf8');
    expect(raw).not.toContain('sk-ant-secret-value-123');
    expect(new EncryptedFileSecretStore(file, cipher(true)).get('anthropic')).toBe('sk-ant-secret-value-123');
  });
  it('refuses to store when OS encryption is unavailable', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'clickyy-sec-')), 's.json');
    expect(() => new EncryptedFileSecretStore(file, cipher(false)).set('anthropic', 'k')).toThrow(/unavailable/);
  });
});
