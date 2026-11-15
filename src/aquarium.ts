import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { Room } from "./rooms";
import { createShipwreck } from "./shipwreck";
import { createReef } from "./reef";

export type WaterStyle = "tropical" | "ocean" | "lake";

export type AquaScene = "wreck" | "tank";

export const AQUA_SCENES: { id: AquaScene; name: string }[] = [
  { id: "wreck", name: "Shipwreck" },
  { id: "tank", name: "Fish tank" },
];

export const WATER_STYLES: { id: WaterStyle; name: string }[] = [
  { id: "tropical", name: "Tropical" },
  { id: "ocean", name: "Deep ocean" },
  { id: "lake", name: "Lake" },
];

export interface AquariumSettings {
  /** Number of fish, 0 to MAX_FISH. */
  fishCount: number;
  /** How keen the fish are to come and look at you, 0 to 1. */
  fishCuriosity: number;
  /** How easily a quick head movement scares them, 0 to 1. */
  fishStartle: number;
  /** Depth of the tank behind the glass, as a multiple of the window width. */
  tankDepth: number;
  /** Tank width as a multiple of the window's: above 1 the tank carries on past the screen's edges. */
  tankWidth: number;
  /** Tank height as a multiple of the window's. */
  tankHeight: number;
  /** Fish size, 1 is normal. */
  fishSize: number;
  /** Swimming speed, 1 is normal. */
  fishSpeed: number;
  /** How strongly fish keep together with their own kind: 0 loners, 1 normal, 2 tight schools. */
  fishSchooling: number;
  /** How restless their paths are: 0 calm and straight, 1 normal, 2 darting about. */
  fishWander: number;
  /** How sharply they turn: below 1 lazy and wide, above 1 nimble. */
  fishAgility: number;
  tankBubbles: boolean;
  tankLightRays: boolean;
  water: WaterStyle;
  /** A pirate shipwreck in the open ocean, or a glass fish tank. */
  aquaScene: AquaScene;
  /** How deep down it feels: 0 bright shallows, 1 dim and cosy, with the coral glowing. */
  waterDeep: number;
  /** Tiny glowing specks drifting in the water. */
  tankPlankton: boolean;
  /** Shipwreck size, 1 is normal. */
  shipSize: number;
  /** Reef: how much rock, 0 to 2. */
  reefRocks: number;
  /** Reef: rock height, 1 is normal. */
  reefRockHeight: number;
  /** Reef: how much the rocks close in around the scene, 0 to 1. */
  reefEnclose: number;
  /** Reef: how much coral, 0 to 2. */
  reefCoral: number;
  /** Reef: coral size, 1 is normal. */
  reefCoralSize: number;
  /** Reef: how much the coral glows, 0 to 1. */
  reefGlow: number;
  /** Reef: how much soft coral sways, 0 to 2. */
  reefSway: number;
  /** How often fish go in and out of the wreck, 0 to 1. */
  fishExplore: number;
  /** Light patterns on the sand and surface: brightness, 0 to 2. */
  causticStrength: number;
  /** Size of the pattern, 1 is normal. */
  causticSize: number;
  /** Soft wide bands (0) to thin crisp lines (1). */
  causticSharpness: number;
  /** How fast it moves, 1 is normal. */
  causticSpeed: number;
  /** How much of the finer second net shows, 0 to 1. */
  causticDetail: number;
  /** How much the lines curve, 0 to 1. */
  causticCurve: number;
  /** Wreck sails: how much is torn away, 0 to 1. */
  sailTears: number;
  /** Size of the holes in the sails, 1 is normal. */
  sailTearSize: number;
  /** Raggedness of the tears, 0 to 1. */
  sailTearDetail: number;
  /** How shredded the sails' bottom edges are, 0 to 1. */
  sailFray: number;
  /** Long slashes down the sails, 0 to 1. */
  sailRips: number;
  /** Stains, rot and algae on the sails, 0 to 1. */
  sailWear: number;
  /** How much the sails sway, 0 to 2. */
  sailSway: number;
  /** Which pattern of tears. */
  sailPattern: number;
}

export const AQUARIUM_DEFAULTS: AquariumSettings = {
  fishCount: 36,
  fishCuriosity: 0.6,
  fishStartle: 0.5,
  tankDepth: 1.6,
  tankWidth: 1,
  tankHeight: 1,
  fishSize: 1,
  fishSpeed: 1,
  fishSchooling: 1,
  fishWander: 1,
  fishAgility: 1,
  tankBubbles: true,
  tankLightRays: true,
  water: "tropical",
  aquaScene: "wreck",
  waterDeep: 0.5,
  tankPlankton: true,
  shipSize: 1,
  reefRocks: 1,
  reefRockHeight: 1,
  reefEnclose: 0.7,
  reefCoral: 1,
  reefCoralSize: 1,
  reefGlow: 0.5,
  reefSway: 1,
  fishExplore: 0.5,
  causticStrength: 1,
  causticSize: 1,
  causticSharpness: 0.35,
  causticSpeed: 1,
  causticDetail: 0.2,
  causticCurve: 0.7,
  sailTears: 0.4,
  sailTearSize: 1,
  sailTearDetail: 0.6,
  sailFray: 0.35,
  sailRips: 0.4,
  sailWear: 0.55,
  sailSway: 1,
  sailPattern: 0,
};

export const MAX_FISH = 120;

/** Colours of each kind of water. */
const WATER: Record<WaterStyle, { haze: number; top: number; deep: number; sand: number; light: number; kelp: number }> = {
  tropical: { haze: 0x1386a0, top: 0x7fe3f0, deep: 0x0a5470, sand: 0xe8d5a6, light: 0xdffcff, kelp: 0x3f8f4a },
  ocean: { haze: 0x05213f, top: 0x1a6aa0, deep: 0x020b1c, sand: 0x8d8b7e, light: 0xa6d3ff, kelp: 0x2f5f4a },
  lake: { haze: 0x23402d, top: 0x5a8a5e, deep: 0x0d1c12, sand: 0x6f6248, light: 0xe8ffd2, kelp: 0x5a7a2e },
};

/** The kinds of fish. Lengths are shares of the window's height; `share` is each kind's part of the count. */
const SPECIES = [
  // Orange with white bands, solitary-ish
  { share: 0.16, length: 0.12, colour: 0xff7a1a, accent: 0xffffff, stripes: 3, cruise: 0.8, school: 0.35 },
  // Blue with a yellow tail and fins
  { share: 0.15, length: 0.15, colour: 0x2a5cff, accent: 0xffd21f, stripes: 0, cruise: 0.9, school: 0.55 },
  // Bright yellow, loose groups
  { share: 0.17, length: 0.1, colour: 0xffd02a, accent: 0xfff3c2, stripes: 0, cruise: 1, school: 0.7 },
  // Pink and gold, darting in a loose cloud above the coral
  { share: 0.2, length: 0.07, colour: 0xff5fa8, accent: 0xffc53d, stripes: 0, cruise: 1.1, school: 0.85 },
  // Small silver fish in a tight school
  { share: 0.32, length: 0.065, colour: 0xc8d6e4, accent: 0x5a7a98, stripes: 0, cruise: 1.3, school: 1 },
];

interface Fish {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** How much this fish personally likes to come and look, 0.3 to 1. */
  curiosity: number;
  /** Fades from 1 after a scare. */
  fear: number;
  /** Tail-beat phase, advanced by swimming speed. */
  tail: number;
  /** A slowly turning wander direction. */
  wander: THREE.Vector3;
  /** Inside the wreck's hull. */
  inside: boolean;
  /** A trip into the wreck: 0 none, 1 to the hole, 2 in, 3 looking around, 4 back to the hole, 5 out. */
  visit: number;
  /** Where the trip is heading, in the ship's own units; and seconds left looking around. */
  visitTarget: THREE.Vector3;
  visitTime: number;
}

// ---------- Fish shape ----------

/** One fish, 1 long along +x (nose at +0.55), with a part number per vertex: 0 body, 1 fins, 2 eyes. */
function fishGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const tag = (g: THREE.BufferGeometry, part: number) => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute("uv");
    if (!ng.getAttribute("normal")) ng.computeVertexNormals();
    ng.setAttribute("aPart", new THREE.Float32BufferAttribute(new Array(ng.getAttribute("position").count).fill(part), 1));
    parts.push(ng);
  };
  const body = new THREE.SphereGeometry(0.5, 18, 12);
  body.scale(1, 0.42, 0.2);
  body.translate(0.05, 0, 0);
  tag(body, 0);

  const triangles = (points: number[]) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(points, 3));
    g.computeVertexNormals();
    return g;
  };
  // A forked tail and a dorsal fin.
  tag(triangles([-0.4, 0, 0, -0.74, 0.24, 0, -0.62, 0, 0, -0.4, 0, 0, -0.62, 0, 0, -0.74, -0.24, 0]), 1);
  tag(triangles([0.18, 0.17, 0, -0.18, 0.32, 0, -0.22, 0.13, 0]), 1);
  // Two small pectoral fins.
  tag(triangles([0.12, -0.06, 0.09, -0.04, -0.14, 0.17, -0.02, -0.04, 0.1]), 1);
  tag(triangles([0.12, -0.06, -0.09, -0.02, -0.04, -0.1, -0.04, -0.14, -0.17]), 1);
  for (const side of [1, -1]) {
    const eye = new THREE.SphereGeometry(0.045, 8, 6);
    eye.translate(0.36, 0.05, 0.08 * side);
    tag(eye, 2);
  }
  return mergeGeometries(parts)!;
}

/** Fish material: shading by body part, a light belly, a dark back, optional bands, and a wagging tail. */
function fishMaterial(accent: number, stripes: number, time: { value: number }): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.15, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.uniforms.uAccent = { value: new THREE.Color(accent) };
    shader.uniforms.uStripes = { value: stripes };
    shader.vertexShader =
      `attribute float aPart;
       attribute float aTail;
       uniform float uTime;
       varying vec3 vLocal;
       varying float vPart;
      ` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         // The tail end sways more than the head.
         float behind = max(0.0, 0.3 - position.x);
         transformed.z += sin(aTail + position.x * 4.0) * 0.22 * behind * behind;
         vLocal = position;
         vPart = aPart;`,
      );
    shader.fragmentShader =
      `uniform vec3 uAccent;
       uniform float uStripes;
       varying vec3 vLocal;
       varying float vPart;
      ` +
      shader.fragmentShader.replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         vec3 base = diffuseColor.rgb;
         float back = smoothstep(0.02, 0.17, vLocal.y);
         float belly = smoothstep(0.0, -0.15, vLocal.y);
         vec3 c = mix(base, base * 0.5, back * 0.7);
         c = mix(c, mix(base, vec3(1.0), 0.65), belly * 0.75);
         if (uStripes > 0.5) {
           float band = abs(fract((vLocal.x + 0.55) * uStripes / 1.3) - 0.5);
           c = mix(c, uAccent, smoothstep(0.13, 0.09, band));
           c = mix(c, vec3(0.04), (smoothstep(0.17, 0.13, band) - smoothstep(0.13, 0.09, band)) * 0.85);
         }
         if (vPart > 0.5 && vPart < 1.5) c = mix(base, uAccent, 0.6);
         if (vPart > 1.5) c = vec3(0.02);
         diffuseColor.rgb = c;`,
      );
  };
  return material;
}

// ---------- Water effects ----------

/**
 * Sunlight focused by the waves into a net of soft, curving bands of light.
 * The bands are the edges of drifting cells, bent by a slow swirl so they
 * curve smoothly, with an optional finer second net on top, and broad, slow
 * swells of brighter and dimmer light. In the distance the bands blend into
 * an even glow instead of flickering. All the look is set by uniforms, so it
 * can be changed live.
 */
const CAUSTIC_GLSL = /* glsl */ `
  uniform float uCauTime, uCauSize, uCauSharp, uCauDetail, uCauWarp, uCauStrength;
  vec2 cauHash(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
  }
  float cauNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
    float a = cauHash(i).x, b = cauHash(i + vec2(1.0, 0.0)).x;
    float c = cauHash(i + vec2(0.0, 1.0)).x, d = cauHash(i + vec2(1.0, 1.0)).x;
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  // Distance between the nearest and second-nearest wandering cell centres: 0 on cell edges.
  float cauCells(vec2 p, float t) {
    vec2 i = floor(p), f = fract(p);
    float f1 = 8.0, f2 = 8.0;
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec2 g = vec2(float(x), float(y));
        vec2 h = cauHash(i + g);
        vec2 o = 0.5 + 0.4 * sin(t * (0.5 + 0.4 * h) + 6.2831 * h.yx);
        float d = length(g + o - f);
        if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
      }
    }
    return f2 - f1;
  }
  float caustic(vec2 p) {
    float t = uCauTime;
    p *= 0.22 / uCauSize;
    float blur = clamp(length(fwidth(p)) * 2.5, 0.0, 1.0);
    // A slow swirl plus slow noise bends the straight cell edges into smooth curves.
    vec2 bend = vec2(
      sin(p.y * 0.8 + t * 0.23 + sin(p.x * 0.5 - t * 0.1)),
      sin(p.x * 0.7 - t * 0.19 + sin(p.y * 0.6 + t * 0.12))
    );
    bend += (vec2(cauNoise(p * 0.3 + t * 0.05), cauNoise(p * 0.3 - t * 0.04 + 17.3)) - 0.5) * 2.0;
    vec2 q = p + bend * uCauWarp * 0.55;
    float w = mix(0.22, 0.04, uCauSharp) + blur * 0.25;
    float a = cauCells(q + vec2(t * 0.06, t * 0.03), t * 0.7) / w;
    float la = exp(-a * a);
    float c = la;
    if (uCauDetail > 0.001) {
      float b = cauCells(q * 1.7 + vec2(-t * 0.05, t * 0.07) + 5.2, t * 0.8) / (w * 0.8);
      float lb = exp(-b * b);
      c += uCauDetail * (lb * 0.6 + la * lb * 0.8);
    }
    // Broad, slow swells of brighter and dimmer light.
    float swell = cauNoise(p * 0.1 + vec2(t * 0.025, -t * 0.018));
    c *= 0.45 + smoothstep(0.15, 0.85, swell);
    return mix(c, 0.3, blur) * uCauStrength;
  }
`;

/**
 * A fish tank behind the glass. Fish school with their own kind, swim up to
 * where your head is to look at you, and dart away if you move suddenly.
 * Kelp sways, bubbles rise, sunlight ripples over the sand, and the water
 * hazes into the distance.
 */
export function createAquarium(windowWidth: number, windowHeight: number, settings: AquariumSettings): Room {
  const group = new THREE.Group();
  // Fish and scenery are sized by the window, so a bigger tank means more
  // water rather than bigger fish.
  const unit = windowHeight;
  // The tank can be bigger than the window: the screen is then a porthole
  // into it, and leaning shows more. It stays centred sideways, and grows
  // mostly upwards so the floor stays near the bottom of the screen.
  const width = windowWidth * Math.max(1, settings.tankWidth);
  const height = windowHeight * Math.max(1, settings.tankHeight);
  const hw = width / 2;
  const floorY = -windowHeight / 2 - (height - windowHeight) * 0.3;
  const topY = floorY + height;
  const midY = (floorY + topY) / 2;
  const depth = windowWidth * settings.tankDepth;
  const baseWater = WATER[settings.water] ?? WATER.tropical;
  // Deeper water is darker and bluer; the coral's own glow carries the colour.
  const deep = THREE.MathUtils.clamp(settings.waterDeep, 0, 1);
  const deepen = (c: number, to: number, k: number) => new THREE.Color(c).lerp(new THREE.Color(to), k).getHex();
  const water = {
    ...baseWater,
    haze: deepen(baseWater.haze, 0x031824, deep * 0.9),
    top: deepen(baseWater.top, 0x14566e, deep * 0.8),
    deep: deepen(baseWater.deep, 0x020a12, deep * 0.7),
    light: deepen(baseWater.light, 0x9fd8e8, deep * 0.5),
    sand: deepen(baseWater.sand, 0x5f7378, deep * 0.45),
  };
  const lightLevel = 1 - 0.6 * deep;
  const time = { value: 0 };
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const random = Math.random;

  // ---------- Light ----------
  group.add(new THREE.HemisphereLight(water.light, water.deep, 1.6 * lightLevel));
  const sun = new THREE.DirectionalLight(water.light, 1.4 * lightLevel);
  sun.position.set(-0.6, 1, 0.3);
  group.add(sun);

  // ---------- Walls and water surface ----------
  // A vertical gradient from the bright water near the surface to the deep below.
  const gradientWall = (w: number, h: number, darken: number) => {
    const g = keep(new THREE.PlaneGeometry(w, h, 1, 8));
    const colours: number[] = [];
    const top = new THREE.Color(water.top).multiplyScalar(darken);
    const deep = new THREE.Color(water.deep).multiplyScalar(darken);
    const c = new THREE.Color();
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / h + 0.5;
      c.copy(deep).lerp(top, t * t);
      colours.push(c.r, c.g, c.b);
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
    return new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ vertexColors: true })));
  };
  // The shipwreck lies in open ocean: no tank walls, and the seabed and
  // surface run on into the haze. The fish tank has glass walls.
  const openOcean = settings.aquaScene !== "tank";
  if (!openOcean) {
    const back = gradientWall(width, height, 1);
    back.position.set(0, midY, -depth);
    group.add(back);
    for (const side of [-1, 1]) {
      const wall = gradientWall(depth, height, 0.8);
      wall.rotation.y = side * -Math.PI / 2;
      wall.position.set(side * hw, midY, -depth / 2);
      group.add(wall);
    }
  }
  // How far the seabed and the surface reach: far beyond the swimming area in open ocean.
  const floorWidth = openOcean ? width * 6 : width;
  const floorDepth = openOcean ? depth * 3 : depth;

  // The underside of the water surface, shimmering.
  // It fades into the water haze with distance like everything else, so in
  // open ocean it has no visible far edge.
  // The light patterns' settings, shared by the sand and the surface and set every frame.
  const causticUniforms = {
    uCauTime: { value: 0 },
    uCauSize: { value: 1 },
    uCauSharp: { value: 0.5 },
    uCauDetail: { value: 0.3 },
    uCauWarp: { value: 0.6 },
    uCauStrength: { value: 1 },
  };
  const surfaceUniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTop: { value: new THREE.Color(water.top) },
      uLight: { value: new THREE.Color(water.light).multiplyScalar(0.4 + 0.6 * lightLevel) },
      uScale: { value: 40 / unit },
    },
  ]);
  surfaceUniforms.uTime = time; // shared, so it animates with everything else
  Object.assign(surfaceUniforms, causticUniforms);
  const surfaceMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: surfaceUniforms,
      fog: true,
      vertexShader: `
        #include <fog_pars_vertex>
        varying vec2 vP;
        void main(){
          vP = (modelMatrix * vec4(position, 1.0)).xz;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `${CAUSTIC_GLSL}
        #include <fog_pars_fragment>
        uniform float uTime; uniform vec3 uTop; uniform vec3 uLight; uniform float uScale; varying vec2 vP;
        void main(){
          float c = caustic(vP * uScale);
          gl_FragColor = vec4(mix(uTop, uLight, 0.25 + 0.6 * c), 1.0);
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
      side: THREE.DoubleSide,
    }),
  );
  const surface = new THREE.Mesh(keep(new THREE.PlaneGeometry(floorWidth, floorDepth)), surfaceMaterial);
  surface.rotation.x = Math.PI / 2;
  surface.position.set(0, topY, -floorDepth / 2);
  group.add(surface);

  // ---------- Sand ----------
  // Gentle dunes, rising towards the back so the far floor shows from the front.
  const sandHeight = (x: number, z: number) =>
    0.035 * unit * (Math.sin(x * (9 / unit)) + Math.sin(z * (6 / unit) + x * (4 / unit))) +
    0.14 * unit * Math.min(1, -z / depth);
  const sandGeometry = keep(new THREE.PlaneGeometry(floorWidth, floorDepth, openOcean ? 120 : 48, openOcean ? 96 : 48));
  sandGeometry.rotateX(-Math.PI / 2);
  sandGeometry.translate(0, 0, -floorDepth / 2);
  {
    const pos = sandGeometry.getAttribute("position");
    for (let i = 0; i < pos.count; i++) pos.setY(i, floorY + sandHeight(pos.getX(i), pos.getZ(i)));
    sandGeometry.computeVertexNormals();
  }
  const sandMaterial = keep(new THREE.MeshStandardMaterial({ color: water.sand, roughness: 1 }));
  sandMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    Object.assign(shader.uniforms, causticUniforms);
    shader.uniforms.uLight = { value: new THREE.Color(water.light) };
    shader.uniforms.uScale = { value: 30 / unit };
    shader.vertexShader =
      `varying vec2 vSand;\n` +
      shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n vSand = (modelMatrix * vec4(transformed, 1.0)).xz;`);
    shader.fragmentShader =
      `${CAUSTIC_GLSL}\nuniform float uTime; uniform vec3 uLight; uniform float uScale; varying vec2 vSand;\n` +
      shader.fragmentShader.replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>\n totalEmissiveRadiance += uLight * caustic(vSand * uScale) * ${(0.45 * lightLevel).toFixed(3)};`,
      );
  };
  group.add(new THREE.Mesh(sandGeometry, sandMaterial));
  /** The sand's surface height at (x, z), for keeping fish off the floor. */
  const groundAt = (x: number, z: number) => floorY + sandHeight(x, z);

  // ---------- Rocks ----------
  const rockMaterial = keep(new THREE.MeshStandardMaterial({ color: 0x5f5a52, roughness: 0.95, flatShading: true }));
  const rockSpots: [number, number, number][] = [
    [-0.7, -0.75, 0.22],
    [-0.45, -0.9, 0.14],
    [0.6, -0.8, 0.2],
    [0.78, -0.55, 0.12],
    [0.15, -0.95, 0.16],
  ];
  for (const [fx, fz, size] of openOcean ? [] : rockSpots) {
    const g = keep(new THREE.IcosahedronGeometry(1, 1));
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      const s = 0.8 + random() * 0.35;
      pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s, pos.getZ(i) * s);
    }
    g.computeVertexNormals();
    const rock = new THREE.Mesh(g, rockMaterial);
    const x = fx * hw;
    const z = fz * depth;
    rock.scale.set(size * unit, size * unit * 0.55, size * unit * 0.9);
    rock.position.set(x, groundAt(x, z) + size * unit * 0.15, z);
    rock.rotation.y = random() * Math.PI;
    group.add(rock);
  }

  // ---------- Shipwreck ----------
  // The ship lies across the middle of the view, rolled onto its side towards
  // you so the deck shows, and half sunk in the sand.
  const ship = openOcean ? createShipwreck() : null;
  /** Spheres for the fish to swim around: world centre and radius; `hull` ones can be passed through the hole. */
  const obstacles: { centre: THREE.Vector3; radius: number; hull?: boolean }[] = [];
  const shipLength = Math.min(windowWidth * 1.1, depth * 0.8) * Math.max(0.3, settings.shipSize);
  const shipInverse = new THREE.Matrix4();
  if (ship) {
    // Upright on its keel, turned so the torn side with the hole faces you.
    const cz = -depth * 0.8;
    ship.group.scale.setScalar(shipLength);
    ship.group.rotation.order = "YXZ";
    ship.group.rotation.set(0.04, 0.5, -0.03);
    ship.group.position.set(windowWidth * 0.04, groundAt(0, cz) + 0.22 * shipLength, cz);
    group.add(ship.group);
    ship.group.updateMatrixWorld(true);
    shipInverse.copy(ship.group.matrixWorld).invert();
    ship.obstacles.forEach(([x, y, z, r], i) => {
      obstacles.push({
        centre: new THREE.Vector3(x, y, z).applyMatrix4(ship.group.matrixWorld),
        radius: r * shipLength,
        hull: i < ship.hullObstacles,
      });
    });
    disposables.push(ship);
  }

  /** Floor circles along the line of sight from a viewer in front of the screen to the hole in the hull. */
  function viewToHole(): { x: number; z: number; r: number }[] {
    if (!ship) return [];
    const h = ship.hull;
    const hole = new THREE.Vector3(h.hole.x, h.hole.y, h.outerZ).applyMatrix4(ship.group.matrixWorld);
    const eyeZ = 0.6;
    const circles = [];
    for (let t = 0; t <= 1.001; t += 0.125) {
      const z = THREE.MathUtils.lerp(hole.z, 0, t);
      circles.push({ x: (hole.x * (eyeZ - z)) / (eyeZ - hole.z), z, r: unit * (0.22 + 0.1 * t) });
    }
    return circles;
  }

  // ---------- Coral reef ----------
  // Rocky walls on both sides, coral crowding the glass, a sandy path to the wreck.
  const reef = openOcean
    ? createReef(
        { halfWidth: hw, floorY, topY, depth, unit, groundAt },
        {
          rocks: settings.reefRocks,
          rockHeight: settings.reefRockHeight,
          enclose: settings.reefEnclose,
          coral: settings.reefCoral,
          coralSize: settings.reefCoralSize,
          clear: viewToHole(),
        },
      )
    : null;
  if (reef) {
    group.add(reef.group);
    obstacles.push(...reef.obstacles);
    disposables.push(reef);
  }

  // ---------- Kelp ----------
  // More kelp in a wider tank, so it doesn't look bare.
  const kelpCount = Math.round((openOcean ? 6 : 18) * Math.max(1, settings.tankWidth));
  const kelpGeometry = keep(new THREE.PlaneGeometry(0.07, 1, 1, 12));
  kelpGeometry.translate(0, 0.5, 0);
  const kelpPhase = new Float32Array(kelpCount).map(() => random() * Math.PI * 2);
  kelpGeometry.setAttribute("aPhase", new THREE.InstancedBufferAttribute(kelpPhase, 1));
  const kelpMaterial = keep(new THREE.MeshStandardMaterial({ color: water.kelp, roughness: 0.8, side: THREE.DoubleSide }));
  kelpMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    shader.vertexShader =
      `attribute float aPhase;\nuniform float uTime;\n` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         float sway = sin(uTime * 0.9 + aPhase + position.y * 2.5) * 0.12 * position.y * position.y;
         transformed.x += sway;
         transformed.z += cos(uTime * 0.7 + aPhase) * 0.05 * position.y * position.y;`,
      );
  };
  const kelp = new THREE.InstancedMesh(kelpGeometry, kelpMaterial, kelpCount);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    for (let i = 0; i < kelpCount; i++) {
      // Along the back and the sides, leaving the middle open.
      const side = i % 3;
      const x = side === 0 ? (random() * 1.6 - 0.8) * hw : (side === 1 ? -1 : 1) * hw * (0.75 + random() * 0.2);
      const z = side === 0 ? -depth * (0.75 + random() * 0.2) : -depth * (0.25 + random() * 0.65);
      const tall = unit * (0.55 + random() * 0.4) * Math.sqrt(height / unit);
      p.set(x, groundAt(x, z) - 0.01 * unit, z);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), random() * Math.PI);
      s.setScalar(tall);
      kelp.setMatrixAt(i, m.compose(p, q, s));
    }
  }
  group.add(kelp);

  // ---------- Bubbles ----------
  // In open ocean, besides the streams from the wreck, bubbles drift up everywhere.
  const streamCount = 60;
  const bubbleCount = openOcean ? 150 : streamCount;
  const bubbleMaterial = keep(
    new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.1, depthWrite: false }),
  );
  const bubbles = new THREE.InstancedMesh(keep(new THREE.SphereGeometry(1, 10, 8)), bubbleMaterial, bubbleCount);
  bubbles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bubbles.frustumCulled = false;
  // Two streams rising from the rocks, plus a few strays.
  const streams = ship
    ? ship.bubbleSpots.map((p) => p.clone().applyMatrix4(ship.group.matrixWorld))
    : [rockSpots[0], rockSpots[2]].map(([fx, fz]) => new THREE.Vector3(fx * hw, 0, fz * depth));
  const bubbleState = Array.from({ length: bubbleCount }, (_, i) => {
    const free = i >= streamCount;
    const from = free
      ? new THREE.Vector3((random() * 2 - 1) * hw, floorY, -depth * (0.05 + random() * 0.9))
      : streams[i % streams.length];
    return {
      origin: from,
      free,
      y: floorY + random() * height,
      speed: unit * (0.35 + random() * 0.35),
      // Drifting bubbles are small and fine; the wreck's streams are bigger.
      size: unit * (free ? 0.003 + random() * 0.005 : 0.006 + random() * 0.012),
      phase: random() * Math.PI * 2,
      spread: unit * (0.01 + random() * 0.03),
    };
  });
  group.add(bubbles);

  // ---------- Glowing specks ----------
  // Tiny motes drifting slowly in the water, catching the light; more visible the deeper it is.
  const speckCount = openOcean ? 600 : 200;
  const speckGeometry = keep(new THREE.BufferGeometry());
  {
    const pos = new Float32Array(speckCount * 3);
    const seed = new Float32Array(speckCount);
    const reach = openOcean ? 1.4 : 1;
    for (let i = 0; i < speckCount; i++) {
      pos[i * 3] = (random() * 2 - 1) * hw * reach;
      pos[i * 3 + 1] = floorY + random() * height;
      pos[i * 3 + 2] = -random() * depth * (openOcean ? 1.2 : 1);
      seed[i] = random() * 100;
    }
    speckGeometry.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    speckGeometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  }
  const speckMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: {
        uTime: time,
        uSize: { value: unit * 0.006 * window.innerHeight * Math.min(2, window.devicePixelRatio) * 0.5 },
        uDrift: { value: unit * 0.03 },
        uFloor: { value: floorY },
        uHeight: { value: height },
        uOpacity: { value: 0.35 + 0.65 * deep },
        uFade: { value: depth * 1.6 + 0.6 },
        uColour: { value: new THREE.Color(0xc8f6ff) },
      },
      vertexShader: `
        attribute float aSeed;
        uniform float uTime, uSize, uDrift, uFloor, uHeight;
        varying float vDist; varying float vTwinkle;
        void main(){
          vec3 p = position;
          p.x += sin(uTime * 0.21 + aSeed) * uDrift;
          p.z += cos(uTime * 0.17 + aSeed * 1.3) * uDrift;
          p.y = uFloor + mod(p.y - uFloor + uTime * uDrift * 0.15 + sin(uTime * 0.3 + aSeed) * uDrift * 0.5, uHeight);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          vDist = -mv.z;
          vTwinkle = 0.55 + 0.45 * sin(uTime * 1.3 + aSeed * 7.0);
          gl_PointSize = uSize * (0.6 + fract(aSeed) * 0.8) * projectionMatrix[1][1] / max(0.05, vDist);
        }`,
      fragmentShader: `
        uniform float uOpacity, uFade; uniform vec3 uColour;
        varying float vDist; varying float vTwinkle;
        void main(){
          float r = length(gl_PointCoord - 0.5) * 2.0;
          float a = smoothstep(1.0, 0.0, r);
          a *= a * uOpacity * vTwinkle * (1.0 - smoothstep(uFade * 0.5, uFade, vDist));
          gl_FragColor = vec4(uColour * a, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  const specks = new THREE.Points(speckGeometry, speckMaterial);
  specks.frustumCulled = false;
  group.add(specks);

  // ---------- Light shafts ----------
  const rayMaterial = keep(
    new THREE.ShaderMaterial({
      uniforms: { uTime: time, uColour: { value: new THREE.Color(water.light) }, uStrength: { value: (openOcean ? 0.24 : 0.16) * (1 + 0.4 * deep) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uTime; uniform vec3 uColour; uniform float uStrength; varying vec2 vUv;
        void main(){
          float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
          float a = pow(across, 2.0) * smoothstep(0.0, 0.9, vUv.y) * (0.6 + 0.4 * sin(uTime * 0.5 + vUv.x * 3.0));
          gl_FragColor = vec4(uColour * a * uStrength, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    }),
  );
  const rays = new THREE.Group();
  const rayCount = openOcean ? 12 : 6;
  for (let i = 0; i < rayCount; i++) {
    const ray = new THREE.Mesh(keep(new THREE.PlaneGeometry(unit * (0.12 + random() * 0.3), height * 1.9)), rayMaterial);
    ray.position.set((random() * 2 - 1) * hw * 0.9, topY - height * 0.8, -depth * (0.15 + random() * 0.8));
    // All slanting the same way, as if the sun is up to the left.
    ray.rotation.z = openOcean ? 0.32 + (random() - 0.5) * 0.1 : (random() - 0.5) * 0.5 + 0.2;
    ray.userData.sway = random() * Math.PI * 2;
    rays.add(ray);
  }
  group.add(rays);

  // ---------- Fish ----------
  const fishShape = keep(fishGeometry());
  const school = SPECIES.map((kind) => {
    const geometry = fishShape.clone();
    keep(geometry);
    const tail = new THREE.InstancedBufferAttribute(new Float32Array(MAX_FISH), 1);
    tail.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute("aTail", tail);
    const mesh = new THREE.InstancedMesh(geometry, keep(fishMaterial(kind.accent, kind.stripes, time)), MAX_FISH);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    // Create the colour buffer now, so the material is built with per-fish colours.
    mesh.setColorAt(0, new THREE.Color(kind.colour));
    mesh.count = 0;
    group.add(mesh);
    return { kind, mesh, tail, fish: [] as Fish[] };
  });

  // Swimming room: inside the tank, clear of the glass, walls, surface and sand.
  const margin = unit * 0.1;
  const glassGap = unit * 0.06;
  /** Normal cruising speed at speed 1, in metres per second. */
  const cruiseUnit = unit * 0.35;

  const spawnFish = (): Fish => ({
    position: new THREE.Vector3(
      (random() * 2 - 1) * (hw - margin),
      floorY + height * (0.3 + random() * 0.55),
      -glassGap - margin - random() * (depth - 2 * margin - glassGap),
    ),
    velocity: new THREE.Vector3(random() - 0.5, (random() - 0.5) * 0.2, random() - 0.5).setLength(cruiseUnit),
    curiosity: 0.3 + random() * 0.7,
    fear: 0,
    tail: random() * Math.PI * 2,
    wander: new THREE.Vector3(random() - 0.5, (random() - 0.5) * 0.3, random() - 0.5).normalize(),
    inside: false,
    visit: 0,
    visitTarget: new THREE.Vector3(),
    visitTime: 0,
  });

  // ---------- Trips into the wreck ----------
  // In the ship's own units: the hull's hollow inside and the hole in its side.
  const hull = ship?.hull;
  /** A random spot inside the hull, away from its walls. */
  const insideSpot = (target: THREE.Vector3) => {
    if (!hull) return target;
    const { min, max } = hull.inner;
    return target.set(
      THREE.MathUtils.lerp(min.x + 0.05, max.x - 0.05, random()),
      THREE.MathUtils.lerp(min.y + 0.03, max.y - 0.03, random()),
      THREE.MathUtils.lerp(min.z + 0.03, max.z - 0.04, random()),
    );
  };
  /** Just inside (0) or just outside (1) the hole. */
  const doorSpot = (target: THREE.Vector3, outside: boolean) =>
    hull ? target.set(hull.hole.x, hull.hole.y, outside ? hull.outerZ + 0.12 : 0.03) : target;
  /** How far into the hole's outline a point is: below 1 is inside it. */
  const holeAt = (q: THREE.Vector3) =>
    hull ? ((q.x - hull.hole.x) / hull.hole.rx) ** 2 + ((q.y - hull.hole.y) / hull.hole.ry) ** 2 : 9;
  const local = new THREE.Vector3();
  const localPush = new THREE.Vector3();

  // ---------- Reacting to the viewer ----------
  const lastEye = new THREE.Vector3();
  let haveEye = false;
  const look = new THREE.Vector3(); // where curious fish gather: just behind the glass, in front of your eyes
  let calm = 0; // seconds since the last scare

  const steer = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const away = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const colour = new THREE.Color();
  let lastTime = -1;

  const fogReach = 2.8 - 1.1 * deep;
  // Open ocean: the haze starts at the glass rather than at your eye, so the
  // coral right behind the glass keeps its colour, and thickens into the distance.
  const fog: THREE.Fog | THREE.FogExp2 = openOcean
    ? new THREE.Fog(water.haze, 0.6, 0.6 + depth * fogReach)
    : new THREE.FogExp2(water.haze, 0.95 / (depth + windowWidth * 1.5));

  const room: Room = {
    group,
    // The glass is the front of the tank: nothing is drawn in front of it.
    clipAtWindow: true,
    // Open ocean is murkier, so the seabed's far edges vanish into the haze.
    fog,
    background: new THREE.Color(water.haze),
    update(timeS, cameraEye, viewer) {
      if (fog instanceof THREE.Fog) {
        const glass = Math.max(0.05, cameraEye?.z ?? 0.6);
        fog.near = glass * 0.95;
        fog.far = glass + depth * fogReach;
      }
      // The fish react to where you really are, even when the view stays fixed.
      const eye = viewer;
      const dt = lastTime < 0 ? 0 : Math.min(0.05, timeS - lastTime);
      lastTime = timeS;
      time.value = timeS;
      causticUniforms.uCauTime.value += dt * Math.max(0, settings.causticSpeed);
      causticUniforms.uCauSize.value = Math.max(0.1, settings.causticSize);
      causticUniforms.uCauSharp.value = settings.causticSharpness;
      causticUniforms.uCauDetail.value = settings.causticDetail;
      causticUniforms.uCauWarp.value = settings.causticCurve;
      causticUniforms.uCauStrength.value = settings.causticStrength;
      ship?.update(timeS, {
        tears: settings.sailTears,
        tearSize: settings.sailTearSize,
        tearDetail: settings.sailTearDetail,
        fray: settings.sailFray,
        rips: settings.sailRips,
        wear: settings.sailWear,
        sway: settings.sailSway,
        pattern: settings.sailPattern,
      });
      reef?.update(timeS, settings.reefGlow, settings.reefSway);

      // A quick head movement startles every fish near where you're looking in.
      let startle = false;
      if (eye && dt > 0) {
        if (haveEye) {
          const speed = tmp.subVectors(eye, lastEye).length() / dt;
          const threshold = THREE.MathUtils.lerp(1.6, 0.35, settings.fishStartle);
          if (speed > threshold && calm > 0.6) {
            startle = true;
            calm = 0;
          }
        }
        lastEye.copy(eye);
        haveEye = true;
        look.set(
          THREE.MathUtils.clamp(eye.x, -hw + margin, hw - margin),
          THREE.MathUtils.clamp(eye.y, floorY + margin, topY - margin),
          -glassGap - unit * 0.05,
        );
      }
      calm += dt;
      // Closer viewers are more interesting; at arm's length the pull is full.
      const closeness = eye ? THREE.MathUtils.clamp((2 - eye.z) / 1.4, 0.15, 1) : 0;

      // Bubbles and light shafts.
      bubbles.visible = settings.tankBubbles;
      if (settings.tankBubbles) {
        bubbleState.forEach((b, i) => {
          b.y += b.speed * dt;
          if (b.y > topY) {
            if (b.free) {
              b.origin.set((random() * 2 - 1) * hw, 0, -depth * (0.05 + random() * 0.9));
              b.y = groundAt(b.origin.x, b.origin.z);
            } else b.y = ship ? b.origin.y : groundAt(b.origin.x, b.origin.z);
          }
          const wobble = Math.sin(timeS * 3 + b.phase) * b.spread;
          tmp.set(b.origin.x + wobble, b.y, b.origin.z + Math.cos(timeS * 2.3 + b.phase) * b.spread);
          const grow = 1 + (b.y - floorY) / unit;
          bubbles.setMatrixAt(i, matrix.makeScale(b.size * grow, b.size * grow, b.size * grow).setPosition(tmp));
        });
        bubbles.instanceMatrix.needsUpdate = true;
      }
      rays.visible = settings.tankLightRays;
      specks.visible = settings.tankPlankton;
      for (const ray of rays.children) ray.rotation.z += Math.sin(timeS * 0.3 + ray.userData.sway) * 0.0004;

      // Fish: keep each kind's count in step with the setting.
      const total = Math.max(0, Math.min(MAX_FISH, Math.round(settings.fishCount)));
      let assigned = 0;
      school.forEach((s, k) => {
        const want = k === school.length - 1 ? total - assigned : Math.round(total * s.kind.share);
        assigned += want;
        while (s.fish.length < want) s.fish.push(spawnFish());
        if (s.fish.length > want) s.fish.length = want;
      });

      for (const s of school) {
        const { kind, fish } = s;
        const cruise = cruiseUnit * kind.cruise * Math.max(0.05, settings.fishSpeed);
        const size = kind.length * unit * Math.max(0.2, settings.fishSize);
        const schooling = Math.max(0, settings.fishSchooling);
        const wander = Math.max(0, settings.fishWander);
        const agility = Math.max(0.1, settings.fishAgility);
        const neighbour = size * (2.5 + 3 * kind.school);
        const personal = size * 0.9;
        fish.forEach((f) => {
          if (startle && f.position.distanceTo(look) < depth) f.fear = 1;
          f.fear = Math.max(0, f.fear - dt * 0.6);
          steer.set(0, 0, 0);

          // Schooling with the same kind: keep apart, swim alike, stay together.
          let count = 0;
          const align = tmp.set(0, 0, 0);
          const centre = away.set(0, 0, 0);
          for (const o of fish) {
            if (o === f) continue;
            const d = f.position.distanceTo(o.position);
            if (d > neighbour) continue;
            if (d < personal && d > 0) {
              steer.addScaledVector(xAxis.subVectors(f.position, o.position).normalize(), ((personal - d) / personal) * 2.5);
            }
            align.add(o.velocity);
            centre.add(o.position);
            count++;
          }
          if (count > 0) {
            steer.addScaledVector(align.divideScalar(count).normalize(), 0.6 * kind.school * schooling);
            steer.addScaledVector(centre.divideScalar(count).sub(f.position).normalize(), 0.5 * kind.school * schooling);
          }

          // Wander: a direction that drifts slowly.
          // Restless fish change their mind more often and follow it more.
          f.wander.x += (random() - 0.5) * dt * 1.5 * (0.3 + wander);
          f.wander.y += (random() - 0.5) * dt * 0.5 * (0.3 + wander);
          f.wander.z += (random() - 0.5) * dt * 1.5 * (0.3 + wander);
          f.wander.normalize();
          steer.addScaledVector(f.wander, 0.35 * wander);

          // Where the fish is in the ship's own units, and whether it lines up with the hole.
          let inDoor = false;
          let skipHull = false;
          const fishInShip = size / shipLength;
          if (ship && hull) {
            local.copy(f.position).applyMatrix4(shipInverse);
            inDoor = holeAt(local) < 0.5;
            if (f.inside) skipHull = true;
            else if (inDoor && local.z > -0.02 && local.z < hull.outerZ + 0.15) {
              skipHull = true;
              if (local.z < hull.inner.max.z) f.inside = true;
            }
            // Now and then a fish sets off to look inside the wreck.
            if (f.visit === 0 && !f.inside && f.fear < 0.1 && random() < dt * 0.03 * settings.fishExplore) {
              f.visit = 1;
              doorSpot(f.visitTarget, true);
            }
            if (f.inside && f.visit === 0) {
              f.visit = 3;
              f.visitTime = 1 + random() * 2;
              insideSpot(f.visitTarget);
            }
            if (f.fear > 0.5 && !f.inside) f.visit = 0;
            if (f.visit > 0) {
              const reached = local.distanceTo(f.visitTarget) < 0.04 + fishInShip * 0.5;
              if (reached) {
                if (f.visit === 1) (f.visit = 2), doorSpot(f.visitTarget, false);
                else if (f.visit === 2) (f.visit = 3), (f.visitTime = 2 + random() * 5), insideSpot(f.visitTarget);
                else if (f.visit === 3) insideSpot(f.visitTarget);
                else if (f.visit === 4) (f.visit = 5), doorSpot(f.visitTarget, true);
                else if (f.visit === 5) f.visit = 0;
              }
              if (f.visit === 3) {
                f.visitTime -= dt;
                if (f.visitTime <= 0) (f.visit = 4), doorSpot(f.visitTarget, false);
              }
              if (f.visit > 0) {
                tmp.copy(f.visitTarget).applyMatrix4(ship.group.matrixWorld).sub(f.position);
                steer.addScaledVector(tmp.normalize(), f.visit === 3 ? 1.2 : 3);
              }
            }
            // Inside: the hull's walls push back, except where the hole is.
            if (f.inside) {
              const m = 0.03 + fishInShip;
              const wall = (gap: number) => (gap < m ? ((m - gap) / m) ** 2 * 4 : 0);
              const { min, max } = hull.inner;
              localPush.set(
                wall(local.x - min.x) - wall(max.x - local.x),
                wall(local.y - min.y) - wall(max.y - local.y),
                wall(local.z - min.z) - (inDoor ? 0 : wall(max.z - local.z)),
              );
              steer.add(localPush.applyQuaternion(ship.group.quaternion));
            }
          }

          // Curiosity: come and hover in front of your eyes.
          if (eye && f.fear < 0.1 && f.visit === 0 && !f.inside) {
            tmp.subVectors(look, f.position);
            const d = tmp.length();
            if (d > size * 1.5) {
              steer.addScaledVector(tmp.normalize(), settings.fishCuriosity * f.curiosity * closeness * 1.4);
            }
          }
          // Fear: away from the glass where you are, towards the back.
          if (f.fear > 0) {
            tmp.subVectors(f.position, look).normalize();
            tmp.z -= 1;
            steer.addScaledVector(tmp.normalize(), 3 * f.fear);
          }

          // Walls, surface, sand and glass push back the closer a fish gets.
          const p = f.position;
          const soft = (gap: number) => (gap < margin ? ((margin - gap) / margin) ** 2 * 4 : 0);
          steer.x += soft(p.x + hw) - soft(hw - p.x);
          steer.y += soft(p.y - groundAt(p.x, p.z)) - soft(topY - p.y);
          steer.z += soft(p.z + depth) - soft(-glassGap - p.z) * 1.5;
          // Swim around the wreck rather than through it.
          for (const o of obstacles) {
            if (o.hull && skipHull) continue;
            tmp.subVectors(p, o.centre);
            const d = tmp.length();
            const reach = o.radius + size;
            if (d < reach + margin && d > 1e-6) {
              const push = (reach + margin - d) / margin;
              steer.addScaledVector(tmp.divideScalar(d), push * push * 5);
              // Inside the hull: put the fish back outside straight away.
              if (d < reach) p.copy(o.centre).addScaledVector(tmp, reach);
            }
          }

          // Turn towards the wanted direction, without stopping or spinning.
          const maxSpeed = cruise * (1 + 1.8 * f.fear);
          f.velocity.addScaledVector(steer, cruise * 2.2 * agility * dt);
          f.velocity.y *= 1 - 0.8 * dt; // fish mostly swim level
          const speed = THREE.MathUtils.clamp(f.velocity.length(), cruise * 0.45, maxSpeed);
          f.velocity.setLength(speed);
          p.addScaledVector(f.velocity, dt);
          // Hard limits, in case a burst of speed overshoots.
          p.x = THREE.MathUtils.clamp(p.x, -hw + size * 0.5, hw - size * 0.5);
          p.y = THREE.MathUtils.clamp(p.y, groundAt(p.x, p.z) + size * 0.3, topY - size * 0.3);
          p.z = THREE.MathUtils.clamp(p.z, -depth + size * 0.5, -glassGap * 0.5);
          // Inside the hull, only the hole lets a fish out.
          if (ship && hull && f.inside) {
            local.copy(p).applyMatrix4(shipInverse);
            const pad = fishInShip * 0.4;
            const { min, max } = hull.inner;
            local.x = THREE.MathUtils.clamp(local.x, min.x + pad, max.x - pad);
            local.y = THREE.MathUtils.clamp(local.y, min.y + pad, max.y - pad);
            local.z = Math.max(local.z, min.z + pad);
            if (holeAt(local) >= 0.5) local.z = Math.min(local.z, max.z - pad);
            else if (local.z > hull.outerZ) f.inside = false;
            p.copy(local).applyMatrix4(ship.group.matrixWorld);
          }

          // Tail beats faster the faster the fish swims.
          f.tail += dt * (6 + 14 * (speed / cruise));
        });

        // Draw: each fish faces where it's going and stays upright.
        fish.forEach((f, i) => {
          xAxis.copy(f.velocity).normalize();
          zAxis.crossVectors(xAxis, up);
          if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);
          zAxis.normalize();
          yAxis.crossVectors(zAxis, xAxis);
          matrix.makeBasis(xAxis, yAxis, zAxis).scale(tmp.setScalar(size)).setPosition(f.position);
          s.mesh.setMatrixAt(i, matrix);
          s.tail.setX(i, f.tail);
          // A little variety within each kind.
          colour.set(kind.colour).offsetHSL((f.curiosity - 0.65) * 0.04, 0, (f.curiosity - 0.65) * 0.12);
          s.mesh.setColorAt(i, colour);
        });
        s.mesh.count = fish.length;
        s.mesh.instanceMatrix.needsUpdate = true;
        s.tail.needsUpdate = true;
        if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true;
      }
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
  return room;
}
