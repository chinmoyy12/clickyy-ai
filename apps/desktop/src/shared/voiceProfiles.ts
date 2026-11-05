import type { Settings, VoiceProfileId } from './settings';
import type { ExpressionStyle } from './types';

export interface ProfileDef {
  label: string;
  summary: string;
  /** Delivery multipliers applied on top of the user's rate/pitch settings (only where the engine supports them). */
  rate: number;
  pitch: number;
  persona: string;
  sample: string;
}

export const PROFILES: Record<VoiceProfileId, ProfileDef> = {
  sweet: { label: 'Sweet', summary: 'Warm, soft and gentle.', rate: 0.96, pitch: 1.06, persona: 'warm, soft-spoken and gently encouraging', sample: "Hi there. I'm right here whenever you need me." },
  natural: { label: 'Natural', summary: 'Conversational and balanced.', rate: 1, pitch: 1, persona: 'natural, relaxed and conversational, like a capable friend', sample: "Hey. Want me to open your project and set up the usual?" },
  elegant: { label: 'Elegant', summary: 'Composed, polished, confident.', rate: 0.95, pitch: 0.98, persona: 'composed, polished and quietly confident, with refined wording', sample: 'Good evening. Your workspace is ready whenever you are.' },
  playful: { label: 'Playful', summary: 'Witty, cheerful, lightly teasing.', rate: 1.04, pitch: 1.07, persona: 'witty and cheerful, with light, good-natured teasing', sample: 'Twenty tabs open again? Bold strategy. Want me to tidy up?' },
  professional: { label: 'Professional', summary: 'Concise, clear, focused.', rate: 1.03, pitch: 0.98, persona: 'concise, clear and focused on the task, with no small talk', sample: 'Done. Volume is at thirty percent.' },
  soothing: { label: 'Soothing', summary: 'Slower, calm, reassuring.', rate: 0.88, pitch: 0.97, persona: 'calm, slow-paced and reassuring', sample: "Let's take this one step at a time. I've started a ten minute break." },
  energetic: { label: 'Energetic', summary: 'Expressive and enthusiastic.', rate: 1.08, pitch: 1.08, persona: 'upbeat, expressive and enthusiastic without being over the top', sample: "Let's go! Focus session started. Twenty five minutes on the clock." },
  charming: { label: 'Charming', summary: 'Warm, confident, subtly flirtatious.', rate: 0.97, pitch: 1.03, persona: 'warm and confident with tasteful, subtle charm; never explicit, never pushy', sample: 'Well, look who it is. What can I do for you today?' },
  butler: { label: 'Butler', summary: 'Composed, impeccably polite, dry wit.', rate: 0.97, pitch: 0.97, persona: 'a composed, impeccably polite personal assistant with understated dry wit and quiet competence; anticipates needs, keeps replies crisp, and never fawns', sample: 'At your service. The workspace is ready, and I took the liberty of lowering the volume.' },
  custom: { label: 'Custom', summary: 'Uses your own speed and pitch settings only.', rate: 1, pitch: 1, persona: 'friendly and helpful', sample: 'This is how I sound with your custom settings.' },
};

/** Per-style delivery tweaks. Only applied when adaptive expression is on. */
const STYLE_PROSODY: Record<ExpressionStyle, { rate: number; pitch: number }> = {
  warm: { rate: 0.98, pitch: 1.03 }, confident: { rate: 1.02, pitch: 1 }, calm: { rate: 0.93, pitch: 0.98 }, apologetic: { rate: 0.95, pitch: 0.97 },
  excited: { rate: 1.06, pitch: 1.06 }, gentle: { rate: 0.92, pitch: 0.99 }, focused: { rate: 1.03, pitch: 0.99 }, neutral: { rate: 1, pitch: 1 },
};

export function prosody(settings: Settings, style: ExpressionStyle): { rate: number; pitch: number } {
  const p = PROFILES[settings.personality.profile];
  const s = settings.personality.adaptiveExpression ? STYLE_PROSODY[style] : STYLE_PROSODY.neutral;
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return { rate: clamp(settings.speech.rate * p.rate * s.rate, 0.5, 2), pitch: clamp(settings.speech.pitch * p.pitch * s.pitch, 0.5, 1.5) };
}
