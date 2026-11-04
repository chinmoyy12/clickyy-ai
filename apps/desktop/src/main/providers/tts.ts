import { ProviderError } from './types';

/**
 * Optional cloud TTS through an OpenAI-compatible /audio/speech endpoint.
 * Returns MP3 bytes. Only used when the user selects the cloud voice engine.
 */
export async function cloudSpeech(opts: { baseUrl: string; apiKey: string; voice: string; text: string; fetch: typeof fetch; signal?: AbortSignal }): Promise<Buffer> {
  if (!/^https:\/\//.test(opts.baseUrl)) throw new ProviderError('Cloud voice needs an https base URL in Settings.', 'bad_response');
  const r = await opts.fetch(`${opts.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: 'tts-1', voice: opts.voice, input: opts.text.slice(0, 4000), response_format: 'mp3' }),
    signal: opts.signal ?? AbortSignal.timeout(20000),
  });
  if (r.status === 401 || r.status === 403) throw new ProviderError('The cloud voice API key was rejected.', 'auth');
  if (!r.ok) throw new ProviderError(`Cloud voice error (HTTP ${r.status}).`, 'bad_response');
  return Buffer.from(await r.arrayBuffer());
}
