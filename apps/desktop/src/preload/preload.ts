import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { IpcChannel, IpcPayload } from '../shared/ipc';

type EventChannel = 'assistant:event' | 'speech:event' | 'settings:changed' | 'ui:command';

const invoke = <C extends IpcChannel>(channel: C, payload?: IpcPayload<C>) => ipcRenderer.invoke(channel, payload);

function on(channel: EventChannel, cb: (data: unknown) => void) {
  const listener = (_e: IpcRendererEvent, data: unknown) => cb(data);
  ipcRenderer.on(channel, listener);
  return () => { ipcRenderer.removeListener(channel, listener); };
}

/**
 * The renderer's entire view of the system. No Node APIs, no raw ipcRenderer,
 * only named, schema-validated calls.
 */
const api = {
  invoke,
  on,
  sendAudio: (frame: ArrayBuffer) => ipcRenderer.send('speech:audio', frame),
  ttsState: (speaking: boolean) => ipcRenderer.send('tts:state', { speaking }),
};

contextBridge.exposeInMainWorld('clickyy', api);

export type ClickyyApi = typeof api;
