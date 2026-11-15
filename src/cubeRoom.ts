import * as THREE from "three";
import { DEFAULT_PALETTES, MAX_PALETTE_COLOURS, PaletteSampler } from "./palettes";
import type { Room } from "./rooms";

export type CubeColourMode =
  | "solid"
  | "breathing"
  | "cycle"
  | "rainbow"
  | "spiral"
  | "rings"
  | "starlight"
  | "aurora"
  | "fire"
  | "rain";

/** Every colour effect, in menu order, with its name in the panel. */
export const CUBE_COLOUR_MODES: {
  id: CubeColourMode;
  name: string;
  /** Most colours the effect can use (one colour mode uses just one). */
  maxColours: number;
  /** How the effect uses its colours, shown under the colour list. */
  hint: string;
}[] = [
  { id: "solid", name: "One colour", maxColours: 1, hint: "Every cube in this colour." },
  { id: "breathing", name: "Breathing", maxColours: MAX_PALETTE_COLOURS, hint: "Each breath moves on to the next colour." },
  { id: "cycle", name: "Colour cycle", maxColours: MAX_PALETTE_COLOURS, hint: "The room fades through these colours in turn." },
  { id: "rainbow", name: "Rainbow wave", maxColours: MAX_PALETTE_COLOURS, hint: "A gradient through these colours, along the room." },
  { id: "spiral", name: "Spiral", maxColours: MAX_PALETTE_COLOURS, hint: "A gradient through these colours, around the room." },
  { id: "rings", name: "Pulse rings", maxColours: MAX_PALETTE_COLOURS, hint: "The rings shift through these colours." },
  { id: "starlight", name: "Starlight", maxColours: MAX_PALETTE_COLOURS, hint: "Each star flashes in one of these colours." },
  { id: "aurora", name: "Aurora", maxColours: MAX_PALETTE_COLOURS, hint: "Waves blend between these colours." },
  { id: "fire", name: "Fire", maxColours: MAX_PALETTE_COLOURS, hint: "From coolest (first) to hottest (last)." },
  { id: "rain", name: "Digital rain", maxColours: MAX_PALETTE_COLOURS, hint: "Each drop falls in one of these colours." },
];

/** The colours an effect is using: the user's own, or the effect's default. */
export function paletteFor(settings: CubeRoomSettings, mode: CubeColourMode): string[] {
  const own = settings.cubePalettes?.[mode];
  return own && own.length ? own : DEFAULT_PALETTES[mode];
}

export type CubeLayout = "mosaic" | "grid" | "bricks";
export type CubeMotion = "none" | "ripple" | "rising" | "swirl" | "pulse" | "random";

export const CUBE_LAYOUTS: { id: CubeLayout; name: string }[] = [
  { id: "mosaic", name: "Mosaic" },
  { id: "grid", name: "Grid" },
  { id: "bricks", name: "Bricks" },
];

export type CubeTurn = "none" | "tip" | "spin" | "tumble";

export const CUBE_TURNS: { id: CubeTurn; name: string }[] = [
  { id: "none", name: "Off" },
  { id: "tip", name: "Tip with the wave" },
  { id: "spin", name: "Spin" },
  { id: "tumble", name: "Tumble" },
];

export const CUBE_MOTIONS: { id: CubeMotion; name: string }[] = [
  { id: "none", name: "Still" },
  { id: "ripple", name: "Ripple into the room" },
  { id: "rising", name: "Rising wave" },
  { id: "swirl", name: "Swirl" },
  { id: "pulse", name: "Pulse together" },
  { id: "random", name: "Random bobbing" },
];

/**
 * The cube room's settings. Colour and movement settings are read every
 * frame, so changes show at once; layout settings rebuild the room.
 */
export interface CubeRoomSettings {
  cubeColourMode: CubeColourMode;
  /** The colours each effect uses, as CSS hex strings; effects not listed use their default. */
  cubePalettes: Partial<Record<CubeColourMode, string[]>>;
  /** Colour animation speed; 1 is the normal pace, 0 stands still. */
  cubeSpeed: number;

  // Layout
  cubeLayout: CubeLayout;
  /** 1 (small) to 10 (huge): sets how many of the biggest cubes fit up a wall. */
  cubeSize: number;
  /** Mosaic: how many times a block can split into four smaller ones (0 to 3). */
  cubeVariety: number;
  /** Mosaic: how readily blocks split, 0 never to 1 almost always. */
  cubeSplit: number;
  /** Space between cubes, as a share of each cube's block. */
  cubeGap: number;
  /** The most a cube sticks out of the wall at rest, as a share of its size. */
  cubeRelief: number;
  /** Random tilt of each cube, in degrees. */
  cubeTilt: number;
  /** Share of cubes left out, 0 to 0.7. */
  cubeMissing: number;
  /** Seed of the random layout; a new one shuffles the cubes. */
  cubeSeed: number;

  // Movement
  cubeMotion: CubeMotion;
  /** How far cubes move, as a multiple of the default. */
  cubeMotionAmount: number;
  /** Movement speed; 1 is the normal pace. */
  cubeMotionSpeed: number;
  /** How cubes turn as they move. */
  cubeTurn: CubeTurn;
  /** The most a cube turns, in degrees. */
  cubeTurnAmount: number;
  /** Brightness of the glow behind the cubes, filling the gaps: 0 leaves them black. */
  cubeGapGlow: number;
}

/** Defaults for every cube setting. */
export const CUBE_DEFAULTS: CubeRoomSettings = {
  cubeColourMode: "rainbow",
  cubePalettes: {},
  cubeSpeed: 1,
  cubeLayout: "mosaic",
  cubeSize: 8,
  cubeVariety: 2,
  cubeSplit: 0.5,
  cubeGap: 0.1,
  cubeRelief: 0.45,
  cubeTilt: 0,
  cubeMissing: 0,
  cubeSeed: 20261114,
  cubeMotion: "ripple",
  cubeMotionAmount: 1,
  cubeMotionSpeed: 1,
  cubeTurn: "none",
  cubeTurnAmount: 25,
  cubeGapGlow: 0.6,
};

/** The layout settings: changing one of these rebuilds the room. */
export const CUBE_LAYOUT_KEYS = [
  "cubeLayout",
  "cubeSize",
  "cubeVariety",
  "cubeSplit",
  "cubeGap",
  "cubeRelief",
  "cubeTilt",
  "cubeMissing",
  "cubeSeed",
  // Turning cubes reach further into the wall, so the glow behind them moves back.
  "cubeTurn",
  "cubeTurnAmount",
] as const;

/** The inside of the room, in metres. Things like balls can bounce off these. */
export interface RoomBounds {
  halfWidth: number;
  halfHeight: number;
  /** The back wall is at z = -depth; the window pane is at z = 0. */
  depth: number;
}

/** Where a wall's surface is under a point, for things bouncing off it. */
export interface WallSurface {
  /** How far the surface stands into the room from the wall's base line, in metres (negative in a hole). */
  offset: number;
  /** How fast it's moving into the room, in metres per second (cubes pushed out by the movement). */
  velocity: number;
}

export interface CubeCollider {
  /** The surface of a wall under point `p` (window space). */
  surface(wall: WallKey, p: THREE.Vector3): WallSurface;
  /** The colour the room's current effect gives point `p`, for things inside the room. */
  colourAt(p: THREE.Vector3, seed: number, target: THREE.Color): THREE.Color;
}

export interface CubeRoom extends Room {
  bounds: RoomBounds;
  collider: CubeCollider;
}

/**
 * How far the walls continue out of the screen towards the viewer, as a
 * multiple of the window's larger side. Far enough that the walls' ends stay
 * out of view, even when leaning in close or far to one side.
 */
const FRONT_EXTENSION = 1.5;
/** At movement amount 1, how far a cube moves into the room, as a share of its size. */
export const MOTION = 0.35;
/**
 * Spacing of the colour points on the glowing surfaces, as a share of the
 * biggest cubes. The surfaces only carry smooth gradients, so this can be coarse.
 */
const SURFACE_STEP = 0.25;
/** How much each cube glows in its own colour, on top of the lighting. */
const GLOW = 0.45;

/** Where a point is in the room, in the terms the colour effects use. */
interface Spot {
  /** 0 at the front of the room to about 1.5 at the far corners: drives the waves. */
  along: number;
  /** Angle around the room's centre line, 0 to 1. */
  angle: number;
  /** Distance from the room's centre line, 0 at the middle to about 1.4 in the corners. */
  radius: number;
  /** 1 at the top of the walls to 0 at the bottom; on the floor and ceiling, towards the viewer. */
  fall: number;
  /** A fixed random number per point, for effects that treat cubes individually. */
  seed: number;
}

/** Which wall a cube or surface belongs to, for hiding the stretches in front of the screen. */
export type WallKey = "floor" | "ceiling" | "left" | "right" | "back";

interface Cube extends Spot {
  /** Centre of the cube's inner face, which sits on the room's boundary. */
  face: THREE.Vector3;
  /** Points into the room. */
  normal: THREE.Vector3;
  /** Size along x, y and z. */
  size: THREE.Vector3;
  /** Thickness along the normal. */
  thickness: number;
  /** How far the cube sticks out of the wall at rest, in metres. */
  relief: number;
  /** Part of a wall's stretch in front of the screen, rather than inside the room. */
  inFront: boolean;
  wall: WallKey;
  /** Left out of the wall, leaving a hole onto the glowing surface behind. */
  missing: boolean;
  /** The cube's own tilt. */
  rotation: THREE.Quaternion;
  /** Its block on the wall, along the wall's two directions: [u from, u to, v from, v to]. */
  rect: [number, number, number, number];
  /** The direction each travelling wave moves across this cube, along the wall. */
  travel: Record<"ripple" | "rising" | "swirl", THREE.Vector3>;
  /** A random axis along the wall, for tipping when the movement has no direction. */
  wallAxis: THREE.Vector3;
  /** A random axis in any direction, for tumbling. */
  ownAxis: THREE.Vector3;
}

/** Shared by every cube room built, so rebuilding (e.g. a layout change) doesn't restart the animation. */
const clock = { colour: 0, motion: 0, flicker: 0 };
/**
 * The fire flicker runs on its own clock that never goes faster than normal
 * speed, and its fastest wobble is about 2 Hz. Content must not flash more
 * than three times a second, whatever the colour speed is set to.
 */
const MAX_FLICKER_SPEED = 1;

/**
 * A box-shaped room, the same size and place as the grid room, whose floor,
 * ceiling and walls are covered in cubes: a mosaic of mixed sizes, a regular
 * grid or bricks, each cube sticking out of the wall by its own amount. The
 * cubes light up in one of the colour effects and can move in and out of the
 * walls in several ways. All of it is set in the panel.
 */
export function createCubeRoom(
  width: number,
  height: number,
  depth: number,
  settings: CubeRoomSettings,
): CubeRoom {
  const group = new THREE.Group();
  const hw = width / 2;
  const hh = height / 2;
  const cubes: Cube[] = [];
  const random = seededRandom(settings.cubeSeed);
  /** The colour effects' view of a point on the wall with the given inward normal. */
  const spotAt = (p: THREE.Vector3, normal: THREE.Vector3, seed: number): Spot => {
    const nx = p.x / hw;
    const ny = p.y / hh;
    return {
      along: -p.z / depth + 0.25 * (Math.abs(nx) + Math.abs(ny)),
      angle: (Math.atan2(ny, nx) / (2 * Math.PI) + 1) % 1,
      radius: Math.hypot(nx, ny),
      fall: Math.abs(normal.y) > 0.5 ? -p.z / depth : (ny + 1) / 2,
      seed,
    };
  };
  // A separate random stream for the turning axes, so the layout is the same
  // with or without them.
  const axisRandom = seededRandom(settings.cubeSeed ^ 0x9e3779b9);
  /**
   * The direction a wave travels across the wall at `p`: against the
   * gradient of the wave's phase, measured along the wall's two directions.
   */
  const travelAt = (p: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, normal: THREE.Vector3, motion: "ripple" | "rising" | "swirl") => {
    const eps = 1e-3;
    const at = (du: number, dv: number) => wavePhase(spotAt(p.clone().addScaledVector(u, du).addScaledVector(v, dv), normal, 0), motion);
    const wrap = (d: number) => ((((d + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const gu = wrap(at(eps, 0) - at(-eps, 0)) / (2 * eps);
    const gv = wrap(at(0, eps) - at(0, -eps)) / (2 * eps);
    const dir = new THREE.Vector3().addScaledVector(u, -gu).addScaledVector(v, -gv);
    return dir.lengthSq() > 1e-12 ? dir.normalize() : v.clone();
  };
  const wallOf = (normal: THREE.Vector3): WallKey =>
    normal.x > 0.5 ? "left" : normal.x < -0.5 ? "right" : normal.y > 0.5 ? "floor" : normal.y < -0.5 ? "ceiling" : "back";
  const rows = Math.max(1, Math.round(11 - settings.cubeSize));
  const big = height / rows;
  const fill = 1 - Math.min(0.6, Math.max(0, settings.cubeGap));
  const tilt = THREE.MathUtils.degToRad(settings.cubeTilt);

  /**
   * Covers one wall with cubes, in the chosen pattern. `origin` is one corner
   * of the wall, `u` and `v` run along its two sides (lengths `lu` and `lv`),
   * and `normal` points into the room.
   */
  /** Each wall's frame, for finding the cube under a point (see buildWallLookup). */
  const wallFrames = new Map<WallKey, { origin: THREE.Vector3; u: THREE.Vector3; v: THREE.Vector3; lu: number; lv: number; cubes: number[] }>();
  const coverWall = (origin: THREE.Vector3, u: THREE.Vector3, lu: number, v: THREE.Vector3, lv: number, normal: THREE.Vector3) => {
    const wallCubes: number[] = [];
    wallFrames.set(wallOf(normal), { origin, u, v, lu, lv, cubes: wallCubes });
    /** One cube filling the block of size su × sv centred at (cu, cv) on the wall. */
    const leaf = (su: number, sv: number, cu: number, cv: number) => {
      // Decide everything random first, so leaving a cube out doesn't shift the rest.
      const missing = random() < settings.cubeMissing;
      const reliefRoll = random();
      const seed = random();
      const spin = [random(), random(), random()];
      const thickness = Math.min(su, sv) * fill;
      const size = new THREE.Vector3()
        .addScaledVector(abs(u), su * fill)
        .addScaledVector(abs(v), sv * fill)
        .addScaledVector(abs(normal), thickness);
      const face = origin.clone().addScaledVector(u, cu).addScaledVector(v, cv);
      // Bias towards small offsets, with the odd cube standing well proud.
      const relief = Math.pow(reliefRoll, 2) * settings.cubeRelief * thickness;
      // Mostly turned about the wall's normal, with a little rock the other ways.
      const rotation = new THREE.Quaternion()
        .setFromAxisAngle(normal, (spin[0] - 0.5) * 2 * tilt)
        .multiply(new THREE.Quaternion().setFromAxisAngle(u, (spin[1] - 0.5) * tilt))
        .multiply(new THREE.Quaternion().setFromAxisAngle(v, (spin[2] - 0.5) * tilt));
      wallCubes.push(cubes.length);
      cubes.push({
        ...spotAt(face, normal, seed),
        rect: [cu - su / 2, cu + su / 2, cv - sv / 2, cv + sv / 2],
        face,
        normal,
        size,
        thickness,
        relief,
        inFront: face.z > 0,
        wall: wallOf(normal),
        rotation,
        missing,
        travel: {
          ripple: travelAt(face, u, v, normal, "ripple"),
          rising: travelAt(face, u, v, normal, "rising"),
          swirl: travelAt(face, u, v, normal, "swirl"),
        },
        wallAxis: (() => {
          const a = axisRandom() * 2 * Math.PI;
          return u.clone().multiplyScalar(Math.cos(a)).addScaledVector(v, Math.sin(a));
        })(),
        ownAxis: new THREE.Vector3(axisRandom() - 0.5, axisRandom() - 0.5, axisRandom() - 0.5).normalize(),
      });
    };

    /** Mosaic: a block either becomes a cube or splits into four, and so on. */
    const block = (su: number, sv: number, cu: number, cv: number, level: number) => {
      const chance = level < settings.cubeVariety ? Math.min(1, settings.cubeSplit * (1.1 - 0.3 * level)) : 0;
      if (random() < chance) {
        for (const du of [-0.25, 0.25]) {
          for (const dv of [-0.25, 0.25]) block(su / 2, sv / 2, cu + du * su, cv + dv * sv, level + 1);
        }
        return;
      }
      leaf(su, sv, cu, cv);
    };

    // As many of the biggest blocks as fit each way, stretched slightly to fill the wall exactly.
    const nu = Math.max(1, Math.round(lu / big));
    const nv = Math.max(1, Math.round(lv / big));
    const bu = lu / nu;
    const bv = lv / nv;
    if (settings.cubeLayout === "bricks") {
      // Rows of bricks twice as long as they are tall, every other row shifted by half a brick.
      const brick = lu / Math.max(1, Math.round(lu / (2 * big)));
      for (let j = 0; j < nv; j++) {
        const shift = j % 2 ? brick / 2 : 0;
        for (let start = -shift; start < lu - 1e-6; start += brick) {
          const a = Math.max(0, start);
          const b = Math.min(lu, start + brick);
          if (b - a > 1e-6) leaf(b - a, bv, (a + b) / 2, (j + 0.5) * bv);
        }
      }
      return;
    }
    for (let i = 0; i < nu; i++) {
      for (let j = 0; j < nv; j++) {
        const cu = (i + 0.5) * bu;
        const cv = (j + 0.5) * bv;
        if (settings.cubeLayout === "grid") leaf(bu, bv, cu, cv);
        else block(bu, bv, cu, cv, 0);
      }
    }
  };

  const X = new THREE.Vector3(1, 0, 0);
  const Y = new THREE.Vector3(0, 1, 0);
  const Zin = new THREE.Vector3(0, 0, -1); // from the front of the room towards the back
  // The floor, ceiling and side walls carry on out of the screen towards the
  // viewer, so their ends are never in view and the room seems to surround you.
  const front = FRONT_EXTENSION * Math.max(width, height);
  const length = depth + front;
  coverWall(new THREE.Vector3(-hw, -hh, front), X, width, Zin, length, new THREE.Vector3(0, 1, 0)); // floor
  coverWall(new THREE.Vector3(-hw, hh, front), X, width, Zin, length, new THREE.Vector3(0, -1, 0)); // ceiling
  coverWall(new THREE.Vector3(-hw, -hh, front), Y, height, Zin, length, new THREE.Vector3(1, 0, 0)); // left
  coverWall(new THREE.Vector3(hw, -hh, front), Y, height, Zin, length, new THREE.Vector3(-1, 0, 0)); // right
  coverWall(new THREE.Vector3(-hw, -hh, -depth), X, width, Y, height, new THREE.Vector3(0, 0, 1)); // back

  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.1 });
  // Let each cube glow faintly in its own colour, like a backlit key.
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <emissivemap_fragment>",
      `#include <emissivemap_fragment>
       #ifdef USE_INSTANCING_COLOR
         totalEmissiveRadiance += vColor.rgb * ${GLOW.toFixed(2)};
       #endif`,
    );
  };
  const solidCount = cubes.filter((c) => !c.missing).length;
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, solidCount));
  mesh.count = solidCount;
  /** For each block, its cube's index in `mesh`, or -1 if the cube is missing. */
  const cubeIndex: number[] = [];
  let solidIndex = 0;
  for (const c of cubes) cubeIndex.push(c.missing ? -1 : solidIndex++);

  // Behind the cubes, one glowing surface per wall, lying just under the
  // wall's face so it only shows through the gaps and holes. Its colours are
  // a smooth gradient from the same effect as the cubes, so the gaps glow
  // like the light between the keys of a backlit keyboard.
  //
  // Each wall's surface sits behind the deepest point of every cube on that
  // wall, tilt included, so no cube can poke through it. (Movement only ever
  // pushes cubes out of the wall, so their resting place is their deepest.)
  const sinkOf: Record<WallKey, number> = { floor: 0, ceiling: 0, left: 0, right: 0, back: 0 };
  const turning = settings.cubeTurn !== "none" && settings.cubeTurnAmount > 0;
  {
    const axis = new THREE.Vector3();
    for (const c of cubes) {
      // How far the tilted box reaches along the wall's normal, from its centre.
      let reach = 0;
      for (const [dir, half] of [
        [new THREE.Vector3(1, 0, 0), c.size.x / 2],
        [new THREE.Vector3(0, 1, 0), c.size.y / 2],
        [new THREE.Vector3(0, 0, 1), c.size.z / 2],
      ] as const) {
        reach += Math.abs(axis.copy(dir).applyQuaternion(c.rotation).dot(c.normal)) * half;
      }
      // The centre sits (relief - thickness / 2) out from the wall's face.
      // A cube that turns as it moves can reach as far as its half-diagonal.
      if (turning) reach = Math.max(reach, c.size.length() / 2);
      const behind = reach - (c.relief - c.thickness / 2);
      sinkOf[c.wall] = Math.max(sinkOf[c.wall], behind);
    }
  }
  // A little extra room behind the deepest cube.
  const sinkGap = 0.05 * big;

  // ---------- Surfaces for collisions ----------
  // How far each cube's inner face stands into the room right now, and how
  // fast it's moving. A missing cube is a hole down to the glowing surface.
  const faceOffset = new Float32Array(cubes.length);
  const previousOffset = new Float32Array(cubes.length);
  const faceVelocity = new Float32Array(cubes.length);
  cubes.forEach((c, i) => (faceOffset[i] = c.missing ? -(sinkOf[c.wall] + sinkGap) : c.relief));
  // A coarse grid per wall listing the cubes that overlap each cell, so the
  // cube under a point is found by checking a handful of blocks.
  const lookupCell = big / 4;
  const lookup = new Map<WallKey, { nu: number; nv: number; cells: number[][] }>();
  for (const [key, w] of wallFrames) {
    const nu = Math.max(1, Math.ceil(w.lu / lookupCell));
    const nv = Math.max(1, Math.ceil(w.lv / lookupCell));
    const cells: number[][] = Array.from({ length: nu * nv }, () => []);
    for (const i of w.cubes) {
      const [u0, u1, v0, v1] = cubes[i].rect;
      for (let a = Math.max(0, Math.floor(u0 / lookupCell)); a <= Math.min(nu - 1, Math.floor((u1 - 1e-9) / lookupCell)); a++) {
        for (let b = Math.max(0, Math.floor(v0 / lookupCell)); b <= Math.min(nv - 1, Math.floor((v1 - 1e-9) / lookupCell)); b++) {
          cells[b * nu + a].push(i);
        }
      }
    }
    lookup.set(key, { nu, nv, cells });
  }
  const local = new THREE.Vector3();
  const noSurface: WallSurface = { offset: 0, velocity: 0 };
  const surfaceResult: WallSurface = { offset: 0, velocity: 0 };
  /** Set each frame to that frame's colour function (see update). */
  let paintFrame: ((target: THREE.Color, s: Spot, smooth: boolean) => THREE.Color) | null = null;
  const sideways = new THREE.Vector3(1, 0, 0);

  const collider: CubeCollider = {
    surface(wall, p) {
      const frame = wallFrames.get(wall);
      const grid = lookup.get(wall);
      if (!frame || !grid) return noSurface;
      local.subVectors(p, frame.origin);
      const pu = local.dot(frame.u);
      const pv = local.dot(frame.v);
      const a = Math.floor(pu / lookupCell);
      const b = Math.floor(pv / lookupCell);
      if (a < 0 || b < 0 || a >= grid.nu || b >= grid.nv) return noSurface;
      for (const i of grid.cells[b * grid.nu + a]) {
        const [u0, u1, v0, v1] = cubes[i].rect;
        if (pu >= u0 && pu <= u1 && pv >= v0 && pv <= v1) {
          surfaceResult.offset = faceOffset[i];
          surfaceResult.velocity = faceVelocity[i];
          return surfaceResult;
        }
      }
      return noSurface;
    },
    colourAt(p, seed, target) {
      if (!paintFrame) return target.set(0xffffff);
      return paintFrame(target, spotAt(p, sideways, seed), false);
    },
  };
  // The sealed box the surfaces form: every side pushed back behind its own
  // cubes, and every surface stretched to meet its neighbours, so the corners
  // close and no black shows between them.
  const box = {
    left: -hw - (sinkOf.left + sinkGap),
    right: hw + (sinkOf.right + sinkGap),
    bottom: -hh - (sinkOf.floor + sinkGap),
    top: hh + (sinkOf.ceiling + sinkGap),
    back: -depth - (sinkOf.back + sinkGap),
  };
  const boxWidth = box.right - box.left;
  const boxHeight = box.top - box.bottom;
  const boxDepth = -box.back; // from the window plane to the back

  const step = SURFACE_STEP * big;
  const surfaceMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const surfaces: { mesh: THREE.Mesh; spots: Spot[]; colours: THREE.BufferAttribute; wall: WallKey; inFront: boolean }[] = [];
  const surfaceRandom = seededRandom(settings.cubeSeed ^ 0x5bd1e995);
  /** A flat rectangle from `origin` along `u` (length lu) and `v` (length lv), with colour points on a grid. */
  const addSurface = (origin: THREE.Vector3, u: THREE.Vector3, lu: number, v: THREE.Vector3, lv: number, normal: THREE.Vector3, inFront: boolean) => {
    const nu = Math.max(1, Math.ceil(lu / step));
    const nv = Math.max(1, Math.ceil(lv / step));
    const positions: number[] = [];
    const spots: Spot[] = [];
    const p = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        p.copy(origin).addScaledVector(u, (i / nu) * lu).addScaledVector(v, (j / nv) * lv);
        spots.push(spotAt(p, normal, surfaceRandom()));
        positions.push(p.x, p.y, p.z);
      }
    }
    const index: number[] = [];
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = j * (nu + 1) + i;
        index.push(a, a + 1, a + nu + 1, a + 1, a + nu + 2, a + nu + 1);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const colours = new THREE.Float32BufferAttribute(new Float32Array(spots.length * 3), 3);
    colours.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("color", colours);
    geo.setIndex(index);
    const surface = new THREE.Mesh(geo, surfaceMaterial);
    group.add(surface);
    surfaces.push({ mesh: surface, spots, colours, wall: wallOf(normal), inFront });
  };
  // Floor, ceiling and side walls in two parts each, so the stretch in front
  // of the screen can be hidden on its own, like the cubes on it.
  const walls: [THREE.Vector3, THREE.Vector3, number, THREE.Vector3][] = [
    [new THREE.Vector3(box.left, box.bottom, 0), X, boxWidth, new THREE.Vector3(0, 1, 0)], // floor
    [new THREE.Vector3(box.left, box.top, 0), X, boxWidth, new THREE.Vector3(0, -1, 0)], // ceiling
    [new THREE.Vector3(box.left, box.bottom, 0), Y, boxHeight, new THREE.Vector3(1, 0, 0)], // left
    [new THREE.Vector3(box.right, box.bottom, 0), Y, boxHeight, new THREE.Vector3(-1, 0, 0)], // right
  ];
  for (const [origin, u, lu, normal] of walls) {
    addSurface(origin, u, lu, Zin, boxDepth, normal, false);
    addSurface(origin.clone().setZ(front), u, lu, Zin, front, normal, true);
  }
  addSurface(new THREE.Vector3(box.left, box.bottom, box.back), X, boxWidth, Y, boxHeight, new THREE.Vector3(0, 0, 1), false); // back
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // The cubes move, so the mesh's bounds aren't fixed; never cull it.
  mesh.frustumCulled = false;
  group.add(mesh);

  group.add(new THREE.AmbientLight(0xffffff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(0.3, 1, 1);
  group.add(key);

  const matrix = new THREE.Matrix4();
  const colour = new THREE.Color();
  const palette = new PaletteSampler();
  const rotated = new THREE.Quaternion();
  const position = new THREE.Vector3();
  let lastTime = -1;

  // Matrices are only rewritten while the cubes move or have just stopped.
  let moving = true;
  /**
   * Which walls' stretches in front of the screen are hidden. When your head
   * is outside a wall's line (leaning far to one side, or above the top of
   * the screen), that stretch would sit between you and the window and you'd
   * see the backs of its cubes, so it is hidden. It switches when the wall is
   * edge-on to you, so the change is hard to see.
   */
  const hidden = { left: false, right: false, floor: false, ceiling: false };
  const margin = (settings.cubeRelief + MOTION * Math.max(0, settings.cubeMotionAmount) + (turning ? 0.75 : 0)) * big;
  const isHidden = (c: Cube) => c.inFront && c.wall !== "back" && hidden[c.wall];

  /**
   * Where a cube is in its movement cycle, as an angle θ: it is pushed out of
   * the wall by 0.5 + 0.5·sin θ (0 to 1 of the full amount).
   */
  const motionAngle = (c: Cube, t: number, motion: CubeMotion): number => {
    switch (motion) {
      case "ripple": // a wave travelling from the window into the room
        return t * 2.2 + wavePhase(c, "ripple");
      case "rising": // a wave climbing the walls (and running along floor and ceiling)
        return t * 2.2 + wavePhase(c, "rising");
      case "swirl": // a wave turning around the room
        return t * 2 + wavePhase(c, "swirl");
      case "pulse": // every cube in and out together
        return t * 2 - Math.PI / 2;
      case "random": // each cube bobbing at its own pace
        return t * (1.2 + c.seed * 1.6) + c.seed * 40;
      default:
        return -Math.PI / 2;
    }
  };

  const turn = new THREE.Quaternion();
  const turnAxis = new THREE.Vector3();
  /**
   * How a cube turns with its movement. Tipping leans it with the slope of a
   * passing wave (most as the wave's edge goes by, level at its crest), like
   * tiles riding a wave. Spinning and tumbling follow how far out it is.
   */
  const turnFor = (c: Cube, theta: number, motion: CubeMotion): THREE.Quaternion => {
    const most = THREE.MathUtils.degToRad(settings.cubeTurnAmount);
    const out = Math.sin(theta); // -1 sunk in, +1 fully out
    switch (settings.cubeTurn) {
      case "tip":
        if (motion === "ripple" || motion === "rising" || motion === "swirl") {
          turnAxis.crossVectors(c.normal, c.travel[motion]).normalize();
          return turn.setFromAxisAngle(turnAxis, most * Math.cos(theta));
        }
        return turn.setFromAxisAngle(c.wallAxis, most * out);
      case "spin":
        return turn.setFromAxisAngle(c.normal, most * out);
      case "tumble":
        return turn.setFromAxisAngle(c.ownAxis, most * out);
      default:
        return turn.identity();
    }
  };

  const placeCubes = (time: number, motion: CubeMotion) => {
    const amount = MOTION * Math.max(0, settings.cubeMotionAmount);
    cubes.forEach((c, i) => {
      const k = cubeIndex[i];
      if (k < 0) return;
      if (isHidden(c)) {
        mesh.setMatrixAt(k, matrix.makeScale(0, 0, 0));
        return;
      }

      const theta = motionAngle(c, time, motion);
      const push = motion === "none" ? 0 : amount * c.thickness * (0.5 + 0.5 * Math.sin(theta));
      // Sink the cube into the wall so its inner face is on the boundary, then push it out.
      faceOffset[i] = c.relief + push;
      const d = c.relief + push - c.thickness / 2;
      position.copy(c.face).addScaledVector(c.normal, d);
      // The movement's turn is applied on top of the cube's own tilt.
      if (turning && motion !== "none") rotated.copy(turnFor(c, theta, motion)).multiply(c.rotation);
      else rotated.copy(c.rotation);
      matrix.compose(position, rotated, c.size);
      mesh.setMatrixAt(k, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    for (const s of surfaces) s.mesh.visible = !(s.inFront && s.wall !== "back" && hidden[s.wall]);
  };

  const room: CubeRoom = {
    group,
    bounds: { halfWidth: hw, halfHeight: hh, depth },
    collider,
    update(timeS, eye) {
      const dt = lastTime < 0 ? 0 : Math.min(0.1, timeS - lastTime);
      lastTime = timeS;
      clock.colour += dt * settings.cubeSpeed;
      clock.flicker += dt * Math.min(settings.cubeSpeed, MAX_FLICKER_SPEED);
      clock.motion += dt * settings.cubeMotionSpeed;

      let changed = false;
      if (eye) {
        const next = {
          left: eye.x < -hw + margin,
          right: eye.x > hw - margin,
          floor: eye.y < -hh + margin,
          ceiling: eye.y > hh - margin,
        };
        changed =
          next.left !== hidden.left ||
          next.right !== hidden.right ||
          next.floor !== hidden.floor ||
          next.ceiling !== hidden.ceiling;
        Object.assign(hidden, next);
      }

      const motion = settings.cubeMotion;
      const isMoving = motion !== "none" && (settings.cubeMotionAmount > 0 || turning);
      if (isMoving || moving || changed) {
        previousOffset.set(faceOffset);
        placeCubes(clock.motion, motion);
        // How fast each face moved this frame: moving cubes push what touches them.
        for (let i = 0; i < faceOffset.length; i++) {
          faceVelocity[i] = isMoving && dt > 0 ? (faceOffset[i] - previousOffset[i]) / dt : 0;
        }
        moving = isMoving;
      }

      const mode = settings.cubeColourMode;
      const time = clock.colour;
      // At most 13 rad/s ≈ 2.1 Hz: below the three-flashes-a-second limit.
      const flickerTime = clock.flicker;
      palette.use(paletteFor(settings, mode));
      const n = palette.count;
      // The rainbow wave slides in and then back out: a triangle wave makes it
      // go back and forth instead of round and round.
      const tri = (time * 0.1) % 2;
      const sweep = tri < 1 ? tri : 2 - tri;
      const fract = (v: number) => ((v % 1) + 1) % 1;
      // Breathing: dim, full, dim, about every four seconds; the colour changes while dim.
      const breath = time * 1.6;
      const breathLevel = 0.5 - 0.5 * Math.cos(breath);
      const breathColour = Math.floor(breath / (2 * Math.PI));

      const glow = Math.max(0, settings.cubeGapGlow);

      /** Colours `target` for the spot `s`. `smooth` asks for a gradient (the glowing surfaces). */
      const paint = (target: THREE.Color, s: Spot, smooth: boolean): THREE.Color => {
        // Starlight and rain light single cubes; behind them, a dim drifting gradient instead.
        if (smooth && (mode === "starlight" || mode === "rain")) {
          return palette.loop(target, s.along * 0.4 + s.angle * 0.5 + time * 0.03).multiplyScalar(0.18);
        }
        switch (mode) {
          case "solid":
            palette.pick(target, 0);
            break;
          case "breathing":
            palette.pick(target, breathColour).multiplyScalar(0.08 + 0.92 * breathLevel * breathLevel);
            break;
          case "cycle":
            // The whole room fades from one colour to the next.
            palette.loop(target, time * 0.06);
            break;
          case "rainbow":
            palette.loop(target, s.along * 0.8 + sweep);
            break;
          case "spiral":
            // Around the room, twisting with depth and turning over time.
            palette.loop(target, s.angle + s.along * 0.35 - time * 0.08);
            break;
          case "rings": {
            // Rings that start at the back wall and travel out towards the viewer.
            const d = (1 - Math.min(1, s.along)) * 1.2 + s.radius * 0.35;
            const ring = fract(d - time * 0.35);
            const pulse = Math.pow(Math.max(0, 1 - Math.abs(ring - 0.5) * 4), 2);
            palette.loop(target, time * 0.05 + d * 0.25).multiplyScalar(0.08 + 0.92 * pulse);
            break;
          }
          case "starlight": {
            // Each cube flashes now and then in its own colour from the palette, on a dark field.
            const flash = Math.pow(Math.max(0, Math.sin(time * (0.6 + s.seed * 0.9) + s.seed * 40)), 12);
            palette.pick(target, fract(s.seed * 7.3) * n).multiplyScalar(0.04 + 0.96 * flash);
            break;
          }
          case "aurora": {
            // Slow overlapping waves, blending across the palette.
            const wave =
              0.5 * Math.sin(s.along * 3.1 + time * 0.45) + 0.5 * Math.sin(s.angle * 12.6 - time * 0.3 + s.fall * 2);
            const light = 0.6 + 0.4 * (0.5 + 0.5 * Math.sin(s.along * 5 - time * 0.7 + s.seed));
            palette.ramp(target, 0.5 + 0.5 * wave).multiplyScalar(light);
            break;
          }
          case "fire": {
            // Hottest colours at the bottom, cooler higher up, every cube flickering.
            const flicker =
              0.6 + 0.25 * Math.sin(flickerTime * 6 + s.seed * 50) + 0.15 * Math.sin(flickerTime * 13 + s.seed * 90);
            const heat = Math.min(1, Math.max(0, 1 - s.fall * 0.9) * flicker);
            palette.ramp(target, heat).multiplyScalar(0.35 + 0.65 * heat);
            break;
          }
          case "rain": {
            // Drops running down the walls (and across floor and ceiling towards you),
            // each with a bright head and a fading tail.
            const drop = fract(s.fall + time * (0.25 + 0.2 * s.seed) + s.seed * 3);
            const head = Math.pow(drop, 6);
            palette.pick(target, fract(s.seed * 5.7) * n).multiplyScalar(0.06 + 0.94 * head);
            break;
          }
        }
        return target;
      };
      paintFrame = paint;

      cubes.forEach((c, i) => {
        const k = cubeIndex[i];
        if (k >= 0) mesh.setColorAt(k, paint(colour, c, false));
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

      for (const surface of surfaces) {
        if (!surface.mesh.visible) continue;
        const array = surface.colours.array as Float32Array;
        surface.spots.forEach((spot, i) => {
          paint(colour, spot, true).multiplyScalar(glow);
          array[i * 3] = colour.r;
          array[i * 3 + 1] = colour.g;
          array[i * 3 + 2] = colour.b;
        });
        surface.colours.needsUpdate = true;
      }
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      mesh.dispose();
      surfaceMaterial.dispose();
      for (const surface of surfaces) surface.mesh.geometry.dispose();
    },
  };
  placeCubes(clock.motion, settings.cubeMotion);
  room.update(0);
  return room;
}

/** The position-dependent part of a travelling wave's angle at a spot. */
function wavePhase(s: Spot, motion: "ripple" | "rising" | "swirl"): number {
  switch (motion) {
    case "ripple":
      return -s.along * 7;
    case "rising":
      return -s.fall * 8;
    case "swirl":
      return -s.angle * 4 * Math.PI - s.along * 2;
  }
}

/** A vector with every component made positive. */
function abs(v: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
}

/** Small repeatable random number generator (mulberry32), so the layout is the same every time. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
