import * as THREE from "three";
import type { Room } from "./rooms";

const NEAR_COLOUR = new THREE.Color(0x4fd8ff);
const FAR_COLOUR = new THREE.Color(0x0b2a4a);

/**
 * A box-shaped grid room that starts at the window pane (z = 0) and runs back
 * to z = -depth. Its opening matches the viewport exactly, so the screen edges
 * look like the frame of a hole in the wall.
 */
export function createGridRoom(width: number, height: number, depth: number, showObjects: boolean): Room {
  const group = new THREE.Group();
  const hw = width / 2;
  const hh = height / 2;

  const positions: number[] = [];
  const colours: number[] = [];
  const tmp = new THREE.Color();
  const push = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    tmp.copy(NEAR_COLOUR).lerp(FAR_COLOUR, Math.min(1, -z / depth));
    colours.push(tmp.r, tmp.g, tmp.b);
  };
  const line = (x1: number, y1: number, z1: number, x2: number, y2: number, z2: number) => {
    push(x1, y1, z1);
    push(x2, y2, z2);
  };

  const cell = height / 6;
  const nx = Math.max(2, Math.round(width / cell));
  const ny = 6;
  const nz = Math.max(2, Math.round(depth / cell));

  // Lines running into the room along the floor/ceiling and the side walls.
  for (let i = 0; i <= nx; i++) {
    const x = -hw + (i / nx) * width;
    line(x, -hh, 0, x, -hh, -depth);
    line(x, hh, 0, x, hh, -depth);
    line(x, -hh, -depth, x, hh, -depth); // back wall verticals
  }
  for (let j = 0; j <= ny; j++) {
    const y = -hh + (j / ny) * height;
    line(-hw, y, 0, -hw, y, -depth);
    line(hw, y, 0, hw, y, -depth);
    line(-hw, y, -depth, hw, y, -depth); // back wall horizontals
  }
  // Rectangular rings at each depth step.
  for (let k = 0; k <= nz; k++) {
    const z = -(k / nz) * depth;
    line(-hw, -hh, z, hw, -hh, z);
    line(hw, -hh, z, hw, hh, z);
    line(hw, hh, z, -hw, hh, z);
    line(-hw, hh, z, -hw, -hh, z);
  }

  const gridGeo = new THREE.BufferGeometry();
  gridGeo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  gridGeo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  const gridMat = new THREE.LineBasicMaterial({ vertexColors: true });
  group.add(new THREE.LineSegments(gridGeo, gridMat));

  // Depth targets: balls on stalks from the back wall. They sit at different
  // depths, so they slide past each other when the viewer moves. One of them
  // pokes out in front of the screen.
  const disposables: { dispose(): void }[] = [gridGeo, gridMat];
  if (showObjects) {
    const ballGeo = new THREE.SphereGeometry(height * 0.06, 32, 16);
    const stalkMat = new THREE.LineBasicMaterial({ color: 0x35607f });
    disposables.push(ballGeo, stalkMat);
    const specs: [number, number, number, number][] = [
      // x, y (fractions of half-size), z (fraction of depth; positive = in front), colour
      [-0.6, 0.35, -0.75, 0xff6b6b],
      [0.55, -0.3, -0.5, 0xffd166],
      [-0.25, -0.45, -0.25, 0x6bffb0],
      [0.3, 0.4, -0.08, 0xc792ff],
      [0, 0, 0.12, 0xffffff],
    ];
    specs.forEach(([fx, fy, fz, colour]) => {
      const mat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.35 });
      disposables.push(mat);
      const mesh = new THREE.Mesh(ballGeo, mat);
      mesh.position.set(fx * hw, fy * hh, fz * depth);
      group.add(mesh);

      const stalkGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(fx * hw, fy * hh, -depth),
        mesh.position.clone(),
      ]);
      disposables.push(stalkGeo);
      group.add(new THREE.Line(stalkGeo, stalkMat));
    });

    group.add(new THREE.AmbientLight(0xffffff, 0.6));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(0.5, 1, 1);
    group.add(key);
  }

  return {
    group,
    update() {
      // Static for now.
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}
