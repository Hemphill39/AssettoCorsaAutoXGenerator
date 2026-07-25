import type { Run } from "@xcross/core";

/** How a dropped/opened file turned out once we tried to read it. */
export type FileStatus = "ok" | "warn" | "error";

/** A GPS log the user has added in stage 1, plus what we learned parsing it. */
export interface LoadedFile {
  id: string;
  name: string;
  text: string;
  status: FileStatus;
  /** Plain-language explanation, set when status is "warn" or "error". */
  message?: string;
  runs: Run[];
}

export type Stage = "add-runs" | "preview" | "export";

/**
 * Mirrors core's `GuidanceLevel` structurally (not imported — geometry/guidance.ts
 * isn't re-exported from the package index). Kept in sync by hand; the union is
 * small and stable.
 */
export type GuidanceLevel = "realistic" | "guided" | "training";
