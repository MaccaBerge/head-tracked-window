import * as THREE from "three";
import type { DisplayProfile } from "./settings";

/**
 * World space is "window space", in metres: origin at the centre of the
 * browser viewport, +x right, +y up, +z out of the screen towards the viewer.
 * The viewport itself is the rectangle z = 0, the "window pane".
 */
export interface WindowGeometry {
  /** Physical size of the viewport. */
  width: number;
  height: number;
  /** Position of the webcam lens in window space. */
  cameraX: number;
  cameraY: number;
}

/** Works out the physical size and position of the viewport on the display. */
export function measureWindow(profile: DisplayProfile): WindowGeometry {
  const sw = window.screen.width;
  const sh = window.screen.height;
  const diagM = profile.diagonalIn * 0.0254;
  const mPerPx = diagM / Math.hypot(sw, sh);
  const displayH = sh * mPerPx;

  // Where the viewport sits on the display. Exact in fullscreen; a good
  // estimate otherwise (assumes the browser's toolbars are all at the top).
  const scr = window.screen as Screen & { availLeft?: number; availTop?: number };
  const availTop = scr.availTop ?? 0;
  const left = window.screenX - (scr.availLeft ?? 0);
  const top = availTop < 100 ? window.screenY : window.screenY - availTop;
  const chromeLeft = (window.outerWidth - window.innerWidth) / 2;
  const chromeTop = window.outerHeight - window.innerHeight;
  const centrePxX = left + chromeLeft + window.innerWidth / 2;
  const centrePxY = top + chromeTop + window.innerHeight / 2;
  const offsetX = (centrePxX - sw / 2) * mPerPx;
  const offsetY = -(centrePxY - sh / 2) * mPerPx;

  return {
    width: window.innerWidth * mPerPx,
    height: window.innerHeight * mPerPx,
    cameraX: profile.cameraSideM - offsetX,
    cameraY:
      (profile.cameraEdge === "top" ? displayH / 2 + profile.cameraGapM : -displayH / 2 - profile.cameraGapM) -
      offsetY,
  };
}

const NEAR = 0.01;
const FAR = 200;

/**
 * Points the camera from the viewer's eye through the window pane.
 * The frustum is asymmetric: its edges pass exactly through the four edges of
 * the physical viewport, which is what makes the screen behave like a window.
 */
export function applyOffAxis(
  camera: THREE.PerspectiveCamera,
  eye: THREE.Vector3,
  win: WindowGeometry,
  clipAtWindow = false,
): void {
  const ez = Math.max(eye.z, 0.05);
  // With clipAtWindow the near plane lies on the window pane itself, so
  // nothing in front of the glass is drawn (a wall the window is set into,
  // for example). Without it, things may poke out of the screen.
  const near = clipAtWindow ? ez : NEAR;
  const k = near / ez;
  const left = (-win.width / 2 - eye.x) * k;
  const right = (win.width / 2 - eye.x) * k;
  const bottom = (-win.height / 2 - eye.y) * k;
  const top = (win.height / 2 - eye.y) * k;

  camera.position.set(eye.x, eye.y, ez);
  camera.quaternion.identity();
  camera.updateMatrixWorld();
  camera.projectionMatrix.makePerspective(left, right, top, bottom, near, FAR);
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}
