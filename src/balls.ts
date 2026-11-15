import * as THREE from "three";
import type { CubeColourMode, CubeCollider, RoomBounds, WallKey } from "./cubeRoom";
import { PaletteSampler } from "./palettes";

export type BallColourMode = "room" | "palette" | "single";

export const BALL_COLOUR_MODES: { id: BallColourMode; name: string }[] = [
  { id: "room", name: "Room colours" },
  { id: "palette", name: "Palette" },
  { id: "single", name: "One colour" },
];

export interface BallSettings {
  /** How many balls, 0 to MAX_BALLS. */
  ballCount: number;
  /** Size; 1 is a ball about 7% of the room's height across. */
  ballSize: number;
  /** How much sizes differ between balls, 0 (all the same) to 1. */
  ballSizeVariety: number;
  /** Share of speed kept in a bounce, 0 (dead) to 1 (perfectly bouncy). */
  ballBounce: number;
  /** 0 floats like zero-g; 1 falls across the room in about 0.7 s. */
  ballGravity: number;
  /** Air resistance: 0 none, 1 thick. */
  ballDrag: number;
  /** How much a wall or floor slows a ball sliding along it. */
  ballFriction: number;
  /** Balls bump into each other. */
  ballCollide: boolean;
  /** Moving cubes push the balls. */
  ballCubesPush: boolean;
  ballColourMode: BallColourMode;
  /** For "One colour". */
  ballColour: string;
  /** 0 matte to 1 glossy. */
  ballShine: number;
  /** How much the balls light up in their own colour. */
  ballGlow: number;
}

export const BALL_DEFAULTS: BallSettings = {
  ballCount: 0,
  ballSize: 1,
  ballSizeVariety: 0.4,
  ballBounce: 0.75,
  ballGravity: 1,
  ballDrag: 0.1,
  ballFriction: 0.2,
  ballCollide: true,
  ballCubesPush: true,
  ballColourMode: "room",
  ballColour: "#f2a83b",
  ballShine: 0.6,
  ballGlow: 0.3,
};

export const MAX_BALLS = 200;
/** Physics steps per frame: small steps keep fast balls from passing through each other. */
const SUBSTEPS = 4;

interface Ball {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  /** 0..1, fixed: sets the ball's share of the size variety, its palette colour and its flicker. */
  seed: number;
  radius: number;
  /** Proportional to volume, so bigger balls carry more weight in collisions. */
  mass: number;
}

/**
 * Balls bouncing around the cube room.
 *
 * They fall under gravity, bounce off the actual cube surfaces (so they roll
 * over cubes that stand out, drop into holes, and get kicked by cubes the
 * movement pushes out), bump into each other, and bounce off the window as
 * if it were glass. Sizes and physics are all scaled to the room, so they
 * behave the same on a laptop as on a TV.
 */
export class BallSystem {
  readonly mesh: THREE.InstancedMesh;
  private balls: Ball[] = [];
  private material: THREE.MeshStandardMaterial;
  private glow = { value: 0.3 };
  private palette = new PaletteSampler();
  private colour = new THREE.Color();
  private matrix = new THREE.Matrix4();
  private scaleVec = new THREE.Vector3();
  private identity = new THREE.Quaternion();
  private random = Math.random;
  private lastSizeKey = "";

  constructor() {
    const geometry = new THREE.SphereGeometry(1, 28, 18);
    this.material = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.1 });
    // A soft glow in the ball's own colour, like the cubes.
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.ballGlow = this.glow;
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float ballGlow;\nvoid main() {")
        .replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
           #ifdef USE_INSTANCING_COLOR
             totalEmissiveRadiance += vColor.rgb * ballGlow;
           #endif`,
        );
    };
    this.mesh = new THREE.InstancedMesh(geometry, this.material, MAX_BALLS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // Make sure the colour buffer exists before the first frame.
    this.mesh.setColorAt(0, this.colour.set(0xffffff));
  }

  /** Base radius for the current settings, in metres. */
  private baseRadius(s: BallSettings, bounds: RoomBounds): number {
    return 0.035 * s.ballSize * bounds.halfHeight * 2;
  }

  private radiusFor(seed: number, s: BallSettings, bounds: RoomBounds): number {
    // Spread sizes around the base, from about 0.4× to 1.6× at full variety.
    const spread = (seed * 2 - 1) * 0.6 * s.ballSizeVariety;
    const r = this.baseRadius(s, bounds) * (1 + spread);
    // Never so big that a ball can't fit in the room.
    return Math.min(r, bounds.halfHeight * 0.45, bounds.halfWidth * 0.45, bounds.depth * 0.45);
  }

  private spawn(s: BallSettings, bounds: RoomBounds): Ball {
    const seed = this.random();
    const radius = this.radiusFor(seed, s, bounds);
    const position = new THREE.Vector3(
      (this.random() * 2 - 1) * (bounds.halfWidth - radius),
      bounds.halfHeight - radius - this.random() * bounds.halfHeight * 0.6,
      -radius - this.random() * (bounds.depth - 2 * radius),
    );
    const speed = bounds.halfHeight * 0.6;
    const velocity = new THREE.Vector3(
      (this.random() * 2 - 1) * speed,
      (this.random() * 2 - 1) * speed * 0.3,
      (this.random() * 2 - 1) * speed,
    );
    return { position, velocity, seed, radius, mass: radius ** 3 };
  }

  /** Drops every ball again from near the top of the room. */
  drop(s: BallSettings, bounds: RoomBounds): void {
    this.balls = this.balls.map(() => this.spawn(s, bounds));
  }

  /** Gives every ball a random kick. */
  shake(bounds: RoomBounds): void {
    const kick = bounds.halfHeight * 4;
    for (const b of this.balls) {
      b.velocity.x += (this.random() * 2 - 1) * kick;
      b.velocity.y += this.random() * kick;
      b.velocity.z += (this.random() * 2 - 1) * kick;
    }
  }

  clear(): void {
    this.balls = [];
    this.mesh.count = 0;
  }

  update(
    dt: number,
    s: BallSettings,
    room: { bounds: RoomBounds; collider: CubeCollider },
    colours: { mode: CubeColourMode; palette: string[] },
  ): void {
    const { bounds, collider } = room;
    const want = Math.max(0, Math.min(MAX_BALLS, Math.round(s.ballCount)));
    while (this.balls.length < want) this.balls.push(this.spawn(s, bounds));
    if (this.balls.length > want) this.balls.length = want;

    // Size settings changed: resize every ball, keeping where it is.
    const sizeKey = `${s.ballSize}|${s.ballSizeVariety}|${bounds.halfHeight}|${bounds.halfWidth}|${bounds.depth}`;
    if (sizeKey !== this.lastSizeKey) {
      this.lastSizeKey = sizeKey;
      for (const b of this.balls) {
        b.radius = this.radiusFor(b.seed, s, bounds);
        b.mass = b.radius ** 3;
      }
    }

    if (dt > 0) {
      const h = Math.min(dt, 1 / 30) / SUBSTEPS;
      for (let step = 0; step < SUBSTEPS; step++) this.step(h, s, bounds, collider);
    }
    this.draw(s, collider, colours);
  }

  private step(h: number, s: BallSettings, bounds: RoomBounds, collider: CubeCollider): void {
    const height = bounds.halfHeight * 2;
    const gravity = s.ballGravity * 4 * height;
    const drag = Math.exp(-s.ballDrag * 3 * h);
    const bounce = THREE.MathUtils.clamp(s.ballBounce, 0, 1);
    const slide = Math.exp(-s.ballFriction * 12 * h);

    for (const b of this.balls) {
      b.velocity.y -= gravity * h;
      b.velocity.multiplyScalar(drag);
      b.position.addScaledVector(b.velocity, h);
      this.walls(b, bounds, collider, bounce, slide, s.ballCubesPush);
    }
    if (s.ballCollide) this.collideBalls(bounce);
  }

  /**
   * Keeps a ball inside the room. Each wall's surface is wherever the cube
   * under the ball has its face (further in where a cube stands out, further
   * out in a hole), and moves with it.
   */
  private walls(b: Ball, bounds: RoomBounds, collider: CubeCollider, bounce: number, slide: number, push: boolean): void {
    const { halfWidth: hw, halfHeight: hh, depth } = bounds;
    const p = b.position;
    const v = b.velocity;
    const r = b.radius;
    // [wall, axis, the wall's base coordinate, direction pointing into the room]
    const planes: [WallKey, "x" | "y" | "z", number, 1 | -1][] = [
      ["floor", "y", -hh, 1],
      ["ceiling", "y", hh, -1],
      ["left", "x", -hw, 1],
      ["right", "x", hw, -1],
      ["back", "z", -depth, 1],
    ];
    for (const [wall, axis, base, dir] of planes) {
      // Only look up the cube surface when the ball is near this wall.
      if ((p[axis] - base) * dir > r + hh) continue;
      const surface = collider.surface(wall, p);
      const level = base + dir * surface.offset;
      const gap = (p[axis] - level) * dir - r;
      if (gap >= 0) continue;
      p[axis] -= gap * dir;
      // Speeds measured into the room, so a cube pushing out has a positive speed.
      const ballSpeed = v[axis] * dir;
      const wallSpeed = push ? Math.max(0, surface.velocity) : 0;
      if (ballSpeed < wallSpeed) {
        v[axis] = dir * (wallSpeed + (wallSpeed - ballSpeed) * bounce);
      }
      // Sliding along the surface loses speed to friction.
      for (const other of ["x", "y", "z"] as const) if (other !== axis) v[other] *= slide;
    }
    // The window is glass: balls bounce off it instead of flying out.
    if (p.z + r > 0) {
      p.z = -r;
      if (v.z > 0) v.z = -v.z * bounce;
    }
  }

  private readonly delta = new THREE.Vector3();
  private collideBalls(bounce: number): void {
    const balls = this.balls;
    const d = this.delta;
    for (let i = 0; i < balls.length; i++) {
      const a = balls[i];
      for (let j = i + 1; j < balls.length; j++) {
        const b = balls[j];
        d.subVectors(b.position, a.position);
        const reach = a.radius + b.radius;
        const dist2 = d.lengthSq();
        if (dist2 >= reach * reach || dist2 === 0) continue;
        const dist = Math.sqrt(dist2);
        d.divideScalar(dist); // now the unit direction from a to b
        // Push them apart in proportion to the other's weight.
        const overlap = reach - dist;
        const total = a.mass + b.mass;
        a.position.addScaledVector(d, -overlap * (b.mass / total));
        b.position.addScaledVector(d, overlap * (a.mass / total));
        // Bounce along the line between their centres.
        const closing = a.velocity.dot(d) - b.velocity.dot(d);
        if (closing <= 0) continue;
        const impulse = ((1 + bounce) * closing) / total;
        a.velocity.addScaledVector(d, -impulse * b.mass);
        b.velocity.addScaledVector(d, impulse * a.mass);
      }
    }
  }

  private draw(s: BallSettings, collider: CubeCollider, colours: { mode: CubeColourMode; palette: string[] }): void {
    this.material.roughness = 1 - 0.9 * THREE.MathUtils.clamp(s.ballShine, 0, 1);
    this.material.metalness = 0.25 * THREE.MathUtils.clamp(s.ballShine, 0, 1);
    this.glow.value = Math.max(0, s.ballGlow);
    if (s.ballColourMode === "palette") this.palette.use(colours.palette);

    this.balls.forEach((b, i) => {
      this.matrix.compose(b.position, this.identity, this.scaleVec.setScalar(b.radius));
      this.mesh.setMatrixAt(i, this.matrix);
      if (s.ballColourMode === "single") this.colour.set(s.ballColour);
      else if (s.ballColourMode === "palette") this.palette.pick(this.colour, Math.floor(b.seed * 1000));
      else collider.colourAt(b.position, b.seed, this.colour);
      // Keep balls visible even where the room's effect is dark at that moment.
      const brightest = Math.max(this.colour.r, this.colour.g, this.colour.b);
      if (brightest < 0.08) this.colour.offsetHSL(0, 0, 0.08 - brightest);
      this.mesh.setColorAt(i, this.colour);
    });
    this.mesh.count = this.balls.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
