import type { Group, Vector3 } from "three";
import type { WindowGeometry } from "./offAxis";

/** Something that can be shown behind the window. */
export interface Room {
  group: Group;
  /** Hide everything in front of the window pane (no pop-out). */
  clipAtWindow?: boolean;
  /** Download progress from 0 to 1 while the room is loading; absent once ready. */
  loading?: number;
  /** Called every frame with the viewer's eye position (window space, metres); rooms can animate here. */
  update(timeS: number, eye?: Vector3): void;
  /** Called when the window changes size. Rooms without it are rebuilt instead. */
  resize?(win: WindowGeometry): void;
  dispose(): void;
}

/** Where a splat sits behind the window. Adjustable in the panel and saved per room. */
export interface Placement {
  /**
   * Width of the window opening, in the room's own units. The room is scaled
   * so this width fills the screen, whatever the screen's physical size: a
   * laptop shows the same view as a TV, as a smaller model of it.
   */
  windowWidth: number;
  /** Where the splat's origin sits relative to the centre of the window, in room units. */
  position: [number, number, number];
  /** Rotation in degrees (x, y, z). Most captures are upside down: [180, 0, 0]. */
  rotationDeg: [number, number, number];
}

export interface GridRoomConfig {
  type: "grid";
  id: string;
  name: string;
}

export interface SplatRoomConfig extends Placement {
  type: "splat";
  id: string;
  name: string;
  /** Splat file: .spz, .ply, .splat, .ksplat or .sog. */
  url: string;
  /** Original file name, needed to recognise the format of a dropped file. */
  fileName?: string;
  /** Added by the user in the browser (stored there, not in the project). */
  user?: boolean;
}

/** A box room made of colour-changing cubes (see cubeRoom.ts). */
export interface CubeRoomConfig {
  type: "cubes";
  id: string;
  name: string;
}

export type RoomConfig = GridRoomConfig | CubeRoomConfig | SplatRoomConfig;

/** Rooms built in real metres around the window, rather than loaded scenes. */
export function isBoxRoom(c: RoomConfig): c is GridRoomConfig | CubeRoomConfig {
  return c.type === "grid" || c.type === "cubes";
}

/** Rooms that ship with the project. The placements here are the defaults. */
export const ROOMS: RoomConfig[] = [
  { type: "grid", id: "grid", name: "Grid room" },
  { type: "cubes", id: "cubes", name: "Cube room" },
  {
    type: "splat",
    id: "fireplace",
    name: "Fireplace (sample)",
    url: `${import.meta.env.BASE_URL}splats/fireplace.spz`,
    windowWidth: 3.2,
    position: [0, 0.3, -2.5],
    rotationDeg: [180, 0, 0],
  },
  {
    type: "splat",
    id: "custom_1",
    name: "Custom 1",
    url: `${import.meta.env.BASE_URL}splats/custom_1.ply`,
    windowWidth: 3.6,
    position: [-0.9, 0.75, 1.5],
    rotationDeg: [180, 0, 0],
  },
  {
    type: "splat",
    id: "custom_2",
    name: "Custom 2",
    url: `${import.meta.env.BASE_URL}splats/custom_2.ply`,
    // Facing the wall with the framed pictures, the plant and the armchair.
    windowWidth: 3,
    position: [-1, 0.3, 1.6],
    rotationDeg: [180, 90, 0],
  },
];
