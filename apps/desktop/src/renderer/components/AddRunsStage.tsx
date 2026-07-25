import { useState } from "react";
import type { DragEvent } from "react";
import { formatDuration, formatFeet, formatMph } from "../format.js";
import type { LoadedFile } from "../types.js";

interface AddRunsStageProps {
  files: LoadedFile[];
  onFilesAdded: (files: { name: string; text: string }[]) => void;
  onRemoveFile: (id: string) => void;
  onBuild: () => void;
  building: boolean;
  buildError: string | null;
  canBuild: boolean;
}

/** Reads File objects dropped onto the window; no IPC needed for drag-and-drop. */
async function readDroppedFiles(fileList: FileList): Promise<{ name: string; text: string }[]> {
  const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".csv"));
  return Promise.all(
    files.map(
      (file) =>
        new Promise<{ name: string; text: string }>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? "") });
          reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
          reader.readAsText(file);
        }),
    ),
  );
}

function fileSummary(file: LoadedFile): string {
  if (file.status === "error") return file.message ?? "Could not read this file.";
  if (file.status === "warn") return file.message ?? "No usable run found.";

  const totalDuration = file.runs.reduce((sum, r) => sum + r.duration, 0);
  const totalDistance = file.runs.reduce((sum, r) => sum + r.distance, 0);
  const topSpeed = Math.max(...file.runs.map((r) => r.maxSpeed));
  const runWord = file.runs.length === 1 ? "run" : "runs";
  return (
    `${file.runs.length} ${runWord} found — ${formatDuration(totalDuration)}, ` +
    `${formatFeet(totalDistance)}, top speed ${formatMph(topSpeed)}`
  );
}

export function AddRunsStage(props: AddRunsStageProps): JSX.Element {
  const { files, onFilesAdded, onRemoveFile, onBuild, building, buildError, canBuild } = props;
  const [dragActive, setDragActive] = useState(false);

  async function handleDrop(e: DragEvent<HTMLDivElement>): Promise<void> {
    e.preventDefault();
    setDragActive(false);
    if (!e.dataTransfer.files.length) return;
    const read = await readDroppedFiles(e.dataTransfer.files);
    if (read.length > 0) onFilesAdded(read);
  }

  async function handleChooseFiles(): Promise<void> {
    const picked = await window.xcross.openCsvFiles();
    if (picked.length > 0) onFilesAdded(picked);
  }

  return (
    <div className="stage add-runs-stage">
      <h1>Bring in your runs</h1>
      <p className="lede">
        Add the GPS files from your autocross runs. If you have more than one run of the same
        course, add them all — the more runs of the same course you give it, the better the
        course turns out.
      </p>

      <div
        className={`drop-zone${dragActive ? " drop-zone-active" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => void handleDrop(e)}
      >
        <p className="drop-zone-title">Drag your run files here</p>
        <p className="drop-zone-sub">or</p>
        <button type="button" className="button button-primary" onClick={() => void handleChooseFiles()}>
          Choose files…
        </button>
      </div>

      {files.length > 0 && (
        <ul className="file-list">
          {files.map((file) => (
            <li key={file.id} className={`file-row file-row-${file.status}`}>
              <div className="file-row-main">
                <span className="file-row-name">{file.name}</span>
                <span className="file-row-summary">{fileSummary(file)}</span>
              </div>
              <button
                type="button"
                className="button button-plain"
                onClick={() => onRemoveFile(file.id)}
                aria-label={`Remove ${file.name}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {buildError && (
        <div className="notice-box notice-box-error">
          <div className="notice-box-title">Could not build the course</div>
          <p>{buildError}</p>
        </div>
      )}

      <div className="stage-actions">
        <button
          type="button"
          className="button button-primary button-large"
          disabled={!canBuild || building}
          onClick={onBuild}
        >
          {building ? "Building course…" : "Build course"}
        </button>
        {!canBuild && files.length > 0 && (
          <p className="hint">None of these files have a usable run yet — add another, or remove the ones that failed.</p>
        )}
      </div>
    </div>
  );
}
