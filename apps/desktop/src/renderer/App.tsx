import { useEffect, useMemo, useRef, useState } from "react";
import { buildTrack } from "@xcross/core";
import type { BuildResult, Cone } from "@xcross/core";
import { AddRunsStage } from "./components/AddRunsStage.js";
import { PreviewStage } from "./components/PreviewStage.js";
import { ExportStage } from "./components/ExportStage.js";
import { analyzeFile } from "./fileAnalysis.js";
import type { GuidanceLevel, LoadedFile, Stage } from "./types.js";

const DEFAULT_COURSE_WIDTH_M = 9;
const DEFAULT_LOT_MARGIN_M = 25;
const DEFAULT_GUIDANCE_LEVEL: GuidanceLevel = "guided";
const REBUILD_DEBOUNCE_MS = 250;

const DISCARD_EDITS_MESSAGE =
  "Changing the course width, lot size, or guidance level will re-infer cone positions " +
  "and discard your edits — continue?";

/** Everything a successful build was actually built with, for change detection. */
interface BuiltWith {
  courseWidth: number;
  lotMargin: number;
  guidanceLevel: GuidanceLevel;
  trackName: string;
  /** The exact cone array reference the build used (auto-inferred or hand-edited). */
  cones: Cone[];
  conesEdited: boolean;
}

export function App(): JSX.Element {
  const [stage, setStage] = useState<Stage>("add-runs");
  const [files, setFiles] = useState<LoadedFile[]>([]);

  const [courseWidthM, setCourseWidthM] = useState(DEFAULT_COURSE_WIDTH_M);
  const [lotMarginM, setLotMarginM] = useState(DEFAULT_LOT_MARGIN_M);
  const [guidanceLevel, setGuidanceLevel] = useState<GuidanceLevel>(DEFAULT_GUIDANCE_LEVEL);
  const [trackName, setTrackName] = useState("");

  const [buildResult, setBuildResult] = useState<BuildResult | null>(null);
  const [cones, setCones] = useState<Cone[]>([]);
  // True once the user has moved, added, or deleted a cone by hand since the
  // last automatic layout. This is the one source of truth for "will the
  // exported track contain my edits" — it drives both the sidebar label and
  // whether rebuilds pass conesOverride.
  const [conesEdited, setConesEdited] = useState(false);
  const [building, setBuilding] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const lastBuiltRef = useRef<BuiltWith | null>(null);

  const sources = useMemo(
    () => files.filter((f) => f.status !== "error").map((f) => ({ name: f.name, text: f.text })),
    [files],
  );
  const usableRunCount = useMemo(() => files.reduce((sum, f) => sum + f.runs.length, 0), [files]);

  function addFiles(picked: { name: string; text: string }[]): void {
    const analyzed = picked.map(analyzeFile);
    setFiles((prev) => {
      const byName = new Map(prev.map((f) => [f.name, f]));
      for (const file of analyzed) byName.set(file.name, file);
      return Array.from(byName.values());
    });
  }

  function removeFile(id: string): void {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }

  /** Runs the pipeline and commits the result. Returns null (and sets buildError) on failure. */
  function buildAndCommit(params: {
    courseWidth: number;
    lotMargin: number;
    guidanceLevel: GuidanceLevel;
    trackName: string;
    conesOverride?: Cone[];
  }): BuildResult | null {
    try {
      const result = buildTrack(sources, {
        courseWidth: params.courseWidth,
        lotMargin: params.lotMargin,
        guidance: { level: params.guidanceLevel },
        trackName: params.trackName.trim() || undefined,
        conesOverride: params.conesOverride,
      });
      setBuildResult(result);
      setCones(result.cones);
      setBuildError(null);
      lastBuiltRef.current = {
        courseWidth: params.courseWidth,
        lotMargin: params.lotMargin,
        guidanceLevel: params.guidanceLevel,
        trackName: params.trackName,
        cones: result.cones,
        conesEdited: Boolean(params.conesOverride),
      };
      return result;
    } catch (error) {
      setBuildError(error instanceof Error ? error.message : "Something went wrong building the course.");
      return null;
    }
  }

  function handleBuild(): void {
    if (sources.length === 0) return;
    setBuilding(true);
    const result = buildAndCommit({
      courseWidth: courseWidthM,
      lotMargin: lotMarginM,
      guidanceLevel,
      trackName: "", // let the pipeline derive a name from the source file the first time
    });
    if (result) {
      setTrackName(result.meta.name);
      // Patch the just-committed record so the name matches the state we just
      // set — otherwise the debounce effect below sees a spurious "trackName
      // changed" a moment later and fires a redundant rebuild.
      lastBuiltRef.current = { ...lastBuiltRef.current!, trackName: result.meta.name };
      setConesEdited(false);
      setStage("preview");
    }
    setBuilding(false);
  }

  // Debounced rebuild whenever course width, lot margin, guidance level, the
  // track name, or the cone list changes after the first build.
  //
  // Course width / lot margin / guidance are "structural": they change the
  // automatically-inferred cone layout, so applying them re-infers and would
  // silently throw away hand-edited cones. We confirm before that happens.
  // A plain cone edit (drag/add/delete) is instead carried forward as
  // conesOverride so the export always matches what's on screen.
  useEffect(() => {
    if (!buildResult) return;
    const last = lastBuiltRef.current;
    if (!last) return;

    const structuralChanged =
      courseWidthM !== last.courseWidth ||
      lotMarginM !== last.lotMargin ||
      guidanceLevel !== last.guidanceLevel;
    const trackNameChanged = trackName !== last.trackName;
    const conesSignalChanged = conesEdited !== last.conesEdited || (conesEdited && cones !== last.cones);

    if (!structuralChanged && !trackNameChanged && !conesSignalChanged) return;

    const timer = window.setTimeout(() => {
      let effectiveEdited = conesEdited;
      if (structuralChanged && conesEdited) {
        const proceed = window.confirm(DISCARD_EDITS_MESSAGE);
        if (!proceed) {
          // Revert the control to the last committed value; leave edits intact.
          setCourseWidthM(last.courseWidth);
          setLotMarginM(last.lotMargin);
          setGuidanceLevel(last.guidanceLevel);
          return;
        }
        effectiveEdited = false;
      }

      const result = buildAndCommit({
        courseWidth: courseWidthM,
        lotMargin: lotMarginM,
        guidanceLevel,
        trackName,
        conesOverride: effectiveEdited ? cones : undefined,
      });
      if (result) setConesEdited(effectiveEdited);
    }, REBUILD_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseWidthM, lotMarginM, guidanceLevel, trackName, cones, conesEdited, buildResult, sources]);

  /** Called for every hand cone edit: move, add, or delete. */
  function updateCones(next: Cone[]): void {
    setCones(next);
    setConesEdited(true);
  }

  /** Discards hand edits and re-infers immediately — no need to wait on the debounce. */
  function resetCones(): void {
    if (!buildResult) return;
    const result = buildAndCommit({ courseWidth: courseWidthM, lotMargin: lotMarginM, guidanceLevel, trackName });
    if (result) setConesEdited(false);
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">Autocross Track Builder</span>
        <nav className="stage-steps">
          <span className={stage === "add-runs" ? "stage-step stage-step-active" : "stage-step"}>1. Add runs</span>
          <span className={stage === "preview" ? "stage-step stage-step-active" : "stage-step"}>2. Preview</span>
          <span className={stage === "export" ? "stage-step stage-step-active" : "stage-step"}>3. Export</span>
        </nav>
      </header>

      <main className="app-main">
        {stage === "add-runs" && (
          <AddRunsStage
            files={files}
            onFilesAdded={addFiles}
            onRemoveFile={removeFile}
            onBuild={handleBuild}
            building={building}
            buildError={buildError}
            canBuild={usableRunCount > 0}
          />
        )}

        {stage === "preview" && buildResult && (
          <PreviewStage
            buildResult={buildResult}
            cones={cones}
            conesEdited={conesEdited}
            onConesChange={updateCones}
            courseWidthM={courseWidthM}
            lotMarginM={lotMarginM}
            guidanceLevel={guidanceLevel}
            onCourseWidthChange={setCourseWidthM}
            onLotMarginChange={setLotMarginM}
            onGuidanceLevelChange={setGuidanceLevel}
            onResetCones={resetCones}
            onContinue={() => setStage("export")}
            onBack={() => setStage("add-runs")}
          />
        )}

        {stage === "export" && buildResult && (
          <ExportStage
            buildResult={buildResult}
            trackName={trackName}
            onTrackNameChange={setTrackName}
            onBack={() => setStage("preview")}
          />
        )}
      </main>
    </div>
  );
}
