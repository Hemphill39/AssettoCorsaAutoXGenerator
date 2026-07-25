/**
 * IPC contract between the Electron main process and the renderer.
 *
 * The renderer has no Node access (contextIsolation on, nodeIntegration off), so
 * every filesystem touch goes through these channels. Keeping the surface this
 * narrow is the point: the renderer can read CSVs the user picked and write a
 * track the user asked for, and nothing else.
 */

export interface PickedFile {
  name: string;
  text: string;
}

export interface InstallRequest {
  /** Assetto Corsa root, i.e. the folder containing `content/`. */
  acRoot: string;
  trackId: string;
  files: { path: string; data: Uint8Array }[];
}

export interface InstallResult {
  ok: boolean;
  /** Absolute folder written to, when successful. */
  installedTo?: string;
  error?: string;
  /** True when an existing track of the same id was replaced. */
  replaced?: boolean;
}

export interface XcrossApi {
  /** Best-effort auto-detection of the Assetto Corsa install. */
  detectAcRoot(): Promise<string | null>;
  /** Prompts the user to locate the Assetto Corsa folder manually. */
  chooseAcRoot(): Promise<string | null>;
  /** Validates that a folder really is an AC install. */
  validateAcRoot(path: string): Promise<boolean>;
  /** Opens a file picker for GPS logs and returns their contents. */
  openCsvFiles(): Promise<PickedFile[]>;
  /** Writes a generated track straight into content/tracks/. */
  installTrack(request: InstallRequest): Promise<InstallResult>;
  /** Saves the track as a zip wherever the user chooses. */
  saveZip(data: Uint8Array, suggestedName: string): Promise<string | null>;
  platform: NodeJS.Platform;
}

export const IPC = {
  detectAcRoot: "ac:detectRoot",
  chooseAcRoot: "ac:chooseRoot",
  validateAcRoot: "ac:validateRoot",
  openCsvFiles: "files:openCsv",
  installTrack: "track:install",
  saveZip: "track:saveZip",
} as const;
