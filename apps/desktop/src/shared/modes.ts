/**
 * Response modes. One switch trades speed for depth across every engine:
 * fewer tokens and no deliberation in Fast, deeper reasoning and longer answers in Turbo.
 */
export const AI_MODES = ['fast', 'balanced', 'turbo'] as const;
export type AiMode = (typeof AI_MODES)[number];

export interface ModeProfile {
  label: string;
  /** Spoken confirmation when the mode is switched. */
  spoken: string;
  /** Output token budget for cloud models (Balanced keeps the user's own setting). */
  cloudTokens: (configured: number) => number;
  cloudEffort: (configured: 'low' | 'medium' | 'high') => 'low' | 'medium' | 'high';
  /** Gemini / OpenAI-style reasoning_effort; undefined leaves the provider default. */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** Output token budget for models running on this PC. */
  localTokens: number;
  /** Let the built-in model think before answering (slower, better at multi-step problems). */
  thinking: boolean;
  /** Extra line in the system prompt. */
  prompt: string;
}

export const MODE_PROFILES: Record<AiMode, ModeProfile> = {
  fast: {
    label: 'Fast',
    spoken: 'Fast mode on. Short, quick answers.',
    cloudTokens: (c) => Math.min(c, 700),
    cloudEffort: () => 'low',
    reasoningEffort: 'low',
    localTokens: 400,
    thinking: false,
    prompt: 'Response mode: Fast. Answer in one or two short sentences. For tasks, call the tool at once without deliberating.',
  },
  balanced: {
    label: 'Balanced',
    spoken: 'Balanced mode on.',
    cloudTokens: (c) => c,
    cloudEffort: (e) => e,
    localTokens: 1200,
    thinking: false,
    prompt: '',
  },
  turbo: {
    label: 'Turbo',
    spoken: 'Turbo mode on. I will think things through more carefully.',
    cloudTokens: (c) => Math.max(c, 8192),
    cloudEffort: () => 'high',
    reasoningEffort: 'high',
    localTokens: 4096,
    thinking: true,
    prompt: 'Response mode: Turbo. Think step by step before answering: plan multi-part tasks, check facts and arithmetic, and verify each tool result before moving on. Give a complete answer, still in natural spoken language.',
  },
};
