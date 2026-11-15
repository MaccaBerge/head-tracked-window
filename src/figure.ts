import * as THREE from "three";
import type { HeadTracker } from "./headTracker";
import type { WindowGeometry } from "./offAxis";
import type { DisplayProfile } from "./settings";

/** Hide the figure if the viewer hasn't been seen for this long. */
const STALE_AFTER_MS = 400;
/**
 * The grid room stands for a real room this tall. It sets the room's scale:
 * at figure size 1, a 1.75 m person is 70% as tall as the room.
 */
const ROOM_HEIGHT_M = 2.5;
/** At this distance the distance effect leaves the figure at its base size. */
const REFERENCE_DISTANCE_M = 2.5;
/** Keep the figure at least this share of the room depth away from the glass and back wall. */
const DEPTH_MARGIN = 0.05;

export interface FigureOptions {
  /** Show the figure at all. */
  enabled: boolean;
  /** Overall size: 1 is a person to scale with a 2.5 m tall room. */
  size: number;
  /** 0: the same size on screen at any distance; 1: half the size at twice the distance. */
  distanceEffect: number;
  /** Depth of the room behind the glass, in metres. */
  roomDepth: number;
}

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D map;
  uniform sampler2D mask;
  varying vec2 vUv;
  void main() {
    // Mirrored left-right, so the figure moves the way you do.
    vec2 uv = vec2(1.0 - vUv.x, vUv.y);
    // The mask's rows run top to bottom; the image's bottom to top.
    float m = texture2D(mask, vec2(uv.x, 1.0 - uv.y)).r;
    float alpha = smoothstep(0.35, 0.65, m);
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(texture2D(map, uv).rgb, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * The tracked viewer, cut out of the webcam image and standing on the floor
 * of the grid room, as a scale model of a person in a 2.5 m tall room.
 *
 * Your distance from the camera sets how far into the room the figure stands
 * (in the room's scale), and moving sideways moves it sideways. The lowest
 * visible part of you rests on the floor: your feet when the camera sees all
 * of you, your chest or waist when you sit close.
 */
export class MirrorFigure {
  readonly mesh: THREE.Mesh;
  private material: THREE.ShaderMaterial;
  private image: THREE.CanvasTexture | null = null;
  private mask: THREE.DataTexture | null = null;
  private version = -1;
  /** Lowest row of the mask that is you, 0 (top) to 1 (bottom), smoothed. */
  private bottom = -1;
  /** Why the figure is or isn't showing, for the panel. */
  state = "";

  constructor() {
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, mask: { value: null } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
    this.mesh.visible = false;
  }

  update(tracker: HeadTracker, profile: DisplayProfile, win: WindowGeometry, options: FigureOptions): void {
    const head = tracker.head;
    const cut = tracker.cutout;
    const fresh = performance.now() - tracker.lastSeen < STALE_AFTER_MS;
    this.mesh.visible = options.enabled && fresh && head !== null && cut !== null && cut.version > 0;
    this.state = !options.enabled
      ? "off"
      : !head || !fresh
        ? "hidden: nobody tracked"
        : !cut || cut.version === 0
          ? "hidden: no cutout yet"
          : "showing";
    if (!this.mesh.visible || !head || !cut) {
      this.bottom = -1;
      return;
    }

    if (cut.version !== this.version) {
      this.version = cut.version;
      this.uploadTextures(cut.image, cut.mask, cut.maskWidth, cut.maskHeight);
      const found = lowestRow(cut.mask, cut.maskWidth, cut.maskHeight);
      if (found >= 0) {
        // Smoothed, so the figure doesn't bob as the outline's lowest pixel flickers.
        this.bottom = this.bottom < 0 ? found : this.bottom + 0.3 * (found - this.bottom);
      }
    }
    if (this.bottom < 0) return;

    // How the room is scaled: window height stands for 2.5 m.
    const roomScale = (options.size * win.height) / ROOM_HEIGHT_M;
    const distance = Math.max(0.2, head.z);
    const shrink = Math.pow(REFERENCE_DISTANCE_M / distance, options.distanceEffect);
    // The webcam image, made life-size at your distance and then scaled down to the room.
    const lifeWidth = 2 * distance * Math.tan(THREE.MathUtils.degToRad(profile.cameraHfovDeg) / 2);
    const lifeHeight = (lifeWidth * cut.image.height) / cut.image.width;
    const scale = roomScale * shrink;
    const width = lifeWidth * scale;
    const height = lifeHeight * scale;

    // Sideways: where you are, in the room's scale. Your eyes sit at head.x
    // in the life-size image, so the image is shifted to put them there.
    const roomX = (win.cameraX + head.x) * roomScale;
    const x = roomX - head.x * scale;
    // Down: the lowest visible part of you on the floor.
    const floor = -win.height / 2;
    const y = floor - (0.5 - this.bottom) * height;
    // Into the room: your distance, in the room's scale, kept inside the room.
    const z = -THREE.MathUtils.clamp(
      distance * roomScale,
      DEPTH_MARGIN * options.roomDepth,
      (1 - DEPTH_MARGIN) * options.roomDepth,
    );

    this.mesh.position.set(x, y, z);
    this.mesh.rotation.set(0, 0, 0);
    this.mesh.scale.set(width, height, 1);
    this.state = `showing ${(-z * 100).toFixed(0)} cm into the room`;
  }

  private uploadTextures(image: HTMLCanvasElement, mask: Uint8Array, w: number, h: number): void {
    if (!this.image || this.image.image !== image) {
      this.image?.dispose();
      this.image = new THREE.CanvasTexture(image);
      this.image.colorSpace = THREE.SRGBColorSpace;
      this.material.uniforms.map.value = this.image;
    }
    this.image.needsUpdate = true;

    if (!this.mask || this.mask.image.width !== w || this.mask.image.height !== h) {
      this.mask?.dispose();
      this.mask = new THREE.DataTexture(mask, w, h, THREE.RedFormat, THREE.UnsignedByteType);
      this.mask.minFilter = THREE.LinearFilter;
      this.mask.magFilter = THREE.LinearFilter;
      this.mask.unpackAlignment = 1;
      this.material.uniforms.mask.value = this.mask;
    }
    this.mask.image.data = mask;
    this.mask.needsUpdate = true;
  }
}

/** The lowest row (0 top to 1 bottom) containing a fair amount of person, or -1 if none. */
function lowestRow(mask: Uint8Array, w: number, h: number): number {
  // A few pixels are enough to count, so a stray speck doesn't set the floor line.
  const needed = Math.max(3, Math.round(w * 0.01));
  for (let y = h - 1; y >= 0; y--) {
    let count = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (mask[row + x] > 127 && ++count >= needed) return (y + 1) / h;
    }
  }
  return -1;
}
