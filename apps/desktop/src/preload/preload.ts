import { contextBridge, ipcRenderer } from "electron";
import { IPC, type InstallRequest, type PickedFile } from "../shared/ipc.js";

/**
 * The only bridge between the renderer and Node.
 *
 * Each method forwards to a named channel and nothing more — no filesystem
 * access, no arbitrary IPC, no `require` reaching the page.
 */
contextBridge.exposeInMainWorld("xcross", {
  detectAcRoot: (): Promise<string | null> => ipcRenderer.invoke(IPC.detectAcRoot),
  chooseAcRoot: (): Promise<string | null> => ipcRenderer.invoke(IPC.chooseAcRoot),
  validateAcRoot: (path: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.validateAcRoot, path),
  openCsvFiles: (): Promise<PickedFile[]> => ipcRenderer.invoke(IPC.openCsvFiles),
  installTrack: (request: InstallRequest) => ipcRenderer.invoke(IPC.installTrack, request),
  saveZip: (data: Uint8Array, suggestedName: string): Promise<string | null> =>
    ipcRenderer.invoke(IPC.saveZip, data, suggestedName),
  platform: process.platform,
});
