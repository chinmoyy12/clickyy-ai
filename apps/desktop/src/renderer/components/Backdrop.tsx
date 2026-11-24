import type { OrbMode } from './Orb';

/**
 * Ambient depth behind the main view: slow aurora light, a perspective horizon grid and fine grain.
 * Pure CSS (GPU transforms only), tinted by the assistant's state, and still when motion is reduced.
 */
export function Backdrop({ mode }: { mode: OrbMode }) {
  const mood = mode === 'listening' ? 'listen' : mode === 'error' ? 'error' : mode === 'muted' || mode === 'offline' ? 'quiet' : mode === 'idle' ? 'calm' : 'active';
  return (
    <div className="backdrop" data-mood={mood} aria-hidden="true">
      <div className="aurora aurora-a" />
      <div className="aurora aurora-b" />
      <div className="aurora aurora-c" />
      <div className="horizon"><div className="grid-floor" /></div>
      <div className="grain" />
      <div className="vignette" />
    </div>
  );
}
