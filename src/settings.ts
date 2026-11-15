import { AQUARIUM_DEFAULTS, type AquariumSettings } from "./aquarium";
import { BALL_DEFAULTS, type BallSettings } from "./balls";
import { CUBE_DEFAULTS, type CubeRoomSettings } from "./cubeRoom";
import { MIRROR_DEFAULTS, type MirrorSettings } from "./mirror";
import type { Placement } from "./rooms";

/** One physical setup: a display and where the webcam sits relative to it. */
export interface DisplayProfile {
  id: string;
  name: string;
  /** Diagonal of the display, in inches. */
  diagonalIn: number;
  /** Horizontal field of view of the webcam, in degrees. */
  cameraHfovDeg: number;
  /** Whether the webcam is above the display's top edge or below its bottom edge. */
  cameraEdge: "top" | "bottom";
  /** Distance from that edge to the lens, in metres. */
  cameraGapM: number;
  /** How far the lens is to the right of the display's centre line, in metres. */
  cameraSideM: number;
  /** How far the lens is in front of the display surface, in metres. */
  cameraForwardM: number;
  /** How far the webcam is tilted upwards, in degrees (a laptop lid leaning back). */
  cameraTiltDeg: number;
}

export interface Settings extends CubeRoomSettings, BallSettings, AquariumSettings, MirrorSettings {
  /** The view follows the viewer's head (or the mouse). Off: a fixed view straight ahead. */
  followHead: boolean;
  /** Single-letter keyboard shortcuts (H, F, M, P). Can be turned off (WCAG 2.1.4). */
  shortcuts: boolean;
  /** True once the person has used the shortcuts switch; until then shortcuts are always on. */
  shortcutsChosen: boolean;
  profiles: DisplayProfile[];
  profileId: string;
  /** Which room is showing. */
  roomId: string;
  /** Saved placement per splat room, keyed by room id. */
  placements: Record<string, Placement>;
  /** Grid room: depth as a multiple of the window width. */
  roomDepth: number;
  /** Grid room: show the depth-target balls. */
  showObjects: boolean;
  /** Grid room: show the viewer, cut out of the webcam image, inside the room. */
  showFigure: boolean;
  /** How much the figure shrinks with distance: 0 not at all, 1 half the size at twice the distance. */
  figureDistanceEffect: number;
  /** Size of the figure: 1 is a person to scale with a 2.5 m tall room. */
  figureSize: number;
  showHud: boolean;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function defaults(): Settings {
  return {
    profiles: [
      {
        id: "macbook",
        name: "MacBook",
        diagonalIn: 13.3,
        cameraHfovDeg: 60,
        cameraEdge: "top",
        cameraGapM: 0.008,
        cameraSideM: 0,
        cameraForwardM: 0,
        cameraTiltDeg: 0,
      },
      {
        // The MacBook sitting open below a TV, its webcam doing the tracking.
        id: "tv",
        name: "TV",
        diagonalIn: 55,
        cameraHfovDeg: 60,
        cameraEdge: "bottom",
        cameraGapM: 0.1,
        cameraSideM: 0,
        cameraForwardM: 0.2,
        cameraTiltDeg: 15,
      },
    ],
    followHead: true,
    shortcuts: true,
    shortcutsChosen: false,
    profileId: "macbook",
    roomId: "grid",
    placements: {},
    roomDepth: 2,
    showObjects: true,
    showFigure: true,
    figureDistanceEffect: 1,
    figureSize: 1,
    ...CUBE_DEFAULTS,
    ...BALL_DEFAULTS,
    ...AQUARIUM_DEFAULTS,
    ...MIRROR_DEFAULTS,
    // For people who've asked their system for less motion, the cube walls start still.
    cubeMotion: prefersReducedMotion() ? "none" : CUBE_DEFAULTS.cubeMotion,
    cubePalettes: {},
    showHud: true,
  };
}

const KEY = "window-room-settings-v2";
const OLD_KEY = "window-room-settings-v1";

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const s = { ...d, ...parsed } as Settings;
      // Earlier versions had a single cube colour: it becomes the one-colour palette.
      if (typeof parsed.cubeColour === "string" && !s.cubePalettes.solid) {
        s.cubePalettes = { ...s.cubePalettes, solid: [parsed.cubeColour] };
      }
      delete (s as Partial<{ cubeColour: string }>).cubeColour;
      // Earlier versions had an on/off switch for the rippling cubes.
      if (parsed.cubeRipple === false && parsed.cubeMotion === undefined) s.cubeMotion = "none";
      delete (s as Partial<{ cubeRipple: boolean }>).cubeRipple;
      // Shortcuts are off only if the person turned them off. An earlier version
      // could save "off" by accident, which this undoes.
      if (s.shortcutsChosen !== true || typeof s.shortcuts !== "boolean") {
        s.shortcuts = true;
        s.shortcutsChosen = false;
      }
      if (Array.isArray(s.profiles) && s.profiles.length) return s;
    }
    // Carry over the screen size and calibration from the first version.
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const o = JSON.parse(old);
      if (o.displayDiagonalIn > 0) d.profiles[0].diagonalIn = o.displayDiagonalIn;
      if (o.cameraHfovDeg > 0) d.profiles.forEach((p) => (p.cameraHfovDeg = o.cameraHfovDeg));
      if (typeof o.roomId === "string") d.roomId = o.roomId;
    }
  } catch {
    // Storage unavailable or corrupt: fall back to defaults.
  }
  return d;
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not fatal: settings just won't persist.
  }
}

export function activeProfile(s: Settings): DisplayProfile {
  return s.profiles.find((p) => p.id === s.profileId) ?? s.profiles[0];
}
