import { useEffect, useRef, useState } from "react";
import type { BuildResult, Cone } from "@xcross/core";
import type { GuidanceLevel } from "../types.js";
import { SceneView } from "./SceneView.js";
import type { SceneViewHandle } from "./SceneView.js";
import { Sidebar } from "./Sidebar.js";

interface PreviewStageProps {
  buildResult: BuildResult;
  cones: Cone[];
  conesEdited: boolean;
  onConesChange: (cones: Cone[]) => void;
  courseWidthM: number;
  lotMarginM: number;
  guidanceLevel: GuidanceLevel;
  onCourseWidthChange: (meters: number) => void;
  onLotMarginChange: (meters: number) => void;
  onGuidanceLevelChange: (level: GuidanceLevel) => void;
  onResetCones: () => void;
  onContinue: () => void;
  onBack: () => void;
}

export function PreviewStage(props: PreviewStageProps): JSX.Element {
  const {
    buildResult,
    cones,
    conesEdited,
    onConesChange,
    courseWidthM,
    lotMarginM,
    guidanceLevel,
    onCourseWidthChange,
    onLotMarginChange,
    onGuidanceLevelChange,
    onResetCones,
    onContinue,
    onBack,
  } = props;

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const sceneRef = useRef<SceneViewHandle>(null);

  // Keep selection valid if a rebuild changes the cone count out from under us.
  useEffect(() => {
    if (selectedIndex !== null && selectedIndex >= cones.length) setSelectedIndex(null);
  }, [cones.length, selectedIndex]);

  function deleteSelected(): void {
    if (selectedIndex === null) return;
    onConesChange(cones.filter((_, i) => i !== selectedIndex));
    setSelectedIndex(null);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent): void {
      if ((e.key === "Delete" || e.key === "Backspace") && selectedIndex !== null) {
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
        e.preventDefault();
        deleteSelected();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIndex, cones]);

  function handleMoveCone(index: number, position: Cone["position"]): void {
    onConesChange(cones.map((c, i) => (i === index ? { ...c, position } : c)));
  }

  function handleAddCone(): void {
    const centre = sceneRef.current?.getViewCentreAc() ?? { x: 0, y: 0, z: 0 };
    const newCone: Cone = { position: centre, type: "gate", side: 0, station: 0 };
    onConesChange([...cones, newCone]);
    setSelectedIndex(cones.length);
  }

  function handleResetCones(): void {
    onResetCones();
    setSelectedIndex(null);
  }

  return (
    <div className="stage preview-stage">
      <SceneView
        ref={sceneRef}
        centerline={buildResult.centerline}
        cones={cones}
        lotMargin={lotMarginM}
        courseWidth={courseWidthM}
        showGuidanceLines={guidanceLevel !== "realistic"}
        selectedIndex={selectedIndex}
        onSelectCone={setSelectedIndex}
        onMoveCone={handleMoveCone}
      />
      <Sidebar
        buildResult={buildResult}
        coneCount={cones.length}
        conesEdited={conesEdited}
        courseWidthM={courseWidthM}
        lotMarginM={lotMarginM}
        guidanceLevel={guidanceLevel}
        onCourseWidthChange={onCourseWidthChange}
        onLotMarginChange={onLotMarginChange}
        onGuidanceLevelChange={onGuidanceLevelChange}
        onAddCone={handleAddCone}
        onResetCones={handleResetCones}
        onContinue={onContinue}
        onBack={onBack}
        hasSelection={selectedIndex !== null}
        onDeleteSelected={deleteSelected}
      />
    </div>
  );
}
