import type { XcrossApi } from "../shared/ipc.js";

/**
 * The renderer has no Node access; everything reaches the filesystem through
 * this bridge, exposed by src/preload/preload.ts via contextBridge.
 */
declare global {
  interface Window {
    xcross: XcrossApi;
  }
}

export {};
