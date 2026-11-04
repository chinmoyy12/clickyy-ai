import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import { IpcInvoke, type IpcChannel } from '@shared/ipc';
import { redact } from './security/redact';

export type Handlers = { [C in IpcChannel]: (payload: unknown, e: IpcMainInvokeEvent) => unknown | Promise<unknown> };

/**
 * Registers every invoke channel. Each call is checked against the trusted
 * renderer, validated with the channel's zod schema, then dispatched. Errors
 * are redacted before crossing back into the renderer.
 */
export function registerIpc(handlers: Handlers, isTrusted: (wc: WebContents, frameUrl: string | undefined) => boolean, log: (m: string) => void) {
  for (const channel of Object.keys(IpcInvoke) as IpcChannel[]) {
    const schema = IpcInvoke[channel];
    ipcMain.handle(channel, async (e, payload) => {
      if (!isTrusted(e.sender, e.senderFrame?.url)) {
        log(`Rejected IPC ${channel} from untrusted sender ${e.senderFrame?.url}`);
        throw new Error('Unauthorized');
      }
      const parsed = schema.safeParse(payload);
      if (!parsed.success) throw new Error(`Invalid request for ${channel}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      try {
        return await handlers[channel](parsed.data, e);
      } catch (err) {
        const msg = redact((err as Error)?.message ?? String(err));
        log(`IPC ${channel} failed: ${msg}`);
        throw new Error(msg);
      }
    });
  }
}
