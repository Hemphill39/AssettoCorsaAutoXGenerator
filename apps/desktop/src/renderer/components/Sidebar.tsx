import type { BuildResult } from "@xcross/core";
import { feetToMeters, formatDurationMs, formatFeet, metersToFeet } from "../format.js";
import type { GuidanceLevel } from "../types.js";
import { WarningsBox } from "./WarningsBox.js";

interface SidebarProps {
  buildResult: BuildResult;
  coneCount: number;
  conesEdited: boolean;
  courseWidthM: number;
  lotMarginM: number;
  guidanceLevel: GuidanceLevel;
  onCourseWidthChange: (meters: number) => void;
  onLotMarginChange: (meters: number) => void;
  onGuidanceLevelChange: (level: GuidanceLevel) => void;
  onAddCone: () => void;
  onResetCones: () => void;
  onContinue: () => void;
  onBack: () => void;
  hasSelection: boolean;
  onDeleteSelected: () => void;
}

const LEGEND: { type: string; label: string; color: string }[] = [
  { type: "start", label: "Start", color: "#35c46a" },
  { type: "finish", label: "Finish", color: "#f2f2f2" },
  { type: "gate", label: "Gate", color: "#e8792a" },
  { type: "slalom", label: "Weave cone", color: "#f1c40f" },
];

const GUIDANCE_OPTIONS: { value: GuidanceLevel; label: string }[] = [
  { value: "realistic", label: "Realistic — cones only, like a real event" },
  { value: "guided", label: "Guided (recommended) — painted edge lines to follow" },
  { value: "training", label: "Training — edge lines plus direction arrows, more cones" },
];

export function Sidebar(props: SidebarProps): JSX.Element {
  const {
    buildResult,
    coneCount,
    conesEdited,
    courseWidthM,
    lotMarginM,
    guidanceLevel,
    onCourseWidthChange,
    onLotMarginChange,
    onGuidanceLevelChange,
    onAddCone,
    onResetCones,
    onContinue,
    onBack,
    hasSelection,
    onDeleteSelected,
  } = props;

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <h1>Your course</h1>

        <div className="stat-row">
          <div className="stat">
            <div className="stat-value">{formatFeet(buildResult.meta.lengthMetres)}</div>
            <div className="stat-label">Course length</div>
          </div>
          <div className="stat">
            <div className="stat-value">{formatDurationMs(buildResult.meta.targetTimeMs)}</div>
            <div className="stat-label">Your time to beat</div>
          </div>
          <div className="stat">
            <div className="stat-value">{coneCount}</div>
            <div className="stat-label">{conesEdited ? "Cones — edited" : "Cones — automatic"}</div>
          </div>
        </div>

        <WarningsBox warnings={buildResult.warnings} />

        <section className="control-group">
          <h2>Adjust the course</h2>
          <label className="slider-field">
            <div className="slider-field-head">
              <span>Course width</span>
              <span>{Math.round(metersToFeet(courseWidthM))} ft</span>
            </div>
            <input
              type="range"
              min={15}
              max={40}
              step={1}
              value={Math.round(metersToFeet(courseWidthM))}
              onChange={(e) => onCourseWidthChange(feetToMeters(Number(e.target.value)))}
            />
          </label>
          <label className="slider-field">
            <div className="slider-field-head">
              <span>Space around the course</span>
              <span>{Math.round(metersToFeet(lotMarginM))} ft</span>
            </div>
            <input
              type="range"
              min={30}
              max={300}
              step={10}
              value={Math.round(metersToFeet(lotMarginM))}
              onChange={(e) => onLotMarginChange(feetToMeters(Number(e.target.value)))}
            />
          </label>
          <label className="select-field">
            <span>How much help finding your way</span>
            <select
              value={guidanceLevel}
              onChange={(e) => onGuidanceLevelChange(e.target.value as GuidanceLevel)}
            >
              {GUIDANCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          {guidanceLevel !== "realistic" && (
            <p className="hint">
              The faint white lines beside the course are a preview of the paint — they'll be on
              the asphalt when you drive it.
            </p>
          )}
          {conesEdited && (
            <p className="hint hint-warn">
              Changing these will re-infer cone positions and ask before discarding your edits.
            </p>
          )}
        </section>

        <section className="control-group">
          <h2>
            Cones — {conesEdited ? `${coneCount} (edited)` : "automatic"}
          </h2>
          <p className="hint">
            Click a cone to select it, then drag it where it belongs. Press Delete to remove the
            selected cone. Your edits are what gets exported to the game.
          </p>
          <ul className="legend">
            {LEGEND.map((item) => (
              <li key={item.type}>
                <span className="legend-swatch" style={{ background: item.color }} />
                {item.label}
              </li>
            ))}
          </ul>
          <div className="button-row">
            <button type="button" className="button" onClick={onAddCone}>
              Add a cone
            </button>
            <button type="button" className="button" disabled={!hasSelection} onClick={onDeleteSelected}>
              Delete selected
            </button>
          </div>
          <button type="button" className="button button-plain" disabled={!conesEdited} onClick={onResetCones}>
            Undo my cone edits
          </button>
        </section>
      </div>

      <div className="sidebar-actions">
        <button type="button" className="button button-plain" onClick={onBack}>
          Back
        </button>
        <button type="button" className="button button-primary button-large" onClick={onContinue}>
          Continue to export
        </button>
      </div>
    </aside>
  );
}
