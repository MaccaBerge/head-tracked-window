import { SplatMesh } from "@sparkjsdev/spark";
import * as THREE from "three";
import type { WindowGeometry } from "./offAxis";
import type { Placement, Room, SplatRoomConfig } from "./rooms";

export interface SplatRoom extends Room {
  mesh: SplatMesh;
  placement: Placement;
  setPlacement(p: Placement): void;
  /** Guesses a sensible placement from where the splats are. */
  suggestPlacement(): Promise<Placement>;
}

const rad = THREE.MathUtils.degToRad;
const deg = THREE.MathUtils.radToDeg;

/** A Gaussian splat scene placed behind the window. */
export function createSplatRoom(config: SplatRoomConfig, placement: Placement, win: WindowGeometry): SplatRoom {
  const group = new THREE.Group();
  const mesh = new SplatMesh({
    url: config.url,
    fileName: config.fileName,
    onProgress: (e) => {
      if (e.lengthComputable) room.loading = Math.min(0.99, e.loaded / e.total);
    },
    onLoad: () => {
      room.loading = undefined;
    },
  });
  group.add(mesh);
  let currentWin = win;

  const apply = () => {
    const p = room.placement;
    mesh.position.set(...p.position);
    mesh.rotation.set(rad(p.rotationDeg[0]), rad(p.rotationDeg[1]), rad(p.rotationDeg[2]));
    group.scale.setScalar(currentWin.width / p.windowWidth);
  };

  const room: SplatRoom = {
    group,
    mesh,
    placement,
    clipAtWindow: true,
    loading: 0,
    update() {},
    resize(w) {
      currentWin = w;
      apply();
    },
    setPlacement(p) {
      room.placement = p;
      apply();
    },
    async suggestPlacement() {
      await mesh.initialized;
      // Sample the solid splats and ignore the outer 5% on each side, which
      // is mostly stray "floaters" far from the real scene.
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      let n = 0;
      mesh.forEachSplat((_i, c, _s, _q, opacity) => {
        if (opacity < 0.3 || n++ % 16) return;
        xs.push(c.x);
        ys.push(c.y);
        zs.push(c.z);
      });
      if (xs.length < 10) return room.placement;
      const span = (a: number[]): [number, number] => {
        a.sort((p, q) => p - q);
        return [a[Math.floor(0.05 * (a.length - 1))], a[Math.floor(0.95 * (a.length - 1))]];
      };
      const [x0, x1] = span(xs);
      const [y0, y1] = span(ys);
      const [z0, z1] = span(zs);
      // Window in the middle of the scene, looking at its far half. Captures
      // are normally upside down, hence the half turn about x (which flips
      // the sign of y and z).
      return {
        windowWidth: Math.max(0.05, 0.6 * (x1 - x0)),
        position: [-(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2],
        rotationDeg: [180, 0, 0],
      };
    },
    dispose() {
      mesh.dispose();
    },
  };
  apply();
  return room;
}

/** Turns the room about the centre of the window, around a screen axis. */
export function rotatePlacement(p: Placement, axis: "x" | "y" | "z", degrees: number): Placement {
  const v = new THREE.Vector3(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
  const turn = new THREE.Quaternion().setFromAxisAngle(v, rad(degrees));
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rad(p.rotationDeg[0]), rad(p.rotationDeg[1]), rad(p.rotationDeg[2])),
  );
  q.premultiply(turn);
  const e = new THREE.Euler().setFromQuaternion(q);
  const pos = new THREE.Vector3(...p.position).applyQuaternion(turn);
  return {
    windowWidth: p.windowWidth,
    position: [pos.x, pos.y, pos.z],
    rotationDeg: [deg(e.x), deg(e.y), deg(e.z)],
  };
}
