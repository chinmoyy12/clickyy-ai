import { z } from 'zod';
import { basename, extname } from 'node:path';
import { defineTool, type ToolDef } from './types';
import { outputDir, userFolder, writeNew } from './output';
import { scanFiles } from './filesplus';
import { spokenDuration } from './productivity';

const EMAIL_RE = /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i;
const PHONE_RE = /^\+?[0-9]{8,15}$/;

let stopAfterTimer: NodeJS.Timeout | null = null;

export const commsTools: ToolDef[] = [
  defineTool({
    name: 'message.email', title: 'Draft an email', description: 'Open a new email draft in your mail app with the subject and text filled in. You review it and press Send yourself.', category: 'Communication', risk: 1, permission: 'web',
    input: z.object({ to: z.string().trim().max(200).default(''), subject: z.string().trim().max(200).default(''), body: z.string().max(4000).default('') }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ to, subject }) => `Draft an email${to ? ` to ${to}` : ''}${subject ? ` about ${subject}` : ''}`,
    async run({ to, subject, body }, ctx) {
      const addr = to.split(/[;,]/).map((s) => s.trim()).filter((s) => EMAIL_RE.test(s));
      const url = `mailto:${addr.map(encodeURIComponent).join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
      await ctx.platform.openExternal(url);
      const who = addr.length ? addr.join(', ') : to;
      return { ok: true, data: { to: addr }, message: `I opened an email draft${who ? ` for ${who}` : ''}${subject ? ` about ${subject}` : ''}.${!addr.length && to ? " Add their email address, since I don't know it." : ''} Check it, then press Send.`, detail: `Subject: ${subject}\n\n${body}` };
    },
  }),
  defineTool({
    name: 'message.whatsapp', title: 'WhatsApp message', description: 'Open WhatsApp (the app if installed, otherwise WhatsApp Web) with a message ready. You choose the contact if no phone number is given, and press Send yourself.', category: 'Communication', risk: 1, permission: 'web',
    input: z.object({ text: z.string().trim().min(1).max(2000), phone: z.string().trim().max(20).optional(), name: z.string().trim().max(60).optional() }).strict(), confirm: 'never', timeoutMs: 8000, offline: false,
    describe: ({ name, text }) => `Prepare a WhatsApp message${name ? ` to ${name}` : ''}: ${text}`,
    async run({ text, phone, name }, ctx) {
      const num = phone && PHONE_RE.test(phone.replace(/[\s-]/g, '')) ? phone.replace(/[\s+-]/g, '') : '';
      const app = ctx.repos.apps.list().find((a) => a.enabled && /whatsapp/i.test(a.name));
      const q = `${num ? `phone=${num}&` : ''}text=${encodeURIComponent(text)}`;
      if (app) await ctx.platform.openExternal(`whatsapp://send?${q}`);
      else await ctx.platform.openExternal(`https://web.whatsapp.com/send?${q}`);
      const pick = num ? '' : name ? ` Pick ${name} in the chat list;` : ' Pick the contact;';
      return { ok: true, message: `I opened ${app ? 'WhatsApp' : 'WhatsApp Web'} with your message ready.${pick} then press Send. I never send messages for you.`, detail: text };
    },
  }),
  defineTool({
    name: 'music.play', title: 'Play music', description: 'Find a song, artist, album, radio station or version on Spotify (if installed) or YouTube Music.', category: 'Media', risk: 1, permission: 'media',
    input: z.object({ query: z.string().trim().min(1).max(160), service: z.enum(['auto', 'spotify', 'youtube_music']).default('auto'), hint: z.string().max(200).optional() }).strict(), confirm: 'never', timeoutMs: 8000, offline: false,
    describe: ({ query, service }) => `Find ${query} on ${service === 'youtube_music' ? 'YouTube Music' : service === 'spotify' ? 'Spotify' : 'your music app'}`,
    async run({ query, service, hint }, ctx) {
      const spotify = ctx.repos.apps.list().some((a) => a.enabled && /spotify/i.test(a.name));
      if (service === 'spotify' || (service === 'auto' && spotify)) {
        if (!spotify) return { ok: false, message: "Spotify isn't installed or isn't in your approved apps. Say \"on YouTube Music\" to use that instead." };
        await ctx.platform.openExternal(`spotify:search:${encodeURIComponent(query)}`);
        return { ok: true, message: `I opened ${query} in Spotify. ${hint ?? "Press play on the top result; Spotify doesn't let other apps start a specific song."}` };
      }
      await ctx.platform.openExternal(`https://music.youtube.com/search?q=${encodeURIComponent(query)}`);
      return { ok: true, message: `I opened ${query} on YouTube Music. ${hint ?? 'Pick the top result to play it.'}` };
    },
  }),
  defineTool({
    name: 'media.play_local', title: 'Play my music files', description: 'Make a playlist of the music files in your Music folder (optionally only those whose file or folder name mentions an artist or words), shuffled if asked, and play it in your default music player.', category: 'Media', risk: 1, permission: 'media',
    input: z.object({ query: z.string().trim().max(100).default(''), shuffle: z.boolean().default(true) }).strict(), confirm: 'never', timeoutMs: 30000, offline: true,
    describe: ({ query, shuffle }) => `${shuffle ? 'Shuffle' : 'Play'} ${query ? `${query} songs` : 'your music'} from the Music folder`,
    async run({ query, shuffle }, ctx) {
      const { files } = await scanFiles(userFolder('music'), 'audio', true);
      const words = query.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1);
      let list = words.length ? files.filter((f) => { const p = f.path.toLowerCase().replace(/[^a-z0-9]+/g, ' '); return words.every((w) => p.includes(w)); }) : files;
      if (!list.length) return { ok: false, message: words.length ? `I didn't find any songs by ${query} in your Music folder. I match on file and folder names.` : 'Your Music folder has no music files.' };
      list = shuffle ? [...list].sort(() => Math.random() - 0.5) : [...list].sort((a, b) => a.path.localeCompare(b.path));
      list = list.slice(0, 500);
      const m3u = `#EXTM3U\n${list.map((f) => `#EXTINF:-1,${basename(f.path, extname(f.path))}\n${f.path}`).join('\n')}\n`;
      const path = await writeNew(outputDir('Playlists'), `${query || 'My music'}${shuffle ? ' shuffle' : ''}`, '.m3u8', m3u);
      const err = await ctx.platform.openPath(path);
      if (err) return { ok: false, message: `I made the playlist but Windows couldn't open it: ${err}` };
      return { ok: true, data: { path, songs: list.length }, message: `Playing ${list.length} song${list.length === 1 ? '' : 's'}${query ? ` by ${query}` : ''}${shuffle ? ' on shuffle' : ''}.`, detail: path };
    },
  }),
  defineTool({
    name: 'media.stop_after', title: 'Pause after this song', description: 'Pause playback when the current track finishes (needs a player that shares its progress with Windows, like Spotify or a browser).', category: 'Media', risk: 1, permission: 'media',
    input: z.object({ cancel: z.boolean().default(false) }).strict(), confirm: 'never', timeoutMs: 8000, offline: true,
    describe: ({ cancel }) => (cancel ? 'Cancel pause-after-this-song' : 'Pause after the current song'),
    async run({ cancel }, ctx) {
      if (stopAfterTimer) { clearTimeout(stopAfterTimer); stopAfterTimer = null; if (cancel) return { ok: true, message: "Okay, I won't pause after this song." }; }
      if (cancel) return { ok: true, message: "There wasn't a pause scheduled." };
      const t = await ctx.bridge.call<{ available: boolean; positionSec?: number; endSec?: number; status?: string }>('media.timeline');
      if (!t.available || !t.endSec) return { ok: false, message: "Nothing is playing that tells Windows how long the song is, so I can't time it. Say \"pause in 4 minutes\" instead." };
      const left = Math.max(1, t.endSec - (t.positionSec ?? 0) - 1);
      stopAfterTimer = setTimeout(() => { stopAfterTimer = null; void ctx.bridge.call('media.control', { action: 'pause' }).catch(() => undefined); }, left * 1000);
      return { ok: true, message: `I'll pause when this song ends, in about ${spokenDuration(Math.round(left))}.` };
    },
  }),
  defineTool({
    name: 'media.pause_in', title: 'Pause music after a delay', description: 'Pause playback after a number of minutes (a sleep timer for music).', category: 'Media', risk: 1, permission: 'media',
    input: z.object({ minutes: z.number().min(0.5).max(600) }).strict(), confirm: 'never', timeoutMs: 3000, offline: true,
    describe: ({ minutes }) => `Pause the music in ${minutes} minutes`,
    async run({ minutes }, ctx) {
      if (stopAfterTimer) clearTimeout(stopAfterTimer);
      stopAfterTimer = setTimeout(() => { stopAfterTimer = null; void ctx.bridge.call('media.control', { action: 'pause' }).catch(() => undefined); }, minutes * 60000);
      return { ok: true, message: `I'll pause the music in ${spokenDuration(Math.round(minutes * 60))}.` };
    },
  }),
];
