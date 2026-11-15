import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * A coral reef around the shipwreck. Rocky walls close in on the sides and
 * behind the wreck, ledges lean over from above, and coral grows on every
 * rock and across the sand, crowding the glass, so the view feels like a
 * sheltered cove. A sandy path runs down the middle to the wreck.
 */
export interface Reef {
  group: THREE.Group;
  /** Spheres the fish should swim around: centre and radius, in metres. */
  obstacles: { centre: THREE.Vector3; radius: number }[];
  /** `glow` 0 to 1 and `sway` 0 to 2 are read live. */
  update(timeS: number, glow: number, sway: number): void;
  dispose(): void;
}

export interface ReefSpace {
  /** Half width of the swimming area. */
  halfWidth: number;
  floorY: number;
  topY: number;
  depth: number;
  /** Size reference (the window's height), so pieces don't grow with the tank. */
  unit: number;
  groundAt(x: number, z: number): number;
}

export interface ReefOptions {
  /** How much rock, 0 to 2. */
  rocks: number;
  /** Rock height, 1 is normal. */
  rockHeight: number;
  /** How much the rocks close in around the scene: walls beyond the sides, behind the wreck, and ledges above. 0 to 1. */
  enclose: number;
  /** How much coral, 0 to 2. */
  coral: number;
  /** Circles on the floor (x, z, radius) kept free of coral and rocks, such as the view to the wreck's hole. */
  clear?: { x: number; z: number; r: number }[];
  /** Coral size, 1 is normal. */
  coralSize: number;
}

/** Rock tones, and the encrusting growth on rocks' upper faces. */
const ROCK_DARK = 0x4a3c42;
const ROCK_LIGHT = 0x7a6764;
const ENCRUST = [0xc0607e, 0x6f8f4f, 0x8a5fa0, 0xd08a50, 0x4f8f8a];

interface Rock {
  mesh: THREE.Mesh;
  /** Whether coral grows on top (ledges above get hanging coral underneath instead). */
  ledge: boolean;
  /** Footprint, for picking where coral grows. */
  w: number;
  d: number;
}

export function createReef(space: ReefSpace, options: ReefOptions, rand: () => number = mulberry(11)): Reef {
  const { halfWidth: hw, floorY, topY, depth, unit, groundAt } = space;
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const time = { value: 0 };
  const glow = { value: 0.5 };
  const swayAmount = { value: 1 };
  const obstacles: Reef["obstacles"] = [];
  const pick = <T,>(list: T[]) => list[Math.floor(rand() * list.length)];
  const rockAmount = Math.max(0, options.rocks);
  const enclose = THREE.MathUtils.clamp(options.enclose, 0, 1);
  const rockHeight = Math.max(0.1, options.rockHeight);
  const coralAmount = Math.max(0, options.coral);
  const coralSize = Math.max(0.2, options.coralSize);
  const isClear = (x: number, z: number) => (options.clear ?? []).some((c) => (x - c.x) ** 2 + (z - c.z) ** 2 < c.r * c.r);

  // ---------- Materials ----------
  /** A reef material: per-instance colour, a soft glow, and optional sway for soft corals. */
  const reefMaterial = (opts: { sway?: number; roughness?: number; pattern?: "brain" | "none"; side?: THREE.Side; map?: THREE.Texture }) => {
    const material = new THREE.MeshStandardMaterial({
      roughness: opts.roughness ?? 0.75,
      side: opts.side ?? THREE.FrontSide,
      map: opts.map ?? null,
      alphaTest: opts.map ? 0.5 : 0,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.uniforms.uGlow = glow;
      shader.uniforms.uSway = swayAmount;
      shader.vertexShader =
        `uniform float uTime;\nuniform float uSway;\nvarying vec3 vReef;\n` +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           vReef = position;
           ${
             opts.sway
               ? `float bend = max(0.0, position.y);
                  vec4 origin = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
                  float phase = origin.x * 37.0 + origin.z * 23.0;
                  float amount = uSway * bend * bend;
                  transformed.x += sin(uTime * 1.1 + phase + position.y * 2.0) * ${opts.sway.toFixed(3)} * amount;
                  transformed.z += cos(uTime * 0.9 + phase) * ${(opts.sway * 0.6).toFixed(3)} * amount;`
               : ""
           }`,
        );
      shader.fragmentShader =
        `uniform float uGlow;\nvarying vec3 vReef;\n` +
        shader.fragmentShader
          .replace(
            "#include <color_fragment>",
            `#include <color_fragment>
             ${
               opts.pattern === "brain"
                 ? `float groove = sin(vReef.x * 26.0 + sin(vReef.z * 21.0) * 2.5) * sin(vReef.z * 24.0 + sin(vReef.x * 17.0) * 2.0);
                    diffuseColor.rgb *= 0.65 + 0.35 * smoothstep(-0.2, 0.4, groove);`
                 : ""
             }`,
          )
          .replace(
            "#include <emissivemap_fragment>",
            `#include <emissivemap_fragment>
             #ifdef USE_INSTANCING_COLOR
               totalEmissiveRadiance += vColor.rgb * uGlow * 0.7;
             #endif`,
          );
    };
    return keep(material);
  };

  type Place = { p: THREE.Vector3; s: number; tilt?: number; colour: number; hang?: boolean };
  /** Places copies of a geometry: each placement gives position, scale, turn and colour. */
  const scatter = (geometry: THREE.BufferGeometry, material: THREE.Material, places: Place[]) => {
    keep(geometry);
    if (places.length === 0) return;
    const mesh = new THREE.InstancedMesh(geometry, material, places.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const c = new THREE.Color();
    const flip = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI);
    places.forEach((pl, i) => {
      q.setFromEuler(e.set((rand() - 0.5) * (pl.tilt ?? 0.3), rand() * Math.PI * 2, (rand() - 0.5) * (pl.tilt ?? 0.3)));
      // Hanging from the underside of a ledge.
      if (pl.hang) q.premultiply(flip);
      mesh.setMatrixAt(i, m.compose(pl.p, q, new THREE.Vector3(pl.s, pl.s, pl.s)));
      // A little variety within each colour.
      mesh.setColorAt(i, c.set(pl.colour).offsetHSL((rand() - 0.5) * 0.04, 0, (rand() - 0.5) * 0.1));
    });
    group.add(mesh);
  };

  // ---------- Rocks ----------
  const rockMaterial = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  const rocks: Rock[] = [];
  const dark = new THREE.Color(ROCK_DARK);
  const light = new THREE.Color(ROCK_LIGHT);
  /** A lumpy boulder of size w × h × d (half extents) centred at (x, y, z), mottled, with growth on its upper faces. */
  const addRock = (x: number, y: number, z: number, w: number, h: number, d: number, ledge = false) => {
    // Shared vertices, so the rock shades smoothly instead of in facets.
    const ico = new THREE.IcosahedronGeometry(1, 4);
    ico.deleteAttribute("normal");
    ico.deleteAttribute("uv");
    const g = keep(mergeVertices(ico));
    ico.dispose();
    const pos = g.getAttribute("position");
    const n = new THREE.Vector3();
    const seed = rand() * 10;
    const encrust = new THREE.Color(pick(ENCRUST));
    const colours: number[] = [];
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      n.fromBufferAttribute(pos, i);
      const bump =
        0.8 + 0.18 * Math.sin(n.x * 5 + n.y * 3 + seed) * Math.cos(n.z * 4 - n.y * 2) + 0.06 * Math.sin(n.x * 13 + n.z * 11 + seed);
      pos.setXYZ(i, n.x * bump, n.y * bump, n.z * bump);
      const mottle = 0.5 + 0.5 * Math.sin(n.x * 9 + seed) * Math.sin(n.z * 8 - n.y * 6);
      c.copy(dark).lerp(light, mottle * 0.8);
      const top = THREE.MathUtils.smoothstep(n.y, 0.15, 0.65) * (0.45 + 0.55 * Math.sin(n.x * 7 + n.z * 6 + seed * 2) ** 2);
      c.lerp(encrust, top * 0.75);
      if (n.y < -0.3) c.multiplyScalar(0.7);
      colours.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, rockMaterial);
    mesh.scale.set(w, h, d);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rand() * Math.PI;
    if (ledge) mesh.rotation.z = (x > 0 ? 1 : -1) * (0.15 + rand() * 0.2);
    mesh.updateMatrixWorld(true);
    group.add(mesh);
    rocks.push({ mesh, ledge, w, d });
    obstacles.push({ centre: mesh.position.clone(), radius: Math.min(w, h, d) * 0.9 + Math.max(0, Math.min(w, d) - h) * 0.2 });
  };
  /** A rock standing on the sand, h tall-ish. */
  const standing = (x: number, z: number, w: number, h: number, d: number) => addRock(x, groundAt(x, z) + h * 0.45, z, w, h, d);
  const count = (n: number) => Math.round(n);
  const height = topY - floorY;

  for (const side of [-1, 1]) {
    // Cliffs along the sides, rising towards the back, leaving a channel down the middle.
    const cliffs = count(6 * rockAmount);
    for (let i = 0; i < cliffs; i++) {
      const t = cliffs > 1 ? i / (cliffs - 1) : 0.5;
      const z = -depth * (0.18 + 0.78 * t) + (rand() - 0.5) * depth * 0.06;
      const x = side * hw * (0.85 + rand() * 0.2 - t * 0.1);
      const h = height * (0.18 + 0.3 * t + rand() * 0.1) * rockHeight;
      standing(x, z, unit * (0.28 + rand() * 0.18), h, unit * (0.25 + rand() * 0.15));
    }
    // Boulders near the glass for coral to grow on.
    for (let i = 0; i < count(2 * rockAmount); i++) {
      standing(side * hw * (0.45 + rand() * 0.5), -depth * (0.05 + rand() * 0.15), unit * (0.18 + rand() * 0.12), unit * (0.08 + rand() * 0.06) * rockHeight, unit * (0.15 + rand() * 0.08));
    }
    // Tall walls beyond the sides, closing the cove in.
    const walls = count(6 * rockAmount * enclose);
    for (let i = 0; i < walls; i++) {
      const t = walls > 1 ? i / (walls - 1) : 0.5;
      const x = side * (hw * 1.15 + rand() * hw * 0.4);
      const z = -depth * (0.05 + 1.05 * t);
      standing(x, z, unit * (0.4 + rand() * 0.25), height * (0.45 + rand() * 0.45) * rockHeight, unit * (0.35 + rand() * 0.2));
    }
    // Ledges leaning in from the walls high up, so the view feels sheltered.
    const ledges = count(3 * rockAmount * enclose);
    for (let i = 0; i < ledges; i++) {
      const z = -depth * (0.08 + rand() * 0.6);
      const x = side * hw * (0.85 + rand() * 0.3);
      addRock(x, topY - height * (0.12 + rand() * 0.2), z, unit * (0.35 + rand() * 0.2), unit * (0.12 + rand() * 0.1), unit * (0.3 + rand() * 0.15), true);
    }
  }
  // A wall behind the wreck, lower in the middle so open blue shows past it.
  const back = count(9 * rockAmount * enclose);
  for (let i = 0; i < back; i++) {
    const t = back > 1 ? i / (back - 1) : 0.5;
    const x = (t * 2 - 1) * hw * 1.8 + (rand() - 0.5) * hw * 0.2;
    const z = -depth * (1.05 + rand() * 0.25);
    const middle = Math.min(1, Math.abs(x) / hw);
    standing(x, z, unit * (0.45 + rand() * 0.25), height * (0.3 + 0.55 * middle + rand() * 0.2) * rockHeight, unit * (0.35 + rand() * 0.2));
  }

  // ---------- Where coral grows ----------
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const upward = new THREE.Vector3(0, 1, 0);
  const growable = rocks.filter((r) => !r.ledge);
  const ledges = rocks.filter((r) => r.ledge);
  /** A random rock, bigger ones more often. */
  const pickRock = (list: Rock[]) => {
    let total = 0;
    for (const r of list) total += r.w * r.d;
    let k = rand() * total;
    for (const r of list) if ((k -= r.w * r.d) <= 0) return r;
    return list[list.length - 1];
  };
  /** A point on the upper face of some rock, found by dropping a ray onto it. */
  const onRock = (): THREE.Vector3 | null => {
    if (growable.length === 0) return null;
    for (let tries = 0; tries < 8; tries++) {
      const r = pickRock(growable);
      const p = r.mesh.position;
      ray.set(new THREE.Vector3(p.x + (rand() - 0.5) * 1.5 * r.w, topY + height * 2, p.z + (rand() - 0.5) * 1.5 * r.d), down);
      const hit = ray.intersectObject(r.mesh)[0];
      if (!hit?.face) continue;
      const n = hit.face.normal.clone().transformDirection(r.mesh.matrixWorld);
      if (n.y < 0.45 || hit.point.z > -depth * 0.02 || isClear(hit.point.x, hit.point.z)) continue;
      return hit.point.addScaledVector(n, -unit * 0.008);
    }
    return null;
  };
  /** A point on the underside of a ledge, for hanging coral. */
  const underLedge = (): THREE.Vector3 | null => {
    if (ledges.length === 0) return null;
    for (let tries = 0; tries < 8; tries++) {
      const r = pickRock(ledges);
      const p = r.mesh.position;
      ray.set(new THREE.Vector3(p.x + (rand() - 0.5) * 1.4 * r.w, floorY - height, p.z + (rand() - 0.5) * 1.4 * r.d), upward);
      const hit = ray.intersectObject(r.mesh)[0];
      if (hit) return hit.point.addScaledVector(upward, unit * 0.008);
    }
    return null;
  };
  /** Points on the sand: mostly near the glass and the sides, leaving the middle path open. */
  const onSand = (nearGlass: boolean) => {
    for (let tries = 0; tries < 20; tries++) {
      const z = nearGlass ? -depth * (0.03 + rand() * 0.22) : -depth * (0.05 + rand() * 1.1);
      const x = (rand() * 2 - 1) * hw * (nearGlass ? 1.05 : 1.4);
      // The sandy path: an open band down the middle that widens towards the back.
      const path = hw * (0.18 + 0.12 * (-z / depth));
      if (Math.abs(x) < path && !(nearGlass && rand() < 0.25)) continue;
      if (isClear(x, z)) continue;
      return new THREE.Vector3(x, groundAt(x, z), z);
    }
    return new THREE.Vector3(hw, groundAt(hw, -depth * 0.2), -depth * 0.2);
  };

  // ---------- Coral shapes ----------
  /** A branching coral: a trunk splitting into ever thinner branches with rounded tips. Unit height ~1. */
  const branching = (seed: number) => {
    const r = mulberry(seed);
    const parts: THREE.BufferGeometry[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const grow = (from: THREE.Vector3, dir: THREE.Vector3, length: number, radius: number, level: number) => {
      const g = new THREE.CylinderGeometry(radius * 0.7, radius, length, 6);
      g.translate(0, length / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
      g.translate(from.x, from.y, from.z);
      parts.push(g);
      const end = from.clone().addScaledVector(dir, length);
      if (level === 0) {
        const tip = new THREE.SphereGeometry(radius * 1.15, 8, 6);
        tip.translate(end.x, end.y, end.z);
        parts.push(tip);
        return;
      }
      const branches = 2 + Math.floor(r() * 2);
      for (let b = 0; b < branches; b++) {
        const next = dir
          .clone()
          .applyAxisAngle(new THREE.Vector3(1, 0, 0), (r() - 0.5) * 1.1)
          .applyAxisAngle(new THREE.Vector3(0, 0, 1), (r() - 0.5) * 1.1)
          .lerp(up, 0.25)
          .normalize();
        grow(end, next, length * (0.65 + r() * 0.15), radius * 0.7, level - 1);
      }
    };
    grow(new THREE.Vector3(), up, 0.3, 0.085, 3);
    const merged = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)).map(stripUv))!;
    parts.forEach((p) => p.dispose());
    return merged;
  };

  /** A cluster of open tube sponges. */
  const tubes = () => {
    const parts: THREE.BufferGeometry[] = [];
    const r = mulberry(5);
    for (let i = 0; i < 5; i++) {
      const h = 0.35 + r() * 0.6;
      const rad = 0.06 + r() * 0.05;
      const g = new THREE.CylinderGeometry(rad * 1.15, rad, h, 12, 1, true);
      g.translate((r() - 0.5) * 0.25, h / 2, (r() - 0.5) * 0.25);
      parts.push(g);
    }
    return mergeGeometries(parts.map((p) => stripUv(p.toNonIndexed())))!;
  };

  /** An anemone: a short stalk crowned with soft tentacles that sway. */
  const anemone = () => {
    const parts: THREE.BufferGeometry[] = [stripUv(new THREE.CylinderGeometry(0.16, 0.2, 0.15, 12).translate(0, 0.075, 0).toNonIndexed())];
    const r = mulberry(9);
    for (let i = 0; i < 46; i++) {
      const a = r() * Math.PI * 2;
      const rr = Math.sqrt(r()) * 0.15;
      const g = new THREE.ConeGeometry(0.014, 0.3 + r() * 0.15, 5);
      g.translate(0, 0.15, 0);
      g.applyQuaternion(
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.cos(a) * rr * 3, 1, Math.sin(a) * rr * 3).normalize()),
      );
      g.translate(Math.cos(a) * rr, 0.15, Math.sin(a) * rr);
      parts.push(stripUv(g.toNonIndexed()));
    }
    return mergeGeometries(parts)!;
  };

  /** A plate (table) coral on a short stalk. */
  const plate = () => {
    const top = new THREE.CylinderGeometry(0.5, 0.42, 0.06, 20, 1);
    top.translate(0, 0.32, 0);
    const stalk = new THREE.CylinderGeometry(0.07, 0.12, 0.32, 8);
    stalk.translate(0, 0.16, 0);
    return mergeGeometries([stripUv(top.toNonIndexed()), stripUv(stalk.toNonIndexed())])!;
  };

  /** A brain coral: a low dome (its grooves come from the material). */
  const brain = () => new THREE.SphereGeometry(0.5, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.65, 1);

  /** A five-armed starfish, flat. */
  const starfish = () => {
    const shape = new THREE.Shape();
    for (let i = 0; i <= 10; i++) {
      const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
      const r = i % 2 === 0 ? 0.5 : 0.2;
      if (i === 0) shape.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else shape.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.04, bevelSegments: 2 });
    g.rotateX(-Math.PI / 2);
    return g;
  };

  // ---------- Placing the reef ----------
  const solid = reefMaterial({ roughness: 0.7 });
  const soft = reefMaterial({ roughness: 0.8, sway: 0.08 });
  const spongy = reefMaterial({ roughness: 0.9, side: THREE.DoubleSide });
  const brainy = reefMaterial({ roughness: 0.85, pattern: "brain" });

  const place = (n: number, where: () => THREE.Vector3 | null, size: [number, number], colours: number[], tilt = 0.3, hang = false): Place[] => {
    const places: Place[] = [];
    for (let i = 0; i < count(n * coralAmount); i++) {
      const p = where();
      if (!p) continue;
      places.push({ p, s: unit * coralSize * (size[0] + rand() * (size[1] - size[0])), colour: pick(colours), tilt, hang });
    }
    return places;
  };
  // About half on the rocks (when there are any), the rest on the sand, many of those near the glass.
  const anywhere = (nearShare: number) => () => (rand() < 0.5 ? onRock() : null) ?? onSand(rand() < nearShare);

  for (let v = 0; v < 3; v++) {
    scatter(branching(100 + v), solid, place(28, anywhere(0.55), [0.22, 0.42], [0xff8a3d, 0xffc93d, 0xff5f8f, 0xff7ac6, 0x4fb6ff]));
  }
  scatter(brain(), brainy, place(26, anywhere(0.55), [0.16, 0.32], [0x5fd06f, 0x9b5cff, 0xffc93d, 0x2fe0c4], 0.2));
  scatter(tubes(), spongy, place(20, anywhere(0.5), [0.2, 0.36], [0x9b5cff, 0xff8a3d, 0xe5484d, 0xffc93d]));
  scatter(anemone(), soft, place(32, anywhere(0.65), [0.16, 0.3], [0xff7ac6, 0xb98cff, 0x2fe0c4, 0xff8a3d], 0.15));
  scatter(plate(), solid, place(18, onRock, [0.22, 0.4], [0x2fe0c4, 0xffc93d, 0x9b5cff, 0x5fd06f], 0.25));
  scatter(starfish(), solid, place(12, anywhere(0.8), [0.05, 0.09], [0xff8a3d, 0xe5484d, 0xffc93d, 0xff5f8f], 0.15));

  // Sea fans: flat lacy fans standing upright, swaying; some hang from the ledges.
  const fanTexture = keep(new THREE.CanvasTexture(drawFan(rand)));
  fanTexture.colorSpace = THREE.SRGBColorSpace;
  const fanGeometry = new THREE.PlaneGeometry(1, 1, 8, 8);
  fanGeometry.translate(0, 0.5, 0);
  const fans = reefMaterial({ roughness: 0.8, sway: 0.06, side: THREE.DoubleSide, map: fanTexture });
  const fanColours = [0xc455ff, 0xff4f7b, 0xff8a3d, 0xffd24d];
  scatter(fanGeometry, fans, [
    ...place(20, anywhere(0.45), [0.3, 0.55], fanColours, 0.2),
    ...place(10, underLedge, [0.2, 0.4], fanColours, 0.3, true),
  ]);
  // Soft coral dangling under the ledges.
  scatter(anemone(), soft, place(14, underLedge, [0.14, 0.26], [0xff7ac6, 0xffc93d, 0x2fe0c4], 0.3, true));

  return {
    group,
    obstacles,
    update(timeS, glowAmount, sway) {
      time.value = timeS;
      glow.value = glowAmount;
      swayAmount.value = sway;
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/** Removes UVs so differently made shapes can be merged. */
function stripUv(g: THREE.BufferGeometry): THREE.BufferGeometry {
  if (g.getAttribute("uv")) g.deleteAttribute("uv");
  return g;
}

/** A sea fan: fine branching veins on a transparent background, white so instance colour tints it. */
function drawFan(rand: () => number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.strokeStyle = "#ffffff";
  g.lineCap = "round";
  const branch = (x: number, y: number, angle: number, length: number, width: number, level: number) => {
    const x2 = x + Math.cos(angle) * length;
    const y2 = y - Math.sin(angle) * length;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x2, y2);
    g.stroke();
    if (level === 0) return;
    branch(x2, y2, angle + 0.35 + rand() * 0.2, length * 0.78, width * 0.75, level - 1);
    branch(x2, y2, angle - 0.35 - rand() * 0.2, length * 0.78, width * 0.75, level - 1);
  };
  branch(128, 256, Math.PI / 2, 60, 7, 6);
  // Cross-links make it a fan rather than a tree.
  g.lineWidth = 1.2;
  for (let i = 0; i < 260; i++) {
    const a = Math.PI * (0.15 + rand() * 0.7);
    const r = 40 + rand() * 190;
    const x = 128 + Math.cos(a) * r;
    const y = 256 - Math.sin(a) * r;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 14, y + (rand() - 0.5) * 14);
    g.stroke();
  }
  return c;
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
