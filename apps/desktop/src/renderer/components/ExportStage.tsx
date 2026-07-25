import { useEffect, useState } from "react";
import type { BuildResult } from "@xcross/core";
import type { InstallResult } from "../../shared/ipc.js";

interface ExportStageProps {
  buildResult: BuildResult;
  trackName: string;
  onTrackNameChange: (name: string) => void;
  onBack: () => void;
}

type AcRootState =
  | { status: "checking" }
  | { status: "found"; path: string }
  | { status: "not-found" };

export function ExportStage(props: ExportStageProps): JSX.Element {
  const { buildResult, trackName, onTrackNameChange, onBack } = props;

  const [acRoot, setAcRoot] = useState<AcRootState>({ status: "checking" });
  const [installing, setInstalling] = useState(false);
  const [installResult, setInstallResult] = useState<InstallResult | null>(null);
  const [savingZip, setSavingZip] = useState(false);
  const [savedZipPath, setSavedZipPath] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void window.xcross.detectAcRoot().then((path) => {
      if (cancelled) return;
      setAcRoot(path ? { status: "found", path } : { status: "not-found" });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChooseFolder(): Promise<void> {
    const chosen = await window.xcross.chooseAcRoot();
    if (chosen) setAcRoot({ status: "found", path: chosen });
  }

  async function handleInstall(): Promise<void> {
    if (acRoot.status !== "found") return;
    setInstalling(true);
    setInstallResult(null);
    try {
      const result = await window.xcross.installTrack({
        acRoot: acRoot.path,
        trackId: buildResult.meta.id,
        files: buildResult.files,
      });
      setInstallResult(result);
    } finally {
      setInstalling(false);
    }
  }

  async function handleSaveZip(): Promise<void> {
    setSavingZip(true);
    setSavedZipPath(undefined);
    try {
      const path = await window.xcross.saveZip(buildResult.zip, `${buildResult.meta.id}.zip`);
      setSavedZipPath(path);
    } finally {
      setSavingZip(false);
    }
  }

  return (
    <div className="stage export-stage">
      <div className="export-panel">
        <h1>Send it to Assetto Corsa</h1>

        <label className="text-field">
          <span>Track name</span>
          <input
            type="text"
            value={trackName}
            onChange={(e) => onTrackNameChange(e.target.value)}
            placeholder="My autocross course"
          />
        </label>

        <section className="export-option">
          <h2>Install to Assetto Corsa</h2>

          {acRoot.status === "checking" && <p className="hint">Looking for your Assetto Corsa folder…</p>}

          {acRoot.status === "found" && (
            <p className="hint">
              Found Assetto Corsa at <code>{acRoot.path}</code>
            </p>
          )}

          {acRoot.status === "not-found" && (
            <p className="hint">We couldn't find Assetto Corsa automatically. Point us to it below.</p>
          )}

          <button type="button" className="button button-plain" onClick={() => void handleChooseFolder()}>
            {acRoot.status === "found" ? "Use a different folder…" : "Choose Assetto Corsa folder…"}
          </button>

          <button
            type="button"
            className="button button-primary button-large"
            disabled={acRoot.status !== "found" || installing}
            onClick={() => void handleInstall()}
          >
            {installing ? "Installing…" : "Install to Assetto Corsa"}
          </button>

          {installResult?.ok && (
            <div className="notice-box notice-box-success">
              <p>
                Installed to <code>{installResult.installedTo}</code>.{" "}
                {installResult.replaced
                  ? "This replaced a track you'd already built with this same name."
                  : ""}
              </p>
              <p>Open Content Manager and look for "{trackName}" in your track list.</p>
            </div>
          )}

          {installResult && !installResult.ok && (
            <div className="notice-box notice-box-error">
              <p>{installResult.error ?? "Something went wrong installing the track."}</p>
            </div>
          )}
        </section>

        <section className="export-option">
          <h2>Or save the file yourself</h2>
          <p className="hint">Saves a single file you can drag onto Content Manager, or move to another computer.</p>
          <button type="button" className="button" disabled={savingZip} onClick={() => void handleSaveZip()}>
            {savingZip ? "Saving…" : "Save file instead"}
          </button>
          {savedZipPath === null && <p className="hint">Save cancelled.</p>}
          {savedZipPath && (
            <p className="hint">
              Saved to <code>{savedZipPath}</code>
            </p>
          )}
        </section>
      </div>

      <div className="stage-actions">
        <button type="button" className="button button-plain" onClick={onBack}>
          Back to preview
        </button>
      </div>
    </div>
  );
}
