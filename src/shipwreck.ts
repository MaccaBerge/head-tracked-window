import * as THREE from "three";

/**
 * A sunken pirate ship, built from simple shapes. The model is 1 long along
 * +x (bow at +0.5), with the deck at y = 0; the caller scales and places it.
 *
 * It returns the group, a few spheres the fish should swim around (in the
 * group's own coordinates), the spots bubbles rise from, and an update for
 * the moving parts (sail, flag, the treasure's glow).
 */
export interface Shipwreck {
  group: THREE.Group;
  /** Spheres around the masts and the outside of the hull, [x, y, z, radius] in the model's own units. */
  obstacles: [number, number, number, number][];
  /** How many of `obstacles` (from the start) wrap the hull; fish passing through the hole ignore those. */
  hullObstacles: number;
  /** The hollow inside of the hull and the hole torn in its +z side, in the model's own units. */
  hull: { inner: THREE.Box3; hole: { x: number; y: number; rx: number; ry: number }; outerZ: number };
  /** Where bubbles rise from, in the model's own units. */
  bubbleSpots: THREE.Vector3[];
  update(timeS: number, sails?: SailLook): void;
  dispose(): void;
}

/** How torn and worn the sails are; read live. */
export interface SailLook {
  /** How much of the sail is torn away in holes, 0 to 1. */
  tears: number;
  /** Size of the holes, 1 is normal. */
  tearSize: number;
  /** Raggedness of the tear edges, 0 smooth to 1 finely shredded. */
  tearDetail: number;
  /** How shredded the bottom edge is into hanging strips, 0 to 1. */
  fray: number;
  /** Long slashes running down the canvas, 0 to 1. */
  rips: number;
  /** Stains, rot and algae, 0 clean to 1 filthy. */
  wear: number;
  /** How much the sails sway in the current, 0 to 2. */
  sway: number;
  /** Which pattern of tears, a whole number. */
  pattern: number;
}

const WOOD = 0x5a3a22;
const DARK_WOOD = 0x3a2616;
const IRON = 0x2b2f33;
const GOLD = 0xf2b33b;

/** The hole torn through the starboard (+z) side: centre and radii, in model units. */
export const HULL_HOLE = { x: 0.07, y: -0.085, rx: 0.11, ry: 0.06 };

export function createShipwreck(): Shipwreck {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <T extends { dispose(): void }>(d: T) => (disposables.push(d), d);
  const time = { value: 0 };
  const random = mulberry(7);

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, setup?: (m: THREE.Mesh) => void) => {
    const mesh = new THREE.Mesh(keep(geometry), material);
    setup?.(mesh);
    group.add(mesh);
    return mesh;
  };

  // ---------- Materials ----------
  // The hull is a shell, seen from inside through the hole, so both sides are drawn.
  const hullMaterial = keep(new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.9, side: THREE.DoubleSide }));
  // Planks running the length of the hull, darker gaps between them, green
  // growth towards the waterline, and a ragged hole torn in the starboard side.
  hullMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uHole = { value: new THREE.Vector4(HULL_HOLE.x, HULL_HOLE.y, HULL_HOLE.rx, HULL_HOLE.ry) };
    shader.vertexShader =
      `varying vec3 vHull;\n` +
      shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\n vHull = position;`);
    shader.fragmentShader =
      `varying vec3 vHull;\nuniform vec4 uHole;\n` +
      shader.fragmentShader.replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
         vec2 hole = (vHull.xy - uHole.xy) / uHole.zw;
         float ragged = length(hole) + 0.13 * sin(atan(hole.y, hole.x) * 7.0) + 0.06 * sin(atan(hole.y, hole.x) * 17.0);
         if (vHull.z > 0.03 && ragged < 1.0) discard;`,
      ).replace(
        "#include <color_fragment>",
        `#include <color_fragment>
         // On the deck (the flat top) the planks run along the ship instead.
         float onDeck = step(-0.003, vHull.y);
         float plank = mix(fract(vHull.y * 38.0), fract(vHull.z * 34.0), onDeck);
         float gap = smoothstep(0.0, 0.08, plank) * smoothstep(1.0, 0.92, plank);
         float grain = 0.85 + 0.15 * sin(vHull.x * 140.0 + floor(vHull.y * 38.0) * 7.0);
         diffuseColor.rgb *= mix(0.45, 1.0, gap) * grain;
         diffuseColor.rgb *= mix(1.0, 1.25, onDeck);
         float growth = smoothstep(-0.05, -0.2, vHull.y);
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.16, 0.24, 0.12), growth * 0.55);
         // Splintered, darker wood around the hole, and a dim inside.
         if (vHull.z > 0.03) diffuseColor.rgb *= mix(0.45, 1.0, smoothstep(1.0, 1.35, ragged));
         if (!gl_FrontFacing) diffuseColor.rgb *= 0.3;`,
      );
  };
  const woodMaterial = keep(new THREE.MeshStandardMaterial({ color: DARK_WOOD, roughness: 0.9 }));
  const ironMaterial = keep(new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.6, metalness: 0.6 }));
  const goldMaterial = keep(
    new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.3, metalness: 0.9, emissive: GOLD, emissiveIntensity: 0.35 }),
  );

  // ---------- Hull ----------
  const hull = new THREE.BoxGeometry(1, 0.22, 0.32, 32, 8, 10);
  hull.translate(0, -0.11, 0);
  {
    const p = hull.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const t = x + 0.5; // 0 at the stern, 1 at the bow
      const down = -y / 0.22; // 0 at the deck, 1 at the keel
      // Narrow to a point at the bow, a little at the stern, and round the bottom.
      let beam = 1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 1.7) * 0.97;
      beam *= 1 - Math.pow(Math.max(0, 0.18 - t) / 0.18, 2) * 0.35;
      beam *= 1 - 0.6 * down * down;
      z *= beam;
      // The keel curves up at both ends, and the deck line rises (sheer).
      const ends = Math.pow(Math.abs(t - 0.45) / 0.55, 2);
      y += ends * 0.12 * down + ends * 0.05 * (1 - down);
      p.setXYZ(i, x, y, z);
    }
    hull.computeVertexNormals();
  }
  add(hull, hullMaterial);

  // Stern cabin, a rail along each side, and a bowsprit.
  add(new THREE.BoxGeometry(0.16, 0.08, 0.22), woodMaterial, (m) => m.position.set(-0.37, 0.05, 0));
  add(new THREE.BoxGeometry(0.18, 0.015, 0.25), woodMaterial, (m) => m.position.set(-0.37, 0.095, 0));
  // Dark cabin windows on both sides and across the stern.
  const windowMaterial = keep(new THREE.MeshBasicMaterial({ color: 0x050403 }));
  for (const side of [-1, 1]) {
    for (const x of [-0.41, -0.33]) {
      add(new THREE.BoxGeometry(0.03, 0.025, 0.004), windowMaterial, (m) => m.position.set(x, 0.055, side * 0.111));
    }
  }
  add(new THREE.BoxGeometry(0.004, 0.025, 0.12), windowMaterial, (m) => m.position.set(-0.451, 0.055, 0));
  for (const side of [-1, 1]) {
    add(new THREE.BoxGeometry(0.62, 0.025, 0.012), woodMaterial, (m) => m.position.set(0.0, 0.03, side * 0.15));
  }
  add(new THREE.CylinderGeometry(0.007, 0.012, 0.28, 8), woodMaterial, (m) => {
    m.rotation.z = -Math.PI / 2 + 0.35;
    m.position.set(0.6, 0.09, 0);
  });

  // ---------- Masts ----------
  const mast = (x: number, height: number, broken: boolean) => {
    const g = new THREE.CylinderGeometry(0.009, 0.013, height, 10);
    g.translate(0, height / 2, 0);
    if (broken) {
      // A splintered top.
      const p = g.getAttribute("position");
      for (let i = 0; i < p.count; i++) if (p.getY(i) > height * 0.99) p.setY(i, height + (random() - 0.5) * 0.04);
      g.computeVertexNormals();
    }
    return add(g, woodMaterial, (m) => m.position.set(x, 0, 0));
  };
  // The main mast still stands, tall, with its crow's nest; the mizzen leans a little.
  mast(0.05, 0.66, false);
  add(new THREE.CylinderGeometry(0.035, 0.028, 0.04, 14), woodMaterial, (m) => m.position.set(0.05, 0.54, 0));
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 8), woodMaterial, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.set(0.05, 0.44, 0);
  });
  add(new THREE.CylinderGeometry(0.005, 0.005, 0.28, 8), woodMaterial, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.set(0.05, 0.22, 0);
  });
  const mizzen = mast(-0.24, 0.52, false);
  mizzen.rotation.z = 0.12;
  // A yard (cross beam) on the mizzen.
  add(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 8), woodMaterial, (m) => {
    m.rotation.x = Math.PI / 2;
    m.position.set(-0.24 - 0.05, 0.42, 0);
    m.rotation.z = 0.12;
  });
  // The fallen foremast, lying across the sand beside the bow.
  add(new THREE.CylinderGeometry(0.01, 0.012, 0.42, 10), woodMaterial, (m) => {
    m.rotation.set(Math.PI / 2, 0, 0.5);
    m.position.set(0.32, -0.2, -0.28);
  });

  // Rigging: a few slack lines from the masts to the rails.
  const rigging = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-0.2, 0.5, 0), new THREE.Vector3(-0.05, 0.03, 0.15),
    new THREE.Vector3(-0.2, 0.5, 0), new THREE.Vector3(-0.05, 0.03, -0.15),
    new THREE.Vector3(-0.2, 0.5, 0), new THREE.Vector3(-0.42, 0.13, 0.13),
    new THREE.Vector3(0.05, 0.6, 0), new THREE.Vector3(0.22, 0.03, 0.15),
    new THREE.Vector3(0.05, 0.6, 0), new THREE.Vector3(0.22, 0.03, -0.15),
    new THREE.Vector3(0.05, 0.6, 0), new THREE.Vector3(0.62, 0.12, 0),
    new THREE.Vector3(0.05, 0.6, 0), new THREE.Vector3(-0.2, 0.5, 0),
  ]);
  group.add(new THREE.LineSegments(keep(rigging), keep(new THREE.LineBasicMaterial({ color: 0x2a2116 }))));

  // ---------- Torn sail and flag (canvas textures) ----------
  const time2 = time;
  const swaying = (material: THREE.MeshStandardMaterial, amount: number) => {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time2;
      shader.vertexShader =
        `uniform float uTime;\n` +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
           float free = uv.x;
           transformed.z += sin(uTime * 1.3 + position.x * 9.0 + position.y * 5.0) * ${amount.toFixed(3)} * free;`,
        );
    };
    return material;
  };
  const sailTexture = keep(new THREE.CanvasTexture(drawSail(random)));
  sailTexture.colorSpace = THREE.SRGBColorSpace;
  // The canvas gives the cloth (stains and seams); the tears, frayed hem, rips
  // and rot are worked out per pixel from noise, so they can change live.
  const sailUniforms = {
    uTears: { value: 0.5 },
    uTearSize: { value: 1 },
    uTearDetail: { value: 0.5 },
    uFray: { value: 0.5 },
    uRips: { value: 0.3 },
    uWear: { value: 0.5 },
    uSway: { value: 1 },
    uPattern: { value: 0 },
  };
  const sailMaterial = keep(new THREE.MeshStandardMaterial({ map: sailTexture, side: THREE.DoubleSide, roughness: 1 }));
  sailMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = time;
    Object.assign(shader.uniforms, sailUniforms);
    shader.vertexShader =
      `uniform float uTime;\nuniform float uSway;\nvarying vec2 vSail;\nvarying vec2 vSailSeed;\n` +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vSail = uv;
         // Each sail gets its own tears, from where it hangs.
         vSailSeed = modelMatrix[3].xy * 37.0 + modelMatrix[3].z * 11.0;
         float free = 1.0 - uv.y;
         transformed.z += (sin(uTime * 1.3 + position.x * 9.0 + position.y * 5.0) * 0.018 + sin(uTime * 2.1 + position.x * 23.0) * 0.004) * uSway * (0.3 + free);`,
      );
    shader.fragmentShader =
      `uniform float uTears, uTearSize, uTearDetail, uFray, uRips, uWear, uPattern;
       varying vec2 vSail;
       varying vec2 vSailSeed;
       float sailHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
       float sailNoise(vec2 p) {
         vec2 i = floor(p), f = fract(p);
         vec2 u = f * f * (3.0 - 2.0 * f);
         return mix(mix(sailHash(i), sailHash(i + vec2(1.0, 0.0)), u.x), mix(sailHash(i + vec2(0.0, 1.0)), sailHash(i + vec2(1.0, 1.0)), u.x), u.y);
       }
      ` +
      shader.fragmentShader.replace(
        "#include <alphatest_fragment>",
        `#include <alphatest_fragment>
         vec2 seed = vSailSeed + vec2(uPattern * 17.31, uPattern * 7.77);
         vec2 p = vSail * 4.0 / uTearSize + seed;
         // Holes: broad blotches, with finer ragged noise along their edges.
         float rot = sailNoise(p) * 0.65 + sailNoise(p * 2.1 + 3.7) * 0.35;
         rot += (sailNoise(p * 7.0 + 1.3) - 0.5) * 0.28 * uTearDetail + (sailNoise(p * 17.0 + 9.1) - 0.5) * 0.16 * uTearDetail;
         // Cloth rots first towards the loose bottom and the far edge.
         rot += (1.0 - vSail.y) * 0.12 + vSail.x * 0.04;
         float edgeAt = mix(1.35, 0.6, uTears);
         float tornness = rot - edgeAt;
         // Long slashes running down the cloth, wavering a little.
         float slashX = vSail.x * 5.0 + sailNoise(vec2(vSail.y * 3.0, seed.x)) * 0.8 + seed.y;
         float slash = abs(fract(slashX) - 0.5);
         float slashOn = step(0.6, sailNoise(vec2(floor(slashX) * 3.1, seed.x * 0.37)));
         float slashLength = sailNoise(vec2(floor(slashX) * 1.7, 4.2));
         float rip = slashOn * step(1.0 - slashLength * 0.9, 1.0 - vSail.y) * (uRips * 0.06 - slash + (sailNoise(vSail * 40.0 + seed) - 0.5) * 0.02 * uTearDetail);
         // A frayed hem: the bottom edge eaten away unevenly and split into strips.
         float hemDepth = uFray * (0.12 + 0.28 * sailNoise(vec2(vSail.x * 9.0, seed.y)) + 0.08 * uTearDetail * sailNoise(vec2(vSail.x * 41.0, seed.x)));
         float strips = step(0.55, sailNoise(vec2(vSail.x * 70.0, seed.y)));
         float hem = hemDepth - vSail.y + strips * uFray * 0.12 * (1.0 - vSail.y);
         if (tornness > 0.0 || rip > 0.0 || hem > 0.0) discard;
         // Darker, rotted cloth near every tear.
         float near = max(max(tornness + 0.07, rip + 0.025), hem + 0.05);
         diffuseColor.rgb *= 1.0 - 0.5 * smoothstep(-0.07, 0.0, near - 0.07);
         // Wear: blotchy stains and green growth creeping up from the hem.
         float stain = sailNoise(vSail * 6.0 + seed * 0.5);
         diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 0.5, 0.38), uWear * smoothstep(0.35, 0.8, stain));
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.22, 0.3, 0.16), uWear * 0.7 * smoothstep(0.45, 0.0, vSail.y) * sailNoise(vSail * 12.0 + seed));
         diffuseColor.rgb *= 1.0 - 0.35 * uWear;`,
      );
  };
  add(new THREE.PlaneGeometry(0.28, 0.24, 12, 10), sailMaterial, (m) => {
    m.rotation.y = Math.PI / 2;
    m.position.set(-0.27, 0.29, 0.005);
    m.rotation.z = 0.12;
  });
  // A bigger torn sail hanging from the main mast's upper yard.
  add(new THREE.PlaneGeometry(0.32, 0.2, 12, 10), sailMaterial, (m) => {
    m.rotation.y = Math.PI / 2;
    m.position.set(0.058, 0.335, 0);
  });

  const flagTexture = keep(new THREE.CanvasTexture(drawFlag(random)));
  flagTexture.colorSpace = THREE.SRGBColorSpace;
  const flagMaterial = keep(
    swaying(new THREE.MeshStandardMaterial({ map: flagTexture, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 }), 0.03),
  );
  add(new THREE.PlaneGeometry(0.11, 0.08, 10, 6), flagMaterial, (m) => {
    m.position.set(-0.24 + 0.066 + 0.055, 0.5, 0);
    m.rotation.z = 0.12;
  });

  // ---------- Cannons ----------
  const cannon = () => {
    const g = new THREE.CylinderGeometry(0.011, 0.016, 0.1, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  };
  for (const x of [-0.26, -0.14, 0.28]) {
    add(cannon(), ironMaterial, (m) => {
      m.rotation.y = Math.PI / 2;
      m.position.set(x, -0.04, 0.165);
    });
  }
  // One that fell out, lying on the sand.
  add(cannon(), ironMaterial, (m) => {
    m.rotation.y = 1.1;
    m.position.set(-0.05, -0.22, 0.32);
  });

  // ---------- Barrels ----------
  const barrel = new THREE.LatheGeometry(
    Array.from({ length: 9 }, (_, i) => {
      const t = i / 8;
      return new THREE.Vector2(0.022 + 0.008 * Math.sin(t * Math.PI), t * 0.06 - 0.03);
    }),
    14,
  );
  keep(barrel);
  const barrelSpots: [number, number, number, number, number][] = [
    [-0.42, -0.23, 0.3, 1.4, 0],
    [-0.36, -0.23, 0.36, 0, 0.3],
    [0.45, -0.23, 0.25, 1.57, 1.1],
    [0.1, -0.23, -0.34, 1.57, 2.2],
  ];
  for (const [x, y, z, lie, turn] of barrelSpots) {
    const m = new THREE.Mesh(barrel, woodMaterial);
    m.position.set(x, y, z);
    m.rotation.set(lie, turn, 0);
    group.add(m);
    // Two iron bands.
    for (const dy of [-0.018, 0.018]) {
      const band = new THREE.Mesh(keep(new THREE.TorusGeometry(0.029, 0.0025, 6, 18)), ironMaterial);
      band.rotation.x = Math.PI / 2;
      band.position.y = dy;
      m.add(band);
    }
  }

  // ---------- Anchor ----------
  const anchor = new THREE.Group();
  anchor.add(new THREE.Mesh(keep(new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8)), ironMaterial));
  const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.02, 0.005, 8, 16)), ironMaterial);
  ring.position.y = 0.1;
  anchor.add(ring);
  const stock = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.006, 0.006, 0.1, 8)), ironMaterial);
  stock.rotation.x = Math.PI / 2;
  stock.position.y = 0.07;
  anchor.add(stock);
  const arms = new THREE.Mesh(keep(new THREE.TorusGeometry(0.055, 0.007, 8, 20, Math.PI)), ironMaterial);
  arms.rotation.z = Math.PI;
  arms.position.y = -0.04;
  anchor.add(arms);
  for (const side of [-1, 1]) {
    const fluke = new THREE.Mesh(keep(new THREE.ConeGeometry(0.014, 0.03, 4)), ironMaterial);
    fluke.position.set(side * 0.055, -0.035, 0);
    anchor.add(fluke);
  }
  anchor.position.set(0.68, -0.2, 0.12);
  anchor.rotation.set(0.2, 0.4, 1.2);
  group.add(anchor);

  // ---------- Treasure ----------
  const chest = new THREE.Group();
  chest.add(new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, 0.04, 0.045)), woodMaterial));
  const lid = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0225, 0.0225, 0.07, 12, 1, false, 0, Math.PI)), woodMaterial);
  lid.rotation.set(-0.9, 0, Math.PI / 2);
  lid.position.set(0, 0.03, -0.03);
  chest.add(lid);
  for (const x of [-0.03, 0.03]) {
    const strap = new THREE.Mesh(keep(new THREE.BoxGeometry(0.006, 0.042, 0.047)), ironMaterial);
    strap.position.x = x;
    chest.add(strap);
  }
  // A heap of gold in the chest and spilling onto the sand.
  const coin = keep(new THREE.CylinderGeometry(0.006, 0.006, 0.0015, 10));
  const coins = new THREE.InstancedMesh(coin, goldMaterial, 70);
  {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (let i = 0; i < 70; i++) {
      const inChest = i < 40;
      const x = inChest ? (random() - 0.5) * 0.06 : 0.035 + random() * 0.08;
      const z = inChest ? (random() - 0.5) * 0.035 : (random() - 0.5) * 0.07;
      const y = inChest ? 0.02 + random() * 0.012 : -0.02 + random() * 0.004;
      q.setFromEuler(e.set((random() - 0.5) * 0.8, random() * 3, (random() - 0.5) * 0.8));
      coins.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(1, 1, 1)));
    }
  }
  chest.add(coins);
  const glow = new THREE.PointLight(GOLD, 0.002, 0.1, 2);
  glow.position.set(0.02, 0.06, 0);
  chest.add(glow);
  chest.position.set(-0.5, -0.215, -0.22);
  chest.rotation.y = 0.6;
  group.add(chest);

  // A lantern still glowing inside the hull, seen through the hole.
  const lanternMaterial = keep(new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  add(new THREE.SphereGeometry(0.012, 10, 8), lanternMaterial, (m) => m.position.set(-0.03, -0.07, -0.07));
  add(new THREE.CylinderGeometry(0.0015, 0.0015, 0.05, 4), ironMaterial, (m) => m.position.set(-0.03, -0.035, -0.07));
  // Lights don't scale with the model, so these are small: the ship is a few tens of centimetres long.
  const lantern = new THREE.PointLight(0xffa850, 0.004, 0.15, 2);
  lantern.position.set(-0.03, -0.08, -0.05);
  group.add(lantern);
  // ---------- The captain's treasure, inside the hull ----------
  // An open chest on a crate, heaped with gold and gems, glowing through the hole.
  const hoard = new THREE.Group();
  const brightGold = keep(
    new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.25, metalness: 0.9, emissive: GOLD, emissiveIntensity: 0.7 }),
  );
  const crate = new THREE.Mesh(keep(new THREE.BoxGeometry(0.1, 0.04, 0.07)), woodMaterial);
  crate.position.y = -0.02;
  hoard.add(crate);
  const box = new THREE.Group();
  box.position.y = 0.02;
  box.scale.setScalar(1.3);
  hoard.add(box);
  box.add(new THREE.Mesh(keep(new THREE.BoxGeometry(0.07, 0.04, 0.045)), woodMaterial));
  const openLid = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.0225, 0.0225, 0.07, 12, 1, false, 0, Math.PI)), woodMaterial);
  openLid.rotation.set(-1.15, 0, Math.PI / 2);
  openLid.position.set(0, 0.03, -0.03);
  box.add(openLid);
  for (const x of [-0.03, 0.03]) {
    const strap = new THREE.Mesh(keep(new THREE.BoxGeometry(0.006, 0.042, 0.047)), ironMaterial);
    strap.position.x = x;
    box.add(strap);
  }
  {
    // Gold heaped into a dome above the rim, and a spill over the front onto the crate.
    const heap = 110;
    const gold = new THREE.InstancedMesh(coin, brightGold, heap);
    const gems = new THREE.InstancedMesh(keep(new THREE.OctahedronGeometry(0.005)), keep(new THREE.MeshBasicMaterial()), 12);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const one = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < heap; i++) {
      const inside = i < 80;
      const u = random() * 2 - 1;
      const v = random() * 2 - 1;
      const x = inside ? u * 0.032 : (random() - 0.5) * 0.06;
      const z = inside ? v * 0.019 : 0.024 + random() * 0.03;
      const dome = Math.max(0, 1 - u * u * 0.8 - v * v * 0.8);
      const y = inside ? 0.016 + dome * 0.014 * random() : -0.019 + random() * 0.003;
      q.setFromEuler(e.set((random() - 0.5) * 1.2, random() * 3, (random() - 0.5) * 1.2));
      gold.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, one));
    }
    const gemColours = [0xff2d55, 0x30d158, 0x0a84ff, 0xbf5af2, 0xffffff];
    const c = new THREE.Color();
    for (let i = 0; i < 12; i++) {
      q.setFromEuler(e.set(random() * 3, random() * 3, random() * 3));
      const p = new THREE.Vector3((random() - 0.5) * 0.06, 0.02 + random() * 0.012, (random() - 0.5) * 0.036);
      gems.setMatrixAt(i, m.compose(p, q, one));
      gems.setColorAt(i, c.set(gemColours[i % gemColours.length]));
    }
    box.add(gold, gems);
  }
  // A soft golden halo, so the glow reads through the water even from afar.
  const haloTexture = keep(new THREE.CanvasTexture(drawHalo()));
  const halo = new THREE.Sprite(
    keep(new THREE.SpriteMaterial({ map: haloTexture, color: GOLD, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })),
  );
  halo.scale.set(0.32, 0.22, 1);
  halo.position.set(0, 0.06, 0.01);
  hoard.add(halo);
  const hoardLight = new THREE.PointLight(0xffc040, 0.002, 0.15, 2);
  hoardLight.position.set(0, 0.05, 0.02);
  hoard.add(hoardLight);
  hoard.position.set(0.12, -0.15, -0.04);
  hoard.rotation.y = -0.25;
  group.add(hoard);

  // Ribs (frames) along the inside of the hull.
  for (let x = -0.28; x <= 0.23; x += 0.07) {
    // Just inside the planking, which narrows towards the bow.
    const t = x + 0.5;
    const beam = (1 - Math.pow(Math.max(0, t - 0.55) / 0.45, 1.7) * 0.97) * 0.88;
    for (const side of [-1, 1]) {
      // The ones where the hole is were torn away with the planks.
      if (side > 0 && Math.abs(x - HULL_HOLE.x) < HULL_HOLE.rx + 0.01) continue;
      add(new THREE.BoxGeometry(0.012, 0.15, 0.008), woodMaterial, (m) => m.position.set(x, -0.1, side * (0.16 * beam - 0.008)));
    }
  }

  return {
    group,
    // Spheres along the hull, then the masts.
    hullObstacles: 9,
    hull: { inner: new THREE.Box3(new THREE.Vector3(-0.32, -0.18, -0.11), new THREE.Vector3(0.3, -0.035, 0.11)), hole: HULL_HOLE, outerZ: 0.22 },
    obstacles: [
      ...Array.from({ length: 9 }, (_, i): [number, number, number, number] => {
        const x = -0.4 + i * 0.1;
        return [x, -0.08, 0, 0.17 - Math.abs(x) * 0.12];
      }),
      [0.12, -0.13, -0.04, 0.06], // the treasure inside
      [-0.24, 0.3, 0, 0.12],
      [0.05, 0.3, 0, 0.12],
      [0.05, 0.5, 0, 0.08],
    ],
    bubbleSpots: [new THREE.Vector3(HULL_HOLE.x, HULL_HOLE.y + HULL_HOLE.ry, 0.15), new THREE.Vector3(-0.5, -0.17, -0.22)],
    update(timeS, sails) {
      time.value = timeS;
      if (sails) {
        sailUniforms.uTears.value = sails.tears;
        sailUniforms.uTearSize.value = Math.max(0.1, sails.tearSize);
        sailUniforms.uTearDetail.value = sails.tearDetail;
        sailUniforms.uFray.value = sails.fray;
        sailUniforms.uRips.value = sails.rips;
        sailUniforms.uWear.value = sails.wear;
        sailUniforms.uSway.value = sails.sway;
        sailUniforms.uPattern.value = Math.round(sails.pattern);
      }
      // The gold glimmers.
      glow.intensity = 0.002 * (1 + 0.3 * Math.sin(timeS * 1.7) + 0.1 * Math.sin(timeS * 5.3));
      lantern.intensity = 0.004 * (1 + 0.18 * Math.sin(timeS * 2.3) + 0.08 * Math.sin(timeS * 7.1));
      // The hoard's glow breathes slowly, with a quicker shimmer on top.
      const shimmer = 1 + 0.25 * Math.sin(timeS * 1.1) + 0.08 * Math.sin(timeS * 6.7);
      hoardLight.intensity = 0.002 * shimmer;
      halo.material.opacity = Math.min(1, 0.85 * shimmer);
    },
    dispose() {
      disposables.forEach((d) => d.dispose());
    },
  };
}

/** A soft round glow, white so the sprite's colour tints it. */
function drawHalo(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,255,0.9)");
  r.addColorStop(0.3, "rgba(255,255,255,0.35)");
  r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/** A weathered, torn sail: off-white canvas with stains and ragged holes. */
function drawSail(random: () => number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d")!;
  g.fillStyle = "#c9b98f";
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(70, 60, 30, ${0.05 + random() * 0.1})`;
    g.beginPath();
    g.arc(random() * 256, random() * 256, 10 + random() * 40, 0, Math.PI * 2);
    g.fill();
  }
  // Seams.
  g.strokeStyle = "rgba(80, 60, 30, 0.35)";
  for (let x = 32; x < 256; x += 48) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }
  // The tears are made in the sail's shader, so they can be adjusted live.
  return c;
}

/** A tattered black flag with a white skull and crossbones. */
function drawFlag(random: () => number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 160;
  c.height = 112;
  const g = c.getContext("2d")!;
  g.fillStyle = "#111111";
  g.fillRect(0, 0, 160, 112);
  g.fillStyle = g.strokeStyle = "#e8e2d0";
  // Crossbones.
  g.lineWidth = 9;
  g.lineCap = "round";
  for (const [x1, y1, x2, y2] of [
    [52, 70, 108, 100],
    [108, 70, 52, 100],
  ]) {
    g.beginPath();
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.stroke();
  }
  // Skull.
  g.beginPath();
  g.arc(80, 46, 24, 0, Math.PI * 2);
  g.fill();
  g.fillRect(68, 58, 24, 18);
  g.fillStyle = "#111111";
  g.beginPath();
  g.arc(71, 46, 6, 0, Math.PI * 2);
  g.arc(89, 46, 6, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(80, 52);
  g.lineTo(76, 60);
  g.lineTo(84, 60);
  g.fill();
  for (const x of [74, 80, 86]) g.fillRect(x - 1, 68, 2, 8);
  // A frayed, torn free end.
  g.globalCompositeOperation = "destination-out";
  g.beginPath();
  g.moveTo(160, 0);
  for (let y = 0; y <= 112; y += 8) g.lineTo(130 + random() * 30, y);
  g.lineTo(160, 112);
  g.fill();
  for (let i = 0; i < 4; i++) {
    g.beginPath();
    g.arc(20 + random() * 120, random() * 112, 3 + random() * 6, 0, Math.PI * 2);
    g.fill();
  }
  return c;
}

/** Small repeatable random numbers, so the wreck looks the same every time. */
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
