import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { CloudProviderId } from '@shared/settings';

export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(data: Buffer): string;
}

export interface SecretStore {
  get(provider: CloudProviderId): string | null;
  set(provider: CloudProviderId, value: string): void;
  clear(provider: CloudProviderId): void;
  has(provider: CloudProviderId): boolean;
  all(): string[];
}

/**
 * Stores API keys encrypted with an OS-backed cipher (Electron safeStorage → DPAPI
 * on Windows). Refuses to store anything when encryption is unavailable rather
 * than falling back to plaintext.
 */
export class EncryptedFileSecretStore implements SecretStore {
  private cache = new Map<string, string>();

  constructor(private file: string, private cipher: SecretCipher) {
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, string>;
        for (const [k, v] of Object.entries(data)) {
          try {
            this.cache.set(k, cipher.decryptString(Buffer.from(v, 'base64')));
          } catch {
            /* undecryptable (different user/machine) — treat as absent */
          }
        }
      } catch {
        /* corrupt file — start empty */
      }
    }
  }

  get(provider: CloudProviderId) { return this.cache.get(provider) ?? null; }
  has(provider: CloudProviderId) { return this.cache.has(provider); }
  all() { return [...this.cache.values()]; }

  set(provider: CloudProviderId, value: string) {
    if (!this.cipher.isEncryptionAvailable()) throw new Error('OS secure storage is unavailable; API keys cannot be stored safely.');
    this.cache.set(provider, value);
    this.persist();
  }

  clear(provider: CloudProviderId) {
    this.cache.delete(provider);
    this.persist();
  }

  private persist() {
    const out: Record<string, string> = {};
    for (const [k, v] of this.cache) out[k] = this.cipher.encryptString(v).toString('base64');
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(out), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

export class MemorySecretStore implements SecretStore {
  private m = new Map<string, string>();
  get(p: CloudProviderId) { return this.m.get(p) ?? null; }
  set(p: CloudProviderId, v: string) { this.m.set(p, v); }
  clear(p: CloudProviderId) { this.m.delete(p); }
  has(p: CloudProviderId) { return this.m.has(p); }
  all() { return [...this.m.values()]; }
}
