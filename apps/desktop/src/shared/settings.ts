import { z } from 'zod';

export const WAKE_PHRASES = ['hey_clickyy', 'clickyy', 'jarvis'] as const;
export type WakePhraseId = (typeof WAKE_PHRASES)[number];
export const WAKE_PHRASE_LABELS: Record<WakePhraseId, string> = {
  hey_clickyy: 'Hey Clickyy',
  clickyy: 'Clickyy',
  jarvis: 'Jarvis',
};

export const VOICE_PROFILES = [
  'sweet', 'natural', 'elegant', 'playful', 'professional', 'soothing', 'energetic', 'charming', 'custom',
] as const;
export type VoiceProfileId = (typeof VOICE_PROFILES)[number];

export const ROUTING_POLICIES = ['strict_offline', 'smart_hybrid', 'online_preferred'] as const;
export type RoutingPolicy = (typeof ROUTING_POLICIES)[number];

export const PERMISSION_KEYS = ['system', 'media', 'apps', 'windows', 'web', 'files', 'automation', 'clipboard', 'power'] as const;
export type PermissionKey = (typeof PERMISSION_KEYS)[number];

import { CLOUD_PROVIDERS, LOCAL_RUNTIMES } from './providers';
export { CLOUD_PROVIDERS, type CloudProviderId } from './providers';

const shortcut = z.string().max(64).regex(/^[A-Za-z0-9+ ]*$/, 'Invalid accelerator');
const unit = z.number().min(0).max(1);

export const SettingsSchema = z.object({
  version: z.literal(1).default(1),
  assistantName: z.string().trim().min(1).max(32).default('Clickyy'),
  userAddress: z.string().trim().max(40).default(''),
  wake: z.object({
    enabled: z.boolean().default(false),
    phrases: z.object({ hey_clickyy: z.boolean().default(true), clickyy: z.boolean().default(true), jarvis: z.boolean().default(true) }).prefault({}),
    sensitivity: unit.default(0.5),
    cooldownMs: z.number().int().min(500).max(10000).default(2000),
    chime: z.boolean().default(true),
  }).prefault({}),
  listening: z.object({
    mode: z.enum(['push_to_talk', 'wake_word', 'conversation']).default('push_to_talk'),
    followUpMs: z.number().int().min(0).max(30000).default(6000),
    commandTimeoutMs: z.number().int().min(2000).max(30000).default(9000),
    interruption: z.enum(['stop', 'ignore']).default('stop'),
  }).prefault({}),
  speech: z.object({
    sttEngine: z.enum(['vosk']).default('vosk'),
    language: z.enum(['en-US']).default('en-US'),
    ttsEngine: z.enum(['system', 'cloud', 'off']).default('system'),
    voiceName: z.string().max(200).default(''),
    cloudVoice: z.string().max(64).default('nova'),
    cloudTtsProvider: z.enum(['openai', 'openai_compatible']).default('openai'),
    rate: z.number().min(0.5).max(2).default(1),
    pitch: z.number().min(0.5).max(1.5).default(1.05),
    volume: unit.default(1),
    chimes: z.boolean().default(true),
  }).prefault({}),
  personality: z.object({
    profile: z.enum(VOICE_PROFILES).default('natural'),
    humor: z.number().int().min(0).max(2).default(1),
    formality: z.enum(['casual', 'balanced', 'formal']).default('balanced'),
    verbosity: z.enum(['brief', 'normal', 'detailed']).default('brief'),
    adaptiveExpression: z.boolean().default(true),
    companionMode: z.boolean().default(false),
  }).prefault({}),
  ai: z.object({
    policy: z.enum(ROUTING_POLICIES).default('smart_hybrid'),
    allowCloudTranscripts: z.boolean().default(false),
    local: z.object({
      runtime: z.enum(LOCAL_RUNTIMES).default('ollama'),
      baseUrl: z.string().url().default('http://127.0.0.1:11434'),
      model: z.string().max(120).default(''),
      timeoutMs: z.number().int().min(2000).max(300000).default(60000),
    }).prefault({}),
    cloud: z.object({
      provider: z.enum(CLOUD_PROVIDERS).default('anthropic'),
      model: z.string().max(120).default('claude-opus-5-5'),
      baseUrl: z.string().max(300).default(''),
      timeoutMs: z.number().int().min(2000).max(300000).default(45000),
      maxTokens: z.number().int().min(64).max(64000).default(2048),
      effort: z.enum(['low', 'medium', 'high']).default('low'),
      fallbackToLocal: z.boolean().default(true),
      /** Optional second cloud provider tried when the primary fails. */
      fallbackProvider: z.enum([...CLOUD_PROVIDERS, 'none'] as [string, ...string[]]).default('none'),
      fallbackModel: z.string().max(120).default(''),
    }).prefault({}),
    contextTurns: z.number().int().min(2).max(50).default(12),
  }).prefault({}),
  tools: z.object({
    permissions: z.object({
      system: z.boolean().default(true),
      media: z.boolean().default(true),
      apps: z.boolean().default(true),
      windows: z.boolean().default(true),
      web: z.boolean().default(true),
      files: z.boolean().default(false),
      automation: z.boolean().default(false),
      clipboard: z.boolean().default(false),
      power: z.boolean().default(false),
    }).prefault({}),
    approvedFolders: z.array(z.string().max(400)).max(32).default([]),
    workspaceFolder: z.string().max(400).default(''),
    searchEngine: z.enum(['duckduckgo', 'bing', 'google']).default('duckduckgo'),
  }).prefault({}),
  privacy: z.object({
    saveHistory: z.boolean().default(true),
    historyRetentionDays: z.number().int().min(1).max(3650).default(30),
    auditLog: z.boolean().default(true),
  }).prefault({}),
  ui: z.object({
    alwaysOnTop: z.boolean().default(false),
    closeBehavior: z.enum(['tray', 'quit']).default('tray'),
    reducedMotion: z.enum(['system', 'on', 'off']).default('system'),
    textScale: z.number().min(0.8).max(1.6).default(1),
    highContrast: z.boolean().default(false),
    globalShortcut: shortcut.default('Control+Shift+Space'),
    muteShortcut: shortcut.default('Control+Shift+M'),
    launchAtLogin: z.boolean().default(false),
    startHidden: z.boolean().default(false),
  }).prefault({}),
});

export type Settings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): Settings => SettingsSchema.parse({});

export type DeepPartial<T> = T extends Array<unknown> ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;

export function mergeSettings(base: Settings, patch: DeepPartial<Settings>): Settings {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a;
    if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
      const out: Record<string, unknown> = { ...(a as Record<string, unknown>) };
      for (const [k, v] of Object.entries(b as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return b;
  };
  return SettingsSchema.parse(merge(base, patch));
}

/** Parse stored settings leniently: invalid sections fall back to defaults instead of failing startup. */
export function loadSettings(raw: unknown): { settings: Settings; repaired: boolean } {
  const direct = SettingsSchema.safeParse(raw ?? {});
  if (direct.success) return { settings: direct.data, repaired: false };
  const fallback = defaultSettings() as unknown as Record<string, unknown>;
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const key of Object.keys(fallback)) {
    const candidate = { ...fallback, [key]: source[key] };
    const ok = SettingsSchema.safeParse(candidate);
    if (ok.success) fallback[key] = (ok.data as Record<string, unknown>)[key];
  }
  return { settings: SettingsSchema.parse(fallback), repaired: true };
}
