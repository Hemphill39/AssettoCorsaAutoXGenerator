import { CsvParseError, parseGpsCsv, splitRuns } from "@xcross/core";
import type { PickedFile } from "../shared/ipc.js";
import type { LoadedFile } from "./types.js";

let counter = 0;
function nextId(): string {
  counter += 1;
  return `file-${Date.now()}-${counter}`;
}

/**
 * Reads a GPS log the moment it's added, so stage 1 can show what's inside it
 * (and explain what's wrong with it) before the user commits to a build.
 */
export function analyzeFile(picked: PickedFile): LoadedFile {
  const id = nextId();
  const base = { id, name: picked.name, text: picked.text };

  try {
    const parsed = parseGpsCsv(picked.text);
    const runs = splitRuns(parsed.samples, picked.name);
    if (runs.length === 0) {
      return {
        ...base,
        status: "warn",
        message: "No complete run found — the car may never have gotten moving in this file.",
        runs: [],
      };
    }
    return { ...base, status: "ok", runs };
  } catch (error) {
    const message =
      error instanceof CsvParseError || error instanceof Error
        ? error.message
        : "Could not read this file.";
    return { ...base, status: "error", message, runs: [] };
  }
}
