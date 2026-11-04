import { z } from 'zod';
import { defineTool, type ToolDef } from './types';
import type { VolumeState } from '../windows/bridge';

const none = z.object({}).strict();
const level = z.number().int().min(0).max(100);

export const mediaTools: ToolDef[] = [
  defineTool({
    name: 'audio.get_volume', title: 'Read volume', description: 'Read the current master volume and mute state.', category: 'Audio', risk: 1, permission: 'media',
    input: none, confirm: 'never', timeoutMs: 4000, offline: true,
    describe: () => 'Read the volume',
    async run(_i, ctx) {
      const v = await ctx.bridge.call<VolumeState>('volume.get');
      return { ok: true, data: v, message: v.muted ? `Sound is muted. The volume is set to ${v.level} percent.` : `Volume is at ${v.level} percent.` };
    },
  }),
  defineTool({
    name: 'audio.set_volume', title: 'Set volume', description: 'Set the master volume to an absolute percentage (0-100), or change it by a relative amount.', category: 'Audio', risk: 1, permission: 'media',
    input: z.object({ level: level.optional(), delta: z.number().int().min(-100).max(100).optional() }).strict()
      .refine((i) => (i.level === undefined) !== (i.delta === undefined), 'Provide exactly one of level or delta'),
    confirm: 'never', timeoutMs: 4000, offline: true,
    describe: (i) => (i.level !== undefined ? `Set volume to ${i.level}%` : `Change volume by ${i.delta}%`),
    async run(i, ctx) {
      const before = await ctx.bridge.call<VolumeState>('volume.get');
      const target = i.level !== undefined ? i.level : Math.max(0, Math.min(100, before.level + (i.delta ?? 0)));
      ctx.session.previousVolume = before.level;
      if (before.muted && target > 0) await ctx.bridge.call('volume.mute', { mute: false });
      const after = await ctx.bridge.call<VolumeState>('volume.set', { level: target });
      const ok = Math.abs(after.level - target) <= 1;
      return { ok, data: after, message: ok ? `Done. Volume is at ${after.level} percent.` : `I tried, but Windows reports the volume at ${after.level} percent.` };
    },
  }),
  defineTool({
    name: 'audio.mute', title: 'Mute / unmute', description: 'Mute or unmute the speakers.', category: 'Audio', risk: 1, permission: 'media',
    input: z.object({ mute: z.boolean() }).strict(), confirm: 'never', timeoutMs: 4000, offline: true,
    describe: ({ mute }) => (mute ? 'Mute sound' : 'Unmute sound'),
    async run({ mute }, ctx) {
      const after = await ctx.bridge.call<VolumeState>('volume.mute', { mute });
      const ok = after.muted === mute;
      return { ok, data: after, message: ok ? (mute ? 'Muted.' : `Unmuted. Volume is at ${after.level} percent.`) : "Windows didn't apply the mute change." };
    },
  }),
  defineTool({
    name: 'audio.restore_volume', title: 'Restore previous volume', description: 'Restore the volume level from before the last change.', category: 'Audio', risk: 1, permission: 'media',
    input: none, confirm: 'never', timeoutMs: 4000, offline: true,
    describe: () => 'Restore the previous volume',
    async run(_i, ctx) {
      const prev = ctx.session.previousVolume;
      if (prev === undefined) return { ok: false, message: "I don't have an earlier volume level to go back to." };
      const now = await ctx.bridge.call<VolumeState>('volume.get');
      const after = await ctx.bridge.call<VolumeState>('volume.set', { level: prev });
      ctx.session.previousVolume = now.level;
      return { ok: true, data: after, message: `Back to ${after.level} percent.` };
    },
  }),
  defineTool({
    name: 'media.control', title: 'Media playback', description: 'Control the active media session: toggle, play, pause, next, previous, stop.', category: 'Media', risk: 1, permission: 'media',
    input: z.object({ action: z.enum(['toggle', 'play', 'pause', 'next', 'previous', 'stop']) }).strict(), confirm: 'never', timeoutMs: 6000, offline: true,
    describe: ({ action }) => `Media: ${action}`,
    async run({ action }, ctx) {
      const r = await ctx.bridge.call<{ method: 'session' | 'key'; app: string | null; ok: boolean }>('media.control', { action });
      const verb = { toggle: 'Toggled playback', play: 'Playing', pause: 'Paused', next: 'Skipped to the next track', previous: 'Back to the previous track', stop: 'Stopped playback' }[action];
      if (r.method === 'key') return { ok: true, data: r, message: `I sent the ${action} media key. No app reported a media session, so I can't confirm it worked.` };
      return { ok: r.ok, data: r, message: r.ok ? `${verb}.` : `The media app didn't accept ${action}. It may not support that control.` };
    },
  }),
  defineTool({
    name: 'media.spotify_search', title: 'Spotify search', description: 'Open Spotify search results for a song, artist or playlist (uses the spotify: URI scheme; does not press play).', category: 'Media', risk: 1, permission: 'media',
    input: z.object({ query: z.string().trim().min(1).max(120) }).strict(), confirm: 'never', timeoutMs: 6000, offline: false,
    describe: ({ query }) => `Search Spotify for ${query}`,
    async run({ query }, ctx) {
      if (!ctx.repos.apps.list().some((a) => a.enabled && /spotify/i.test(a.name))) return { ok: false, message: "Spotify isn't in your approved apps, so I can't search it." };
      await ctx.platform.openExternal(`spotify:search:${encodeURIComponent(query)}`);
      return { ok: true, message: `I opened Spotify search for ${query}. You'll need to pick the result to start it; Spotify doesn't let me press play on a specific playlist.` };
    },
  }),
  defineTool({
    name: 'media.now_playing', title: "What's playing", description: 'Report the current media title and artist from the Windows media session.', category: 'Media', risk: 1, permission: 'media',
    input: none, confirm: 'never', timeoutMs: 6000, offline: true,
    describe: () => 'Read the current media session',
    async run(_i, ctx) {
      const r = await ctx.bridge.call<{ available: boolean; playing: boolean; status?: string; app?: string; title?: string; artist?: string }>('media.now');
      if (!r.available) return { ok: false, data: r, message: "This version of Windows doesn't expose media sessions to me." };
      if (!r.title) return { ok: true, data: r, message: "Nothing's playing that I can see." };
      return { ok: true, data: r, message: `${r.playing ? 'Playing' : 'Paused on'} ${r.title}${r.artist ? ` by ${r.artist}` : ''}.` };
    },
  }),
];
