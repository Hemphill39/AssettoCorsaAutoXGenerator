import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import * as THREE from "three";
import {
  acToScene,
  boundsOf,
  buildReturnPath,
  headingAt,
  leftOf,
  rightOf,
  sceneToAc,
  toSceneArray,
  TOP_DOWN_UP,
} from "@xcross/core";
import type { Cone, ConeType, CenterlinePoint, Vec3 } from "@xcross/core";

/**
 * The 3D preview: a top-down orthographic view of the lot, the driven line,
 * the return path, and the cones.
 *
 * Every position handed to three.js goes through `acToScene`; every position
 * read back out (cone drags, "add cone here") goes through `sceneToAc`. That
 * boundary is the whole of what keeps this view from silently mirroring the
 * course — see geo/preview.ts in @xcross/core.
 */

export interface SceneViewHandle {
  /** The point the camera is currently centred on, in AC world coordinates. */
  getViewCentreAc(): Vec3;
}

interface SceneViewProps {
  centerline: Vec3[];
  cones: Cone[];
  lotMargin: number;
  /** Width of the drivable corridor, in metres — used to place the guidance-line preview. */
  courseWidth: number;
  /** Mirrors guidance level !== "realistic": a rough preview of the in-game painted edges. */
  showGuidanceLines: boolean;
  selectedIndex: number | null;
  onSelectCone: (index: number | null) => void;
  onMoveCone: (index: number, position: Vec3) => void;
}

const CONE_COLORS: Record<ConeType, number> = {
  start: 0x35c46a,
  finish: 0xf2f2f2,
  slalom: 0xf1c40f,
  gate: 0xe8792a,
};

const MAX_PHI = 1.45; // just short of horizontal, so the view never flips through the ground
const MIN_VIEW_SIZE = 4;
const MAX_VIEW_SIZE = 500;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function disposeObject(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    const mesh = child as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}

type DragState =
  | { mode: "pan"; lastX: number; lastY: number }
  | { mode: "rotate"; lastX: number; lastY: number }
  | { mode: "cone"; index: number };

export const SceneView = forwardRef<SceneViewHandle, SceneViewProps>(function SceneView(
  { centerline, cones, lotMargin, courseWidth, showGuidanceLines, selectedIndex, onSelectCone, onMoveCone },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Callback props change every render; keep the latest behind refs so the
  // (mount-once) three.js effect never has to re-run because of them.
  const onSelectConeRef = useRef(onSelectCone);
  onSelectConeRef.current = onSelectCone;
  const onMoveConeRef = useRef(onMoveCone);
  onMoveConeRef.current = onMoveCone;

  const three = useRef<{
    scene: THREE.Scene;
    camera: THREE.OrthographicCamera;
    renderer: THREE.WebGLRenderer;
    coneGroup: THREE.Group;
    staticGroup: THREE.Group;
    coneGeometry: THREE.ConeGeometry;
    coneMaterials: Record<ConeType, THREE.MeshBasicMaterial>;
    cam: { target: THREE.Vector3; theta: number; phi: number; viewSize: number };
    size: { width: number; height: number };
    hasFit: boolean;
  } | null>(null);
  const updateCameraRef = useRef<(() => void) | null>(null);
  const applyMarkerScaleRef = useRef<(() => void) | null>(null);

  useImperativeHandle(ref, () => ({
    getViewCentreAc(): Vec3 {
      const t = three.current?.cam.target;
      if (!t) return { x: 0, y: 0, z: 0 };
      return sceneToAc({ x: t.x, y: 0, z: t.z });
    },
  }));

  // --- mount: build the renderer, camera, controls. Runs exactly once. ---
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0c0d10);

    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    const coneGeometry = new THREE.ConeGeometry(0.35, 1.0, 12);
    coneGeometry.translate(0, 0.5, 0);
    const coneMaterials: Record<ConeType, THREE.MeshBasicMaterial> = {
      start: new THREE.MeshBasicMaterial({ color: CONE_COLORS.start }),
      finish: new THREE.MeshBasicMaterial({ color: CONE_COLORS.finish }),
      slalom: new THREE.MeshBasicMaterial({ color: CONE_COLORS.slalom }),
      gate: new THREE.MeshBasicMaterial({ color: CONE_COLORS.gate }),
    };

    const coneGroup = new THREE.Group();
    const staticGroup = new THREE.Group();
    scene.add(staticGroup, coneGroup);

    const state = {
      scene,
      camera,
      renderer,
      coneGroup,
      staticGroup,
      coneGeometry,
      coneMaterials,
      cam: { target: new THREE.Vector3(0, 0, 0), theta: 0, phi: 0, viewSize: 40 },
      size: { width: container.clientWidth || 1, height: container.clientHeight || 1 },
      hasFit: false,
    };
    three.current = state;

    function updateCamera(): void {
      const { cam, size } = state;
      const aspect = size.width / Math.max(1, size.height);
      const dir = new THREE.Vector3(
        Math.sin(cam.phi) * Math.sin(cam.theta),
        Math.cos(cam.phi),
        Math.sin(cam.phi) * Math.cos(cam.theta),
      );
      const distance = 300;
      camera.position.set(
        cam.target.x + dir.x * distance,
        cam.target.y + dir.y * distance,
        cam.target.z + dir.z * distance,
      );
      camera.up.set(TOP_DOWN_UP.x, TOP_DOWN_UP.y, TOP_DOWN_UP.z);
      camera.lookAt(cam.target);
      camera.left = -cam.viewSize * aspect;
      camera.right = cam.viewSize * aspect;
      camera.top = cam.viewSize;
      camera.bottom = -cam.viewSize;
      camera.near = 0.1;
      camera.far = distance * 2;
      camera.updateProjectionMatrix();
      applyMarkerScale();
      renderer.render(scene, camera);
    }
    updateCameraRef.current = updateCamera;

    /**
     * Keeps cone markers a usable size on screen at any zoom.
     *
     * A real cone is ~0.35 m wide in a course spanning 300 m, so at the zoom
     * needed to see the whole layout it renders about one pixel across —
     * invisible, and impossible to grab. Markers are therefore scaled with the
     * view rather than left at world size.
     */
    function applyMarkerScale(): void {
      const scale = clamp(state.cam.viewSize / 20, 1, 12);
      for (const child of state.coneGroup.children) {
        if (typeof child.userData["coneIndex"] !== "number") continue;
        // The geometry is pre-translated so its base sits at y=0, so scaling
        // alone keeps the marker standing on the ground.
        child.scale.setScalar(scale);
      }
    }
    applyMarkerScaleRef.current = applyMarkerScale;

    function panBy(dxPixels: number, dyPixels: number): void {
      const worldPerPixel = (state.cam.viewSize * 2) / Math.max(1, state.size.height);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
      right.y = 0;
      up.y = 0;
      if (right.lengthSq() > 1e-6) right.normalize();
      if (up.lengthSq() > 1e-6) up.normalize();
      state.cam.target.x -= right.x * dxPixels * worldPerPixel;
      state.cam.target.z -= right.z * dxPixels * worldPerPixel;
      state.cam.target.x += up.x * dyPixels * worldPerPixel;
      state.cam.target.z += up.z * dyPixels * worldPerPixel;
      updateCamera();
    }

    function rotateBy(dxPixels: number, dyPixels: number): void {
      state.cam.theta -= dxPixels * 0.006;
      state.cam.phi = clamp(state.cam.phi + dyPixels * 0.006, 0, MAX_PHI);
      updateCamera();
    }

    function zoomBy(deltaY: number): void {
      const factor = Math.exp(deltaY * 0.001);
      state.cam.viewSize = clamp(state.cam.viewSize * factor, MIN_VIEW_SIZE, MAX_VIEW_SIZE);
      updateCamera();
    }

    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let drag: DragState | null = null;

    function pointerNdc(e: PointerEvent): THREE.Vector2 {
      const rect = renderer.domElement.getBoundingClientRect();
      return new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
    }

    /**
     * Nearest cone within a pixel radius of the cursor, or null.
     *
     * Screen-space rather than a ray/mesh intersection: cone markers are tiny
     * relative to the course, so requiring a direct hit made them effectively
     * unclickable and every attempted drag fell through to panning the view.
     * Projecting to screen space gives a consistent grab radius at any zoom.
     */
    function coneNear(e: PointerEvent, radiusPx = 18): number | null {
      const rect = renderer.domElement.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;

      let best: number | null = null;
      let bestDist = radiusPx;

      for (const child of coneGroup.children) {
        const index = child.userData["coneIndex"];
        if (typeof index !== "number") continue;
        const projected = child.position.clone().project(camera);
        const sx = ((projected.x + 1) / 2) * rect.width;
        const sy = ((1 - projected.y) / 2) * rect.height;
        const dist = Math.hypot(sx - px, sy - py);
        if (dist < bestDist) {
          bestDist = dist;
          best = index;
        }
      }
      return best;
    }

    function onPointerDown(e: PointerEvent): void {
      renderer.domElement.setPointerCapture(e.pointerId);
      if (e.button === 0) {
        const index = coneNear(e);
        if (index !== null) {
          drag = { mode: "cone", index };
          onSelectConeRef.current(index);
        } else {
          drag = { mode: "pan", lastX: e.clientX, lastY: e.clientY };
          onSelectConeRef.current(null);
        }
      } else if (e.button === 2) {
        drag = { mode: "rotate", lastX: e.clientX, lastY: e.clientY };
      }
    }

    function onPointerMove(e: PointerEvent): void {
      if (!drag) return;
      if (drag.mode === "cone") {
        raycaster.setFromCamera(pointerNdc(e), camera);
        const point = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, point)) {
          const ac = sceneToAc({ x: point.x, y: 0, z: point.z });
          onMoveConeRef.current(drag.index, { x: ac.x, y: 0, z: ac.z });
        }
      } else if (drag.mode === "pan") {
        panBy(e.clientX - drag.lastX, e.clientY - drag.lastY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      } else if (drag.mode === "rotate") {
        rotateBy(e.clientX - drag.lastX, e.clientY - drag.lastY);
        drag.lastX = e.clientX;
        drag.lastY = e.clientY;
      }
    }

    function onPointerUp(e: PointerEvent): void {
      drag = null;
      if (renderer.domElement.hasPointerCapture(e.pointerId)) {
        renderer.domElement.releasePointerCapture(e.pointerId);
      }
    }

    function onWheel(e: WheelEvent): void {
      e.preventDefault();
      zoomBy(e.deltaY);
    }

    function onContextMenu(e: MouseEvent): void {
      e.preventDefault();
    }

    const dom = renderer.domElement;
    dom.addEventListener("pointerdown", onPointerDown);
    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("wheel", onWheel, { passive: false });
    dom.addEventListener("contextmenu", onContextMenu);

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      state.size = { width, height };
      renderer.setSize(width, height, false);
      updateCamera();
    });
    resizeObserver.observe(container);

    let rafId = 0;
    function animate(): void {
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    }
    rafId = requestAnimationFrame(animate);

    updateCamera();

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("wheel", onWheel);
      dom.removeEventListener("contextmenu", onContextMenu);

      disposeObject(coneGroup);
      disposeObject(staticGroup);
      coneGeometry.dispose();
      Object.values(coneMaterials).forEach((m) => m.dispose());
      renderer.dispose();
      if (dom.parentElement === container) container.removeChild(dom);
      three.current = null;
      updateCameraRef.current = null;
    };
  }, []);

  // --- rebuild the lot / driven line / return path when the course changes ---
  // A minimal CenterlinePoint[] good enough for buildReturnPath and headingAt,
  // both of which only read `.position` — the other fields exist purely to
  // satisfy the type, not because we recomputed curvature/speed/etc. here.
  const centerlinePoints = useMemo<CenterlinePoint[]>(
    () =>
      centerline.map((position, i) => ({
        position,
        s: centerline.length > 1 ? i / (centerline.length - 1) : 0,
        distance: 0,
        speed: 0,
        spread: 0,
        curvature: 0,
      })),
    [centerline],
  );

  const returnPath = useMemo<Vec3[]>(() => {
    if (centerlinePoints.length < 2) return [];
    return buildReturnPath(centerlinePoints);
  }, [centerlinePoints]);

  const lotBounds = useMemo(() => {
    if (centerline.length === 0) return null;
    const loop = [...centerline, ...returnPath];
    return boundsOf(loop, lotMargin);
  }, [centerline, returnPath, lotMargin]);

  useEffect(() => {
    const state = three.current;
    if (!state || !lotBounds) return;

    disposeObject(state.staticGroup);
    state.staticGroup.clear();

    const centerAc: Vec3 = {
      x: (lotBounds.minX + lotBounds.maxX) / 2,
      y: 0,
      z: (lotBounds.minZ + lotBounds.maxZ) / 2,
    };
    const centerScene = acToScene(centerAc);
    const width = lotBounds.maxX - lotBounds.minX;
    const depth = lotBounds.maxZ - lotBounds.minZ;

    const lotGeo = new THREE.PlaneGeometry(Math.max(width, 0.01), Math.max(depth, 0.01));
    lotGeo.rotateX(-Math.PI / 2);
    const lotMat = new THREE.MeshBasicMaterial({ color: 0x1b1d22 });
    const lotMesh = new THREE.Mesh(lotGeo, lotMat);
    lotMesh.position.set(centerScene.x, -0.02, centerScene.z);
    state.staticGroup.add(lotMesh);

    if (centerline.length > 1) {
      const lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute("position", new THREE.BufferAttribute(toSceneArray(centerline), 3));
      lineGeo.translate(0, 0.05, 0);
      const lineMat = new THREE.LineBasicMaterial({ color: 0x4fd1ff });
      state.staticGroup.add(new THREE.Line(lineGeo, lineMat));
    }

    if (returnPath.length > 0) {
      const first = centerline[centerline.length - 1];
      const last = centerline[0];
      const full = first && last ? [first, ...returnPath, last] : returnPath;
      const rpGeo = new THREE.BufferGeometry();
      rpGeo.setAttribute("position", new THREE.BufferAttribute(toSceneArray(full), 3));
      rpGeo.translate(0, 0.04, 0);
      const rpMat = new THREE.LineDashedMaterial({ color: 0x585d68, dashSize: 2, gapSize: 1.4 });
      const rpLine = new THREE.Line(rpGeo, rpMat);
      rpLine.computeLineDistances();
      state.staticGroup.add(rpLine);
    }

    // Rough stand-in for the in-game painted edge lines (geometry/guidance.ts
    // isn't exposed through the package index, so this isn't the exact ribbon
    // mesh — just two offset polylines using the same halfWidth math).
    if (showGuidanceLines && centerlinePoints.length > 1) {
      const halfWidth = courseWidth / 2;
      const edgeMat = new THREE.LineBasicMaterial({ color: 0xd8dadf, transparent: true, opacity: 0.55 });
      for (const side of [leftOf, rightOf]) {
        const edgePositions: Vec3[] = centerlinePoints.map((point, i) => {
          const heading = headingAt(centerlinePoints, i);
          const offset = side(heading);
          return {
            x: point.position.x + offset.x * halfWidth,
            y: 0,
            z: point.position.z + offset.z * halfWidth,
          };
        });
        const edgeGeo = new THREE.BufferGeometry();
        edgeGeo.setAttribute("position", new THREE.BufferAttribute(toSceneArray(edgePositions), 3));
        edgeGeo.translate(0, 0.03, 0);
        state.staticGroup.add(new THREE.Line(edgeGeo, edgeMat));
      }
    }

    if (!state.hasFit) {
      const halfW = width / 2;
      const halfD = depth / 2;
      state.cam.target.set(centerScene.x, 0, centerScene.z);
      state.cam.viewSize = Math.max(halfW, halfD, 10) * 1.15;
      state.cam.theta = 0;
      state.cam.phi = 0;
      state.hasFit = true;
    }
    updateCameraRef.current?.();
  }, [centerline, centerlinePoints, returnPath, lotBounds, showGuidanceLines, courseWidth]);

  // --- rebuild cone markers when the cone list or selection changes ---
  useEffect(() => {
    const state = three.current;
    if (!state) return;

    while (state.coneGroup.children.length > 0) {
      const child = state.coneGroup.children[0];
      if (!child) break;
      state.coneGroup.remove(child);
      if (child.userData["disposable"]) disposeObject(child);
    }

    cones.forEach((cone, index) => {
      const scenePos = acToScene(cone.position);
      const mesh = new THREE.Mesh(state.coneGeometry, state.coneMaterials[cone.type]);
      mesh.position.set(scenePos.x, scenePos.y, scenePos.z);
      mesh.userData["coneIndex"] = index;
      state.coneGroup.add(mesh);

      if (index === selectedIndex) {
        const ringGeo = new THREE.RingGeometry(0.5, 0.68, 20);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: 0xffffff,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.85,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.set(scenePos.x, 0.03, scenePos.z);
        ring.userData["disposable"] = true;
        state.coneGroup.add(ring);
      }
    });

    applyMarkerScaleRef.current?.();
    updateCameraRef.current?.();
  }, [cones, selectedIndex]);

  return <div ref={containerRef} className="scene-container" />;
});
