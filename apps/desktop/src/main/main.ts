import { BrowserWindow, app, dialog, ipcMain, shell } from "electron";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, basename, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { IPC, type InstallRequest, type InstallResult, type PickedFile } from "../shared/ipc.js";
import { detectAcRoot, existingTrackIds, isAcRoot } from "./acPaths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEV_SERVER = process.env["VITE_DEV_SERVER_URL"];

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    backgroundColor: "#14161a",
    title: "Autocross Track Builder",
    webPreferences: {
      preload: join(__dirname, "../preload/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Never let the renderer navigate away or spawn windows; it is a local tool,
  // not a browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  if (DEV_SERVER) {
    void window.loadURL(DEV_SERVER);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return window;
}

/** Guards against a malicious or buggy renderer escaping the track folder. */
function assertInsideTracks(acRoot: string, target: string): void {
  const tracks = resolve(join(acRoot, "content", "tracks"));
  const resolved = resolve(target);
  if (resolved !== tracks && !resolved.startsWith(tracks + sep)) {
    throw new Error(`Refusing to write outside content/tracks: ${resolved}`);
  }
}

function registerHandlers(): void {
  ipcMain.handle(IPC.detectAcRoot, async () => detectAcRoot());

  ipcMain.handle(IPC.validateAcRoot, async (_event, path: string) => isAcRoot(path));

  ipcMain.handle(IPC.chooseAcRoot, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select your Assetto Corsa folder",
      properties: ["openDirectory"],
      message: "Pick the folder containing 'content' — usually steamapps/common/assettocorsa",
    });
    const chosen = result.filePaths[0];
    if (!chosen) return null;
    return isAcRoot(chosen) ? chosen : null;
  });

  ipcMain.handle(IPC.openCsvFiles, async (): Promise<PickedFile[]> => {
    const result = await dialog.showOpenDialog({
      title: "Select GPS run logs",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "GPS logs", extensions: ["csv"] },
        { name: "All files", extensions: ["*"] },
      ],
    });
    return result.filePaths.map((path) => ({
      name: basename(path),
      text: readFileSync(path, "utf8"),
    }));
  });

  ipcMain.handle(IPC.installTrack, async (_event, request: InstallRequest): Promise<InstallResult> => {
    try {
      if (!isAcRoot(request.acRoot)) {
        return { ok: false, error: "That folder does not look like an Assetto Corsa install." };
      }
      if (!/^[a-z0-9_-]+$/i.test(request.trackId)) {
        return { ok: false, error: `Unsafe track id: ${request.trackId}` };
      }

      const trackDir = join(request.acRoot, "content", "tracks", request.trackId);
      assertInsideTracks(request.acRoot, trackDir);
      const replaced = existingTrackIds(request.acRoot).includes(request.trackId);

      for (const file of request.files) {
        const target = join(trackDir, file.path);
        assertInsideTracks(request.acRoot, target);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, Buffer.from(file.data));
      }

      return { ok: true, installedTo: trackDir, replaced };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(IPC.saveZip, async (_event, data: Uint8Array, suggestedName: string) => {
    const result = await dialog.showSaveDialog({
      title: "Save track package",
      defaultPath: suggestedName,
      filters: [{ name: "Zip archive", extensions: ["zip"] }],
    });
    if (!result.filePath) return null;
    writeFileSync(result.filePath, Buffer.from(data));
    return result.filePath;
  });
}

void app.whenReady().then(() => {
  registerHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

