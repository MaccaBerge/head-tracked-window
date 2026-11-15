import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-mono/400.css";
import {
  ArrowDownToLine,
  ArrowUpDown,
  Camera,
  CameraOff,
  ChevronRight,
  Copy,
  CopyPlus,
  Crosshair,
  FilePlus,
  Maximize,
  Minus,
  MousePointer2,
  Move,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Scan,
  ScanFace,
  Shuffle,
  Trash,
  Upload,
  X,
  Zap,
  createElement,
  createIcons,
} from "lucide";
import * as THREE from "three";
import { AQUA_SCENES, WATER_STYLES, createAquarium, type AquariumSettings } from "./aquarium";
import { BALL_COLOUR_MODES, BallSystem, type BallSettings } from "./balls";
import { MirrorFigure } from "./figure";
import {
  CUBE_COLOUR_MODES,
  CUBE_DEFAULTS,
  CUBE_LAYOUT_KEYS,
  CUBE_LAYOUTS,
  CUBE_MOTIONS,
  CUBE_TURNS,
  MOTION,
  createCubeRoom,
  paletteFor,
  type CubeRoom,
  type CubeRoomSettings,
} from "./cubeRoom";
import { PALETTE_PRESETS } from "./palettes";
import { createGridRoom } from "./gridRoom";
import { HandTracker } from "./handTracker";
import { HeadTracker } from "./headTracker";
import { createMirror, type MirrorRoom, type MirrorSettings } from "./mirror";
import { applyOffAxis, measureWindow, type WindowGeometry } from "./offAxis";
import { ROOMS, isBoxRoom, type Placement, type Room, type RoomConfig, type SplatRoomConfig } from "./rooms";
import { activeProfile, loadSettings, saveSettings, type DisplayProfile } from "./settings";
import type { SplatRoom } from "./splatRoom";
import { addUserRoom, deleteUserRoom, isSplatFile, listUserRooms } from "./userRooms";

// Line icons for the panel (placeholders are <i data-lucide="name"> in index.html).
createIcons({
  icons: {
    ArrowDownToLine,
    ArrowUpDown,
    Camera,
    CameraOff,
    ChevronRight,
    Copy,
    CopyPlus,
    Crosshair,
    FilePlus,
    Maximize,
    Minus,
    MousePointer2,
    Move,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    RotateCcw,
    Scan,
    ScanFace,
    Shuffle,
    Trash,
    Upload,
    Zap,
  },
});

const settings = loadSettings();
const tracker = new HeadTracker(settings);
// Hands are only looked for in the mirror room, where they wipe the glass.
const handTracker = new HandTracker(tracker.video);
const profile = (): DisplayProfile => activeProfile(settings);

// ---------- Scene ----------
const canvas = document.getElementById("scene") as HTMLCanvasElement;
// No WebGL anti-aliasing: it does nothing for splats and costs a lot.
const renderer = new THREE.WebGLRenderer({ canvas });
const scene = new THREE.Scene();
const DEFAULT_BACKGROUND = new THREE.Color(0x04070b);
scene.background = DEFAULT_BACKGROUND;
const camera = new THREE.PerspectiveCamera();

/*
 * Splat rooms need Spark, the largest library here. It is loaded the first
 * time a splat room is opened, so the grid and cube rooms start without it.
 */
type SplatModule = typeof import("./splatRoom");
let splatModule: SplatModule | null = null;
let splatSupport: Promise<void> | null = null;
function loadSplatSupport(): Promise<void> {
  splatSupport ??= Promise.all([import("./splatRoom"), import("@sparkjsdev/spark")]).then(([mod, spark]) => {
    splatModule = mod;
    // Spark draws every splat room in the scene through this one object.
    scene.add(new spark.SparkRenderer({ renderer }));
  });
  return splatSupport;
}
/** Turns a placement, once splat support has loaded (it always has when a splat room is showing). */
function rotate(p: Placement, axis: "x" | "y" | "z", degrees: number): Placement {
  return splatModule ? splatModule.rotatePlacement(p, axis, degrees) : p;
}
// The viewer, cut out of the webcam image and stood inside the room.
const figure = new MirrorFigure();
scene.add(figure.mesh);
// Balls bouncing around the cube room. They outlive room rebuilds (a layout change keeps them).
const balls = new BallSystem();
scene.add(balls.mesh);
/** The current room, if it's one balls can bounce around in. */
function ballRoom(): CubeRoom | null {
  return room && "collider" in room ? (room as CubeRoom) : null;
}

/** Built-in rooms plus the files the user has added in the browser. */
const rooms: RoomConfig[] = [...ROOMS];
let win: WindowGeometry = measureWindow(profile());
let room: Room | null = null;
let splatRoom: SplatRoom | null = null;
let roomId = "";

function currentConfig(): RoomConfig {
  return rooms.find((r) => r.id === settings.roomId) ?? rooms[0];
}

function defaultPlacement(c: SplatRoomConfig): Placement {
  return { windowWidth: c.windowWidth, position: [...c.position], rotationDeg: [...c.rotationDeg] };
}

/** Re-measures the window and brings the room in line with the settings. */
function rebuild(): void {
  win = measureWindow(profile());
  const config = currentConfig();
  // Splats are heavy at full Retina resolution; lines need it to look clean.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, config.type === "splat" ? 1.25 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);

  if (room && roomId === config.id && room.resize) {
    room.resize(win);
  } else {
    if (room) {
      scene.remove(room.group);
      room.dispose();
    }
    roomId = config.id;
    room = null;
    if (config.type === "splat" && !splatModule) {
      // First splat room: fetch Spark, then build whichever room is current by then.
      splatRoom = null;
      void loadSplatSupport().then(
        () => {
          roomId = "";
          rebuild();
        },
        () => flash("Couldn't load the splat renderer"),
      );
    } else if (config.type === "splat" && splatModule) {
      const saved = settings.placements[config.id];
      splatRoom = splatModule.createSplatRoom(config, saved ?? defaultPlacement(config), win);
      room = splatRoom;
      // A file the user just added has no placement yet: guess one.
      if (config.user && !saved) autoFit();
    } else {
      splatRoom = null;
      const depth = win.width * settings.roomDepth;
      room =
        config.type === "mirror"
          ? createMirror(win.width, win.height, settings, {
              renderer,
              video: tracker.video,
              hands: handTracker,
              body: () => tracker.body?.landmarks ?? null,
              canvas,
            })
          : config.type === "aquarium"
          ? createAquarium(win.width, win.height, settings)
          : config.type === "cubes"
            ? createCubeRoom(win.width, win.height, depth, settings)
            : createGridRoom(win.width, win.height, depth, settings.showObjects);
    }
    if (room) scene.add(room.group);
    // Rooms like the aquarium bring their own haze and background.
    scene.fog = room?.fog ?? null;
    scene.background = room?.background ?? DEFAULT_BACKGROUND;
    if (import.meta.env.DEV) Object.assign(window, { room, tracker, balls });
  }
  syncHud();
}

function commit(): void {
  saveSettings(settings);
  rebuild();
}

/**
 * For sliders that rebuild the room: save now, but rebuild at most once per
 * frame, so dragging doesn't rebuild hundreds of cubes on every input event.
 */
let rebuildQueued = false;
function commitSoon(): void {
  saveSettings(settings);
  if (rebuildQueued) return;
  rebuildQueued = true;
  requestAnimationFrame(() => {
    rebuildQueued = false;
    rebuild();
  });
}

// ---------- Room placement ----------
function setPlacement(p: Placement): void {
  if (!splatRoom) return;
  p.windowWidth = Math.max(0.01, p.windowWidth);
  splatRoom.setPlacement(p);
  settings.placements[roomId] = p;
  saveSettings(settings);
  syncPlacement();
}

function autoFit(): void {
  const target = splatRoom;
  if (!target) return;
  void target.suggestPlacement().then((p) => {
    if (splatRoom === target) setPlacement(p);
  });
}

let adjusting = false;
function setAdjusting(on: boolean): void {
  adjusting = on && splatRoom !== null;
  document.body.classList.toggle("adjusting", adjusting);
  el.adjust.classList.toggle("active", adjusting);
}

let drag: { x: number; y: number } | null = null;
canvas.addEventListener("pointerdown", (e) => {
  if (!adjusting) return;
  drag = { x: e.clientX, y: e.clientY };
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => (drag = null));
canvas.addEventListener("pointermove", (e) => {
  if (!drag || !splatRoom) return;
  const dx = e.clientX - drag.x;
  const dy = e.clientY - drag.y;
  drag = { x: e.clientX, y: e.clientY };
  let p = splatRoom.placement;
  if (e.shiftKey) {
    p = rotate(rotate(p, "y", dx * 0.15), "x", dy * 0.15);
  } else {
    const perPx = p.windowWidth / window.innerWidth;
    p = { ...p, position: [p.position[0] + dx * perPx, p.position[1] - dy * perPx, p.position[2]] };
  }
  setPlacement(p);
});
canvas.addEventListener(
  "wheel",
  (e) => {
    if (!adjusting || !splatRoom) return;
    e.preventDefault();
    const p = splatRoom.placement;
    if (e.altKey) {
      setPlacement({ ...p, windowWidth: p.windowWidth * Math.exp(e.deltaY * 0.002) });
    } else {
      const dz = -e.deltaY * 0.001 * p.windowWidth;
      setPlacement({ ...p, position: [p.position[0], p.position[1], p.position[2] + dz] });
    }
  },
  { passive: false },
);

// ---------- Viewer position ----------
/** Where the eye rests when nobody is tracked: centred, at arm's length. */
const REST_DISTANCE = 0.6;
/** After this long without the viewer, drift back to the rest position. */
const REST_AFTER_MS = 2000;

const eye = new THREE.Vector3(0, 0, REST_DISTANCE);
const target = new THREE.Vector3(0, 0, REST_DISTANCE);
let mouseMode = false;
const mouse = { x: 0, y: 0, z: REST_DISTANCE };

window.addEventListener("pointermove", (e) => {
  mouse.x = (e.clientX / window.innerWidth - 0.5) * 0.8;
  mouse.y = -(e.clientY / window.innerHeight - 0.5) * 0.5;
});
window.addEventListener(
  "wheel",
  (e) => {
    if (!mouseMode || adjusting) return;
    mouse.z = THREE.MathUtils.clamp(mouse.z + e.deltaY * 0.001, 0.15, 4);
  },
  { passive: true },
);

/**
 * Where the viewer really is (their head, or the mouse in mouse mode), in
 * window space, whatever the view is doing. Rooms react to this, so fish
 * still come to look at you with Follow head off. Null while nobody is seen.
 */
const viewer = new THREE.Vector3();
const viewerTarget = new THREE.Vector3();
let viewerSeen = false;

function updateViewer(now: number, dt: number): void {
  let seen = true;
  if (mouseMode) {
    viewerTarget.set(mouse.x, mouse.y, mouse.z);
  } else if (tracker.head && now - tracker.lastSeen < REST_AFTER_MS) {
    // Camera space -> window space: undo the camera's upward tilt, then
    // shift by where the lens sits relative to the centre of the window.
    const p = profile();
    const tilt = THREE.MathUtils.degToRad(p.cameraTiltDeg);
    const h = tracker.head;
    const y = h.y * Math.cos(tilt) + h.z * Math.sin(tilt);
    const z = -h.y * Math.sin(tilt) + h.z * Math.cos(tilt);
    viewerTarget.set(h.x + win.cameraX, y + win.cameraY, z + p.cameraForwardM);
  } else {
    seen = false;
  }
  // Light smoothing between webcam frames; jump straight there when first seen.
  if (seen && !viewerSeen) viewer.copy(viewerTarget);
  else if (seen) viewer.lerp(viewerTarget, 1 - Math.exp(-dt / 0.03));
  viewerSeen = seen;
}

function updateEye(now: number, dt: number): void {
  updateViewer(now, dt);
  let timeConstant = 0.03; // light smoothing between webcam frames
  if (adjusting) {
    // Hold the view still while the room is being placed.
    target.set(0, 0, REST_DISTANCE);
    timeConstant = 0.15;
  } else if (mouseMode) {
    // The mouse steers the view, whether or not head following is on.
    target.copy(viewerTarget);
    timeConstant = 0.06;
  } else if (!settings.followHead) {
    // Head following switched off: a fixed view, straight on. Eased, so switching isn't a jump.
    target.set(0, 0, REST_DISTANCE);
    timeConstant = 0.25;
  } else if (viewerSeen) {
    // The view follows the viewer.
    target.copy(viewerTarget);
  } else {
    target.set(0, 0, REST_DISTANCE);
    timeConstant = 0.6;
  }
  eye.lerp(target, 1 - Math.exp(-dt / timeConstant));
}

// ---------- Panel ----------
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const button = (id: string) => $<HTMLButtonElement>(id);
const el = {
  hud: $("hud"),
  loading: $("loading"),
  dropHint: $("drop-hint"),
  dot: $("status-dot"),
  status: $("status"),
  fps: $("fps"),
  eye: $("eye"),
  winsize: $("winsize"),
  cutoutLabel: $("cutout-label"),
  cutout: $("cutout"),
  preview: $("preview"),
  overlay: $<HTMLCanvasElement>("preview-overlay"),
  room: $<HTMLSelectElement>("in-room"),
  addFile: button("btn-add-file"),
  removeRoom: button("btn-remove-room"),
  file: input("in-file"),
  gridOptions: $("grid-options"),
  depth: input("in-depth"),
  objects: input("in-objects"),
  objectsRow: $("objects-row"),
  cubeOptions: $("cube-options"),
  cubeMode: $<HTMLSelectElement>("in-cube-mode"),
  swatches: $("palette-swatches"),
  paletteHint: $("palette-hint"),
  palettePreset: $<HTMLSelectElement>("in-palette-preset"),
  paletteReset: button("btn-palette-reset"),
  cubeSpeed: input("in-cube-speed"),
  cubeLayout: $<HTMLSelectElement>("in-cube-layout"),
  cubeMotion: $<HTMLSelectElement>("in-cube-motion"),
  cubeTurn: $<HTMLSelectElement>("in-cube-turn"),
  cubeTurnAmountRow: $("cube-turn-amount-row"),
  cubeSliders: [...document.querySelectorAll<HTMLInputElement>("input[data-cube]")],
  mosaicOnly: [...document.querySelectorAll<HTMLElement>(".mosaic-only")],
  figure: input("in-figure"),
  figureDistance: input("in-figure-distance"),
  figureSize: input("in-figure-size"),
  placement: $("sec-placement"),
  adjust: button("btn-adjust"),
  pw: input("in-pw"),
  px: input("in-px"),
  py: input("in-py"),
  pz: input("in-pz"),
  profile: $<HTMLSelectElement>("in-profile"),
  profileName: input("in-profile-name"),
  profileDelete: button("btn-profile-delete"),
  camEdge: $<HTMLSelectElement>("in-cam-edge"),
  calibrate: button("btn-calibrate"),
  mouse: button("btn-mouse"),
  follow: button("btn-follow"),
  cameraBtn: button("btn-camera"),
  cameraLabel: document.querySelector("#btn-camera span") as HTMLElement,
  shortcuts: input("in-shortcuts"),
  shortcutsOff: $("shortcuts-off"),
  shortcutsOn: button("btn-shortcuts-on"),
  hideHud: button("btn-hide-hud"),
  showHud: button("btn-show-hud"),
  fullscreen: button("btn-fullscreen"),
};
el.preview.prepend(tracker.video);

const fmt = (v: number, digits = 2) => String(+v.toFixed(digits));

/** Numeric fields of the active display profile: [input, read, write]. */
const profileFields: [HTMLInputElement, (p: DisplayProfile) => number, (p: DisplayProfile, v: number) => void][] = [
  [input("in-diagonal"), (p) => p.diagonalIn, (p, v) => (p.diagonalIn = THREE.MathUtils.clamp(v, 5, 300))],
  [input("in-fov"), (p) => p.cameraHfovDeg, (p, v) => (p.cameraHfovDeg = THREE.MathUtils.clamp(v, 30, 120))],
  [input("in-cam-gap"), (p) => p.cameraGapM * 100, (p, v) => (p.cameraGapM = Math.max(0, v) / 100)],
  [input("in-cam-side"), (p) => p.cameraSideM * 100, (p, v) => (p.cameraSideM = v / 100)],
  [input("in-cam-forward"), (p) => p.cameraForwardM * 100, (p, v) => (p.cameraForwardM = v / 100)],
  [input("in-cam-tilt"), (p) => p.cameraTiltDeg, (p, v) => (p.cameraTiltDeg = THREE.MathUtils.clamp(v, -60, 60))],
];

function fillSelect(select: HTMLSelectElement, items: { id: string; name: string }[], value: string): void {
  select.replaceChildren(...items.map((i) => new Option(i.name, i.id)));
  select.value = value;
}

function syncPlacement(): void {
  if (!splatRoom) return;
  const p = splatRoom.placement;
  el.pw.value = fmt(p.windowWidth);
  el.px.value = fmt(p.position[0]);
  el.py.value = fmt(p.position[1]);
  el.pz.value = fmt(p.position[2]);
}

/** Brings every control in the panel in line with the current state. */
function syncHud(): void {
  const config = currentConfig();
  fillSelect(el.room, rooms, config.id);
  el.removeRoom.hidden = !(config.type === "splat" && config.user);
  el.gridOptions.hidden = !isBoxRoom(config);
  el.objectsRow.hidden = config.type !== "grid";
  el.cubeOptions.hidden = config.type !== "cubes";
  aquariumOptions.hidden = config.type !== "aquarium";
  mirrorOptions.hidden = config.type !== "mirror";
  syncMirrorControls();
  syncTankControls();
  el.cubeMode.value = settings.cubeColourMode;
  buildPaletteEditor();
  el.cubeSpeed.value = String(settings.cubeSpeed);
  syncCubeControls();
  syncBallControls();
  el.placement.hidden = config.type !== "splat";
  if (config.type !== "splat") setAdjusting(false);
  el.depth.value = String(settings.roomDepth);
  el.objects.checked = settings.showObjects;
  el.figure.checked = settings.showFigure;
  el.figureDistance.value = String(settings.figureDistanceEffect);
  el.figureDistance.disabled = !settings.showFigure;
  el.figureSize.value = String(settings.figureSize);
  el.figureSize.disabled = !settings.showFigure;
  syncPlacement();

  const p = profile();
  fillSelect(el.profile, settings.profiles, p.id);
  el.profileDelete.disabled = settings.profiles.length < 2;
  el.profileName.value = p.name;
  el.camEdge.value = p.cameraEdge;
  for (const [field, read] of profileFields) field.value = fmt(read(p), 1);

  el.hud.classList.toggle("hidden", !settings.showHud);
  el.showHud.hidden = settings.showHud;
  syncSliderReadouts();
  el.winsize.textContent = `${(win.width * 100).toFixed(1)} × ${(win.height * 100).toFixed(1)} cm`;
}

/** A line icon built in code, styled like the ones placed in index.html. */
function lineIcon(icon: Parameters<typeof createElement>[0]): SVGElement {
  const svg = createElement(icon);
  svg.classList.add("lucide");
  return svg;
}

// ---------- Slider readouts and fills ----------
function percent(v: number): string {
  return `${Math.round(v * 100)}%`;
}
function times(v: number): string {
  return `${v < 1 ? v.toFixed(2) : v.toFixed(1)}×`;
}
function degrees(v: number): string {
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}°`;
}
/** Readouts for the sliders that aren't cube settings, keyed by the slider's id. */
const sliderReadouts: Record<string, () => string> = {
  "in-depth": () => times(settings.roomDepth),
  "in-figure-size": () => times(settings.figureSize),
  "in-figure-distance": () => settings.figureDistanceEffect.toFixed(2),
  "in-cube-speed": () => times(settings.cubeSpeed),
};
/** Fills each slider's track up to its value (the --p custom property in style.css). */
function fillSlider(slider: HTMLInputElement): void {
  const min = parseFloat(slider.min || "0");
  const max = parseFloat(slider.max || "100");
  const p = max > min ? ((parseFloat(slider.value) - min) / (max - min)) * 100 : 0;
  slider.style.setProperty("--p", `${p}%`);
}
function syncSliderReadouts(): void {
  for (const [id, read] of Object.entries(sliderReadouts)) {
    const out = document.querySelector<HTMLOutputElement>(`output[data-for="${id}"]`);
    if (out) out.textContent = read();
  }
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((slider) => {
    fillSlider(slider);
    describeSlider(slider);
  });
}
/** Screen readers announce the same text as the readout ("35%"), not the raw slider position. */
function describeSlider(slider: HTMLInputElement): void {
  const text = slider.parentElement?.querySelector("output")?.textContent;
  if (text) slider.setAttribute("aria-valuetext", text);
}
// Any slider moved by hand: refill its track and update its readout after its own handler has run.
document.addEventListener("input", (e) => {
  const t = e.target;
  if (!(t instanceof HTMLInputElement) || t.type !== "range") return;
  fillSlider(t);
  queueMicrotask(() => {
    const read = sliderReadouts[t.id];
    const out = document.querySelector<HTMLOutputElement>(`output[data-for="${t.id}"]`);
    if (read && out) out.textContent = read();
    describeSlider(t);
  });
});

/** Says something to screen readers through the status region (cleared first, so a repeat is read again). */
const announcer = document.getElementById("announcer") as HTMLElement;
let lastAnnouncement = "";
function announce(text: string): void {
  // VoiceOver skips a message identical to the previous one; a no-break space makes it differ.
  const message = text === lastAnnouncement ? `${text}\u00a0` : text;
  lastAnnouncement = message;
  announcer.textContent = "";
  requestAnimationFrame(() => (announcer.textContent = message));
}

let notice = "";
let noticeUntil = 0;
function flash(text: string): void {
  notice = text;
  noticeUntil = performance.now() + 2500;
  announce(text);
}

// Rooms
el.room.addEventListener("change", () => {
  settings.roomId = el.room.value;
  el.room.blur();
  setAdjusting(false);
  commit();
});

async function addFile(file: File): Promise<void> {
  if (!isSplatFile(file.name)) {
    flash("Not a splat file (.ply, .spz, .splat, .ksplat, .sog)");
    return;
  }
  const config = await addUserRoom(file);
  rooms.push(config);
  settings.roomId = config.id;
  commit();
}
el.addFile.addEventListener("click", () => el.file.click());
el.file.addEventListener("change", () => {
  const f = el.file.files?.[0];
  el.file.value = "";
  if (f) void addFile(f);
});
window.addEventListener("dragover", (e) => {
  e.preventDefault();
  el.dropHint.hidden = false;
});
window.addEventListener("dragleave", (e) => {
  if (!e.relatedTarget) el.dropHint.hidden = true;
});
window.addEventListener("drop", (e) => {
  e.preventDefault();
  el.dropHint.hidden = true;
  const f = e.dataTransfer?.files[0];
  if (f) void addFile(f);
});
el.removeRoom.addEventListener("click", () => {
  const config = currentConfig();
  if (config.type !== "splat" || !config.user) return;
  if (!window.confirm(`Remove "${config.name}" from this browser? The original file on disk is not touched.`)) return;
  void deleteUserRoom(config);
  rooms.splice(rooms.indexOf(config), 1);
  delete settings.placements[config.id];
  settings.roomId = rooms[0].id;
  commit();
});

// Grid room options
el.depth.addEventListener("input", () => {
  settings.roomDepth = parseFloat(el.depth.value);
  commitSoon();
});
el.objects.addEventListener("change", () => {
  settings.showObjects = el.objects.checked;
  commit();
});
el.figure.addEventListener("change", () => {
  settings.showFigure = el.figure.checked;
  el.figureDistance.disabled = !settings.showFigure;
  el.figureSize.disabled = !settings.showFigure;
  saveSettings(settings);
});
// Cube room: these are read live by the room, so no rebuild is needed.
for (const m of CUBE_COLOUR_MODES) el.cubeMode.add(new Option(m.name, m.id));
el.cubeMode.addEventListener("change", () => {
  const mode = CUBE_COLOUR_MODES.find((m) => m.id === el.cubeMode.value);
  if (mode) settings.cubeColourMode = mode.id;
  el.cubeMode.blur();
  buildPaletteEditor();
  saveSettings(settings);
});

// Palette editor: the colours the current effect uses. Each effect keeps its own.
{
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const p of PALETTE_PRESETS) {
    let group = groups.get(p.group);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = p.group;
      groups.set(p.group, group);
      el.palettePreset.append(group);
    }
    group.append(new Option(p.name, p.name));
  }
}

function currentEffect() {
  return CUBE_COLOUR_MODES.find((m) => m.id === settings.cubeColourMode) ?? CUBE_COLOUR_MODES[0];
}
/** Saves a new colour list for the current effect (copying it, so presets are never changed). */
function setPalette(colours: string[]): void {
  const effect = currentEffect();
  settings.cubePalettes[effect.id] = colours.slice(0, effect.maxColours);
  saveSettings(settings);
}

/** Rebuilds the row of colour swatches for the current effect. */
function buildPaletteEditor(): void {
  const effect = currentEffect();
  const colours = paletteFor(settings, effect.id);
  el.paletteHint.textContent = effect.hint;
  const nodes: HTMLElement[] = colours.map((hex, index) => {
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    const picker = document.createElement("input");
    picker.type = "color";
    picker.value = hex;
    picker.title = "Change this colour";
    // Updated in place while dragging in the picker, so the picker stays open.
    picker.addEventListener("input", () => {
      const next = paletteFor(settings, effect.id).slice();
      next[index] = picker.value;
      setPalette(next);
    });
    swatch.append(picker);
    if (colours.length > 1) {
      const remove = document.createElement("button");
      remove.className = "swatch-remove";
      remove.append(lineIcon(X));
      remove.title = "Remove this colour";
      remove.addEventListener("click", () => {
        setPalette(paletteFor(settings, effect.id).filter((_, i) => i !== index));
        buildPaletteEditor();
      });
      swatch.append(remove);
    }
    return swatch;
  });
  if (colours.length < effect.maxColours) {
    const add = document.createElement("button");
    add.className = "swatch-add";
    add.append(lineIcon(Plus));
    add.title = "Add a colour";
    add.addEventListener("click", () => {
      const list = paletteFor(settings, effect.id);
      // Start the new colour as a copy of the last one, to tweak from there.
      setPalette([...list, list[list.length - 1]]);
      buildPaletteEditor();
    });
    nodes.push(add);
  }
  el.swatches.replaceChildren(...nodes);
  el.paletteReset.disabled = !settings.cubePalettes[effect.id];
  el.palettePreset.hidden = effect.maxColours < 2;
}

el.palettePreset.addEventListener("change", () => {
  const preset = PALETTE_PRESETS.find((p) => p.name === el.palettePreset.value);
  el.palettePreset.value = "";
  el.palettePreset.blur();
  if (!preset) return;
  setPalette(preset.colours);
  buildPaletteEditor();
});
el.paletteReset.addEventListener("click", () => {
  delete settings.cubePalettes[currentEffect().id];
  saveSettings(settings);
  buildPaletteEditor();
});
el.cubeSpeed.addEventListener("input", () => {
  settings.cubeSpeed = parseFloat(el.cubeSpeed.value);
  saveSettings(settings);
});

// Cube layout and movement. Layout changes rebuild the room; movement is read live.
type NumericCubeKey = {
  [K in keyof CubeRoomSettings]: CubeRoomSettings[K] extends number ? K : never;
}[keyof CubeRoomSettings];
const isLayoutKey = (key: string) => (CUBE_LAYOUT_KEYS as readonly string[]).includes(key);
for (const l of CUBE_LAYOUTS) el.cubeLayout.add(new Option(l.name, l.id));
for (const m of CUBE_MOTIONS) el.cubeMotion.add(new Option(m.name, m.id));
for (const t of CUBE_TURNS) el.cubeTurn.add(new Option(t.name, t.id));

/*
 * Sliders with data-curve="<max>" run on a curved scale: the slider goes 0..1
 * and the value is max × position². Half way along is a quarter of the
 * maximum, so the low end, where small changes matter most, gets fine steps.
 */
const sliderToValue = (slider: HTMLInputElement): number => {
  const max = Number(slider.dataset.curve);
  const pos = parseFloat(slider.value);
  return max ? max * pos * pos : pos;
};
const valueToSlider = (slider: HTMLInputElement, value: number): string => {
  const max = Number(slider.dataset.curve);
  return String(max ? Math.sqrt(Math.max(0, value) / max) : value);
};
/** How a slider's value reads next to it. */
const formatCubeValue: Partial<Record<NumericCubeKey, (v: number) => string>> = {
  cubeSize: (v) => String(Math.round(v)),
  cubeVariety: (v) => String(Math.round(v)),
  cubeSplit: percent,
  cubeGap: percent,
  cubeGapGlow: times,
  cubeRelief: percent,
  cubeTilt: degrees,
  cubeMissing: percent,
  cubeMotionAmount: (v) => percent(v * MOTION),
  cubeMotionSpeed: times,
  cubeTurnAmount: degrees,
};
function showCubeValue(key: NumericCubeKey): void {
  const out = document.querySelector<HTMLOutputElement>(`output[data-value-for="${key}"]`);
  const format = formatCubeValue[key];
  if (out && format) out.textContent = format(settings[key]);
}

function syncCubeControls(): void {
  el.cubeLayout.value = settings.cubeLayout;
  el.cubeMotion.value = settings.cubeMotion;
  el.cubeTurn.value = settings.cubeTurn;
  el.cubeTurnAmountRow.hidden = settings.cubeTurn === "none";
  for (const slider of el.cubeSliders) {
    const key = slider.dataset.cube as NumericCubeKey;
    slider.value = valueToSlider(slider, settings[key]);
    showCubeValue(key);
  }
  for (const row of el.mosaicOnly) row.hidden = settings.cubeLayout !== "mosaic";
}

for (const slider of el.cubeSliders) {
  const key = slider.dataset.cube as NumericCubeKey;
  slider.addEventListener("input", () => {
    settings[key] = sliderToValue(slider);
    showCubeValue(key);
    if (isLayoutKey(key)) commitSoon();
    else saveSettings(settings);
  });
}
el.cubeLayout.addEventListener("change", () => {
  const layout = CUBE_LAYOUTS.find((l) => l.id === el.cubeLayout.value);
  if (layout) settings.cubeLayout = layout.id;
  el.cubeLayout.blur();
  commit();
});
// ---------- Mirror ----------
type NumericMirrorKey = { [K in keyof MirrorSettings]: MirrorSettings[K] extends number ? K : never }[keyof MirrorSettings];
type SwitchMirrorKey = { [K in keyof MirrorSettings]: MirrorSettings[K] extends boolean ? K : never }[keyof MirrorSettings];
const mirrorOptions = $("mirror-options");
const mirrorSliders = [...document.querySelectorAll<HTMLInputElement>('input[type="range"][data-mirror]')];
const mirrorSwitches = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-mirror]')];
const formatMirrorValue: Record<NumericMirrorKey, (v: number) => string> = {
  mirrorFog: percent,
  mirrorFogReturn: times,
  mirrorBlur: percent,
  mirrorSmears: percent,
  mirrorFrost: percent,
  mirrorFrostSpeed: times,
  mirrorFrostHardness: percent,
  mirrorReach: percent,
  mirrorPalmSize: times,
  mirrorFingerSize: times,
  mirrorDrops: percent,
};
function showMirrorValue(slider: HTMLInputElement): void {
  const key = slider.dataset.mirror as NumericMirrorKey;
  const out = slider.parentElement?.querySelector("output");
  if (out) out.textContent = formatMirrorValue[key](settings[key]);
}
function syncMirrorControls(): void {
  for (const slider of mirrorSliders) {
    slider.value = String(settings[slider.dataset.mirror as NumericMirrorKey]);
    showMirrorValue(slider);
  }
  for (const toggle of mirrorSwitches) toggle.checked = settings[toggle.dataset.mirror as SwitchMirrorKey];
}
// Everything in the mirror is read live, so nothing here rebuilds it.
for (const slider of mirrorSliders) {
  slider.addEventListener("input", () => {
    settings[slider.dataset.mirror as NumericMirrorKey] = parseFloat(slider.value);
    showMirrorValue(slider);
    saveSettings(settings);
  });
}
for (const toggle of mirrorSwitches) {
  toggle.addEventListener("change", () => {
    settings[toggle.dataset.mirror as SwitchMirrorKey] = toggle.checked;
    saveSettings(settings);
  });
}
$("btn-refog").addEventListener("click", () => {
  if (room && "refog" in room) (room as MirrorRoom).refog();
});

// ---------- Aquarium ----------
type NumericTankKey = { [K in keyof AquariumSettings]: AquariumSettings[K] extends number ? K : never }[keyof AquariumSettings];
type SwitchTankKey = { [K in keyof AquariumSettings]: AquariumSettings[K] extends boolean ? K : never }[keyof AquariumSettings];
const aquariumOptions = $("aquarium-options");
const waterSelect = $<HTMLSelectElement>("in-water");
for (const w of WATER_STYLES) waterSelect.add(new Option(w.name, w.id));
const aquaSceneSelect = $<HTMLSelectElement>("in-aqua-scene");
for (const sc of AQUA_SCENES) aquaSceneSelect.add(new Option(sc.name, sc.id));
aquaSceneSelect.addEventListener("change", () => {
  const scene = AQUA_SCENES.find((sc) => sc.id === aquaSceneSelect.value);
  if (scene) settings.aquaScene = scene.id;
  showReefOptions();
  aquaSceneSelect.blur();
  commit();
});
const tankSliders = [...document.querySelectorAll<HTMLInputElement>('input[type="range"][data-tank]')];
const tankSwitches = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-tank]')];
const formatTankValue: Record<NumericTankKey, (v: number) => string> = {
  tankWidth: times,
  tankHeight: times,
  tankDepth: times,
  fishCount: (v) => String(Math.round(v)),
  fishSize: times,
  fishSpeed: times,
  fishSchooling: percent,
  fishWander: percent,
  fishAgility: percent,
  fishCuriosity: percent,
  fishStartle: percent,
  fishExplore: percent,
  waterDeep: percent,
  shipSize: times,
  reefRocks: times,
  reefRockHeight: times,
  reefEnclose: percent,
  reefCoral: times,
  reefCoralSize: times,
  reefGlow: percent,
  reefSway: times,
  causticStrength: times,
  causticSize: times,
  causticSharpness: percent,
  causticSpeed: times,
  causticDetail: percent,
  causticCurve: percent,
  sailTears: percent,
  sailTearSize: times,
  sailTearDetail: percent,
  sailFray: percent,
  sailRips: percent,
  sailWear: percent,
  sailSway: times,
  sailPattern: (v) => String(Math.round(v) + 1),
};
/** Settings that change the tank itself, so it's rebuilt; the rest are read live. */
const rebuildsTank = new Set<string>([
  "tankDepth",
  "tankWidth",
  "tankHeight",
  "waterDeep",
  "shipSize",
  "reefRocks",
  "reefRockHeight",
  "reefEnclose",
  "reefCoral",
  "reefCoralSize",
]);
/** The reef, wreck and sail settings only apply to the shipwreck scene. */
function showReefOptions(): void {
  for (const el of document.querySelectorAll<HTMLElement>(".wreck-only")) el.hidden = settings.aquaScene === "tank";
}
function showTankValue(slider: HTMLInputElement): void {
  const key = slider.dataset.tank as NumericTankKey;
  const out = slider.parentElement?.querySelector("output");
  if (out) out.textContent = formatTankValue[key](settings[key]);
}
function syncTankControls(): void {
  waterSelect.value = settings.water;
  aquaSceneSelect.value = settings.aquaScene;
  showReefOptions();
  for (const slider of tankSliders) {
    slider.value = String(settings[slider.dataset.tank as NumericTankKey]);
    showTankValue(slider);
  }
  for (const toggle of tankSwitches) toggle.checked = settings[toggle.dataset.tank as SwitchTankKey];
}
for (const slider of tankSliders) {
  slider.addEventListener("input", () => {
    const key = slider.dataset.tank as NumericTankKey;
    settings[key] = parseFloat(slider.value);
    showTankValue(slider);
    if (rebuildsTank.has(key)) commitSoon();
    else saveSettings(settings);
  });
}
for (const toggle of tankSwitches) {
  toggle.addEventListener("change", () => {
    settings[toggle.dataset.tank as SwitchTankKey] = toggle.checked;
    saveSettings(settings);
  });
}
waterSelect.addEventListener("change", () => {
  const style = WATER_STYLES.find((w) => w.id === waterSelect.value);
  if (style) settings.water = style.id;
  waterSelect.blur();
  commit();
});

// ---------- Balls ----------
type NumericBallKey = { [K in keyof BallSettings]: BallSettings[K] extends number ? K : never }[keyof BallSettings];
type SwitchBallKey = { [K in keyof BallSettings]: BallSettings[K] extends boolean ? K : never }[keyof BallSettings];
/** How each ball slider's value reads next to it. */
const formatBallValue: Record<NumericBallKey, (v: number) => string> = {
  ballCount: (v) => String(Math.round(v)),
  ballSize: times,
  ballSizeVariety: percent,
  ballBounce: percent,
  ballGravity: (v) => (v === 0 ? "Off" : times(v)),
  ballDrag: percent,
  ballFriction: percent,
  ballShine: percent,
  ballGlow: times,
};
const ballSliders = [...document.querySelectorAll<HTMLInputElement>('input[type="range"][data-ball]')];
const ballSwitches = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-ball]')];
const ballColourMode = $<HTMLSelectElement>("in-ball-colour-mode");
const ballColourRow = $("ball-colour-row");
const ballColour = input("in-ball-colour");
for (const m of BALL_COLOUR_MODES) ballColourMode.add(new Option(m.name, m.id));

function showBallValue(slider: HTMLInputElement): void {
  const key = slider.dataset.ball as NumericBallKey;
  const out = slider.parentElement?.querySelector("output");
  if (out) out.textContent = formatBallValue[key](settings[key]);
}
function syncBallControls(): void {
  for (const slider of ballSliders) {
    slider.value = String(settings[slider.dataset.ball as NumericBallKey]);
    showBallValue(slider);
  }
  for (const toggle of ballSwitches) toggle.checked = settings[toggle.dataset.ball as SwitchBallKey];
  ballColourMode.value = settings.ballColourMode;
  ballColourRow.hidden = settings.ballColourMode !== "single";
  ballColour.value = settings.ballColour;
}
// Ball settings are read live every frame, so nothing needs rebuilding.
for (const slider of ballSliders) {
  slider.addEventListener("input", () => {
    settings[slider.dataset.ball as NumericBallKey] = parseFloat(slider.value);
    showBallValue(slider);
    saveSettings(settings);
  });
}
for (const toggle of ballSwitches) {
  toggle.addEventListener("change", () => {
    settings[toggle.dataset.ball as SwitchBallKey] = toggle.checked;
    saveSettings(settings);
  });
}
ballColourMode.addEventListener("change", () => {
  const mode = BALL_COLOUR_MODES.find((m) => m.id === ballColourMode.value);
  if (mode) settings.ballColourMode = mode.id;
  ballColourRow.hidden = settings.ballColourMode !== "single";
  ballColourMode.blur();
  saveSettings(settings);
});
ballColour.addEventListener("input", () => {
  settings.ballColour = ballColour.value;
  saveSettings(settings);
});
button("btn-balls-drop").addEventListener("click", () => {
  const home = ballRoom();
  if (home) balls.drop(settings, home.bounds);
});
button("btn-balls-shake").addEventListener("click", () => {
  const home = ballRoom();
  if (home) balls.shake(home.bounds);
});

el.cubeTurn.addEventListener("change", () => {
  const turn = CUBE_TURNS.find((t) => t.id === el.cubeTurn.value);
  if (turn) settings.cubeTurn = turn.id;
  el.cubeTurn.blur();
  commit();
});
el.cubeMotion.addEventListener("change", () => {
  const motion = CUBE_MOTIONS.find((m) => m.id === el.cubeMotion.value);
  if (motion) settings.cubeMotion = motion.id;
  el.cubeMotion.blur();
  saveSettings(settings);
});
button("btn-cube-shuffle").addEventListener("click", () => {
  settings.cubeSeed = Math.floor(Math.random() * 2 ** 31);
  commit();
});
button("btn-cube-layout-reset").addEventListener("click", () => {
  for (const key of CUBE_LAYOUT_KEYS) (settings as unknown as Record<string, unknown>)[key] = CUBE_DEFAULTS[key];
  commit();
});

el.figureSize.addEventListener("input", () => {
  settings.figureSize = parseFloat(el.figureSize.value);
  saveSettings(settings);
});
el.figureDistance.addEventListener("input", () => {
  settings.figureDistanceEffect = parseFloat(el.figureDistance.value);
  saveSettings(settings);
});

// Placement
el.adjust.addEventListener("click", () => setAdjusting(!adjusting));
for (const field of [el.pw, el.px, el.py, el.pz]) {
  field.addEventListener("change", () => {
    if (!splatRoom) return;
    const v = [el.pw, el.px, el.py, el.pz].map((f) => parseFloat(f.value));
    if (v.some((n) => !Number.isFinite(n))) return syncPlacement();
    setPlacement({ ...splatRoom.placement, windowWidth: v[0], position: [v[1], v[2], v[3]] });
  });
}
document.querySelectorAll<HTMLButtonElement>("button[data-rot]").forEach((b) => {
  b.addEventListener("click", () => {
    if (!splatRoom) return;
    setPlacement(rotate(splatRoom.placement, b.dataset.rot as "x" | "y" | "z", Number(b.dataset.deg)));
  });
});
button("btn-flip").addEventListener("click", () => {
  // Half a turn about the viewing direction: same view, other way up.
  if (splatRoom) setPlacement(rotate(splatRoom.placement, "z", 180));
});
button("btn-autofit").addEventListener("click", autoFit);
button("btn-reset-placement").addEventListener("click", () => {
  const config = currentConfig();
  if (config.type !== "splat") return;
  if (config.user) return autoFit();
  setPlacement(defaultPlacement(config));
  delete settings.placements[config.id];
  saveSettings(settings);
});
button("btn-copy-placement").addEventListener("click", () => {
  if (!splatRoom) return;
  const p = splatRoom.placement;
  const list = (a: number[]) => `[${a.map((n) => fmt(n, 3)).join(", ")}]`;
  const text = `windowWidth: ${fmt(p.windowWidth, 3)},\nposition: ${list(p.position)},\nrotationDeg: ${list(p.rotationDeg)},`;
  navigator.clipboard.writeText(text).then(
    () => flash("Placement copied"),
    () => flash("Could not copy"),
  );
});

// Display profiles
el.profile.addEventListener("change", () => {
  settings.profileId = el.profile.value;
  el.profile.blur();
  commit();
});
button("btn-profile-new").addEventListener("click", () => {
  const copy: DisplayProfile = { ...profile(), id: `p-${Date.now().toString(36)}`, name: `${profile().name} copy` };
  settings.profiles.push(copy);
  settings.profileId = copy.id;
  commit();
});
el.profileDelete.addEventListener("click", () => {
  if (settings.profiles.length < 2) return;
  settings.profiles = settings.profiles.filter((p) => p.id !== profile().id);
  settings.profileId = settings.profiles[0].id;
  commit();
});
el.profileName.addEventListener("change", () => {
  profile().name = el.profileName.value.trim() || "Unnamed";
  commit();
});
el.camEdge.addEventListener("change", () => {
  profile().cameraEdge = el.camEdge.value === "bottom" ? "bottom" : "top";
  commit();
});
for (const [field, , write] of profileFields) {
  field.addEventListener("change", () => {
    const v = parseFloat(field.value);
    if (Number.isFinite(v)) write(profile(), v);
    commit();
  });
}
el.calibrate.addEventListener("click", () => {
  const fov = tracker.calibrateFov(0.5);
  if (fov === null) {
    flash("Nobody found to calibrate on");
  } else {
    profile().cameraHfovDeg = THREE.MathUtils.clamp(fov, 30, 120);
    commit();
    flash("Calibrated");
  }
});

// Modes and shortcuts
function setMouseMode(on: boolean): void {
  mouseMode = on;
  el.mouse.setAttribute("aria-pressed", String(on));
}
/**
 * Whether this browser can animate display: none (the panel's exit). Firefox
 * accepts allow-discrete without honouring it for display, so this probes
 * what actually happens instead of asking CSS.supports.
 */
let displayTransitions: boolean | undefined;
function canTransitionDisplay(): boolean {
  if (displayTransitions !== undefined) return displayTransitions;
  if (!CSS.supports("transition-behavior", "allow-discrete")) return (displayTransitions = false);
  const probe = document.createElement("div");
  probe.style.cssText = "transition: display 1s allow-discrete !important; display: block;";
  document.body.append(probe);
  getComputedStyle(probe).display;
  probe.style.display = "none";
  displayTransitions = getComputedStyle(probe).display === "block";
  probe.remove();
  return displayTransitions;
}

/** Hides the panel after its exit motion; where display can't transition, plays the exit first by hand. */
async function hideHud(): Promise<void> {
  if (canTransitionDisplay()) {
    el.hud.classList.add("hidden");
    return;
  }
  el.hud.setAttribute("data-closing", "");
  const running = el.hud.getAnimations();
  if (running.length) {
    await Promise.race([Promise.allSettled(running.map((a) => a.finished)), new Promise((r) => setTimeout(r, 1000))]);
  }
  // Skipped if the panel was shown again mid-exit.
  if (el.hud.hasAttribute("data-closing")) {
    el.hud.removeAttribute("data-closing");
    el.hud.classList.add("hidden");
  }
}

function toggleHud(): void {
  settings.showHud = !settings.showHud;
  if (settings.showHud) {
    el.hud.removeAttribute("data-closing");
    el.hud.classList.remove("hidden");
  } else {
    void hideHud();
  }
  el.showHud.hidden = settings.showHud;
  saveSettings(settings);
  if (!settings.showHud) el.showHud.focus();
}
function toggleFullscreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
}
el.mouse.addEventListener("click", () => setMouseMode(!mouseMode));
function setFollowHead(on: boolean): void {
  settings.followHead = on;
  el.follow.setAttribute("aria-pressed", String(on));
  saveSettings(settings);
}
setFollowHead(settings.followHead);
el.follow.addEventListener("click", () => setFollowHead(!settings.followHead));
el.fullscreen.addEventListener("click", toggleFullscreen);
/** Controls where letter keys do something themselves: text and number fields, menus. */
const LETTER_CONTROLS = [
  'input:not([type="range"], [type="checkbox"], [type="radio"], [type="color"], [type="button"], [type="file"])',
  "select",
  "textarea",
  "[contenteditable]",
].join(", ");

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (k === "escape") return setAdjusting(false);
  // Single-letter shortcuts stay out of the way where letters mean
  // something: typing in a field, or jumping through a menu's options. They
  // still work after using a slider, switch or button, which ignore letters.
  // They can also be turned off entirely (WCAG 2.1.4 Character Key Shortcuts).
  if (!settings.shortcuts || e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t instanceof HTMLElement && t.closest(LETTER_CONTROLS)) return;
  if (k === "h") toggleHud();
  else if (k === "f") toggleFullscreen();
  else if (k === "m") setMouseMode(!mouseMode);
  else if (k === "p") setFollowHead(!settings.followHead);
});

/** Shows the shortcuts as on or off: the switch, the keycaps, and the footer note. */
function showShortcuts(on: boolean): void {
  el.shortcuts.checked = on;
  document.body.classList.toggle("no-shortcuts", !on);
  el.shortcutsOff.hidden = on;
}
/** A choice the person made: remembered. */
function setShortcuts(on: boolean): void {
  settings.shortcuts = on;
  settings.shortcutsChosen = true;
  showShortcuts(on);
  saveSettings(settings);
}
// At startup only show the saved state; saving here could turn a stray value into a lasting one.
showShortcuts(settings.shortcuts);
el.shortcuts.addEventListener("change", () => setShortcuts(el.shortcuts.checked));
el.shortcutsOn.addEventListener("click", () => setShortcuts(true));

el.hideHud.addEventListener("click", toggleHud);
el.showHud.addEventListener("click", () => {
  toggleHud();
  el.hideHud.focus();
});

// The camera starts straight away only if access was already granted. Otherwise
// it waits for "Start camera", so the browser's permission prompt follows from a click.
el.cameraBtn.addEventListener("click", () => void tracker.start());
void (async () => {
  try {
    const permission = await navigator.permissions.query({ name: "camera" as PermissionName });
    if (permission.state === "granted") void tracker.start();
  } catch {
    // Permission can't be queried in this browser: wait for the button.
  }
})();

/** Tints the pixels the cutout counts as "person" over the camera preview. */
const maskCanvas = document.createElement("canvas");
let maskVersion = -1;
function drawMask(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cut = tracker.cutout;
  if (!tracker.wantCutout || !cut || !cut.maskWidth) return;
  if (cut.version !== maskVersion) {
    maskVersion = cut.version;
    // A quarter-resolution copy is plenty for a thumbnail.
    const step = 4;
    const mw = Math.floor(cut.maskWidth / step);
    const mh = Math.floor(cut.maskHeight / step);
    if (maskCanvas.width !== mw || maskCanvas.height !== mh) {
      maskCanvas.width = mw;
      maskCanvas.height = mh;
    }
    const mctx = maskCanvas.getContext("2d")!;
    const img = mctx.createImageData(mw, mh);
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        const o = (y * mw + x) * 4;
        // Amber, the accent: the viewfinder marks what it has locked onto.
        img.data[o] = 242;
        img.data[o + 1] = 168;
        img.data[o + 2] = 59;
        img.data[o + 3] = cut.mask[y * step * cut.maskWidth + x * step] * 0.5;
      }
    }
    mctx.putImageData(img, 0, 0);
  }
  ctx.drawImage(maskCanvas, 0, 0, w, h);
}

function drawPreview(): void {
  const c = el.overlay;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, w, h);
  drawMask(ctx, w, h);
  for (const p of tracker.people) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.locked ? "#f2a83b" : "rgba(237, 237, 237, 0.55)";
    ctx.beginPath();
    ctx.moveTo(p.shoulders[0] * w, p.shoulders[1] * h);
    ctx.lineTo(p.shoulders[2] * w, p.shoulders[3] * h);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(p.u * w, p.v * h, p.locked ? 7 : 4, 0, Math.PI * 2);
    ctx.stroke();
  }
}

let wasLoading = false;
let fpsFrames = 0;
let fpsSince = performance.now();

function updateHud(now: number): void {
  fpsFrames++;
  if (now - fpsSince >= 500) {
    el.fps.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsSince))} fps`;
    fpsFrames = 0;
    fpsSince = now;
  }
  // The pill at the bottom: a short notice, else loading progress.
  const loading = room?.loading;
  const fetchingRenderer = currentConfig().type === "splat" && !splatModule;
  const isLoading = loading !== undefined || fetchingRenderer;
  if (isLoading !== wasLoading) {
    announce(isLoading ? "Loading room" : "Room loaded");
    wasLoading = isLoading;
  }
  const pill =
    now < noticeUntil
      ? notice
      : fetchingRenderer
        ? "Loading splat renderer"
        : loading !== undefined
          ? `Loading room ${Math.round(loading * 100)}%`
          : "";
  el.loading.hidden = pill === "";
  if (pill) el.loading.textContent = pill;
  if (!settings.showHud) return;

  let cls = "";
  let text = "";
  if (adjusting) {
    cls = "mouse";
    text = "Placing room";
  } else if (mouseMode) {
    cls = "mouse";
    text = "Mouse mode";
  } else if (!settings.followHead) {
    cls = "mouse";
    text = "Fixed view";
  } else if (tracker.status === "idle") {
    text = "Camera off";
  } else if (tracker.status === "loading") {
    text = "Starting camera";
  } else if (tracker.status === "no-camera") {
    cls = "error";
    text = "No camera, steer with the mouse";
  } else if (tracker.status === "tracking") {
    cls = "tracking";
    text = "Tracking you";
  } else {
    cls = "searching";
    text = "Looking for a viewer";
  }
  el.dot.className = cls;
  el.status.textContent = text;
  el.status.title = tracker.error;
  // "+ 0" turns -0 into 0, so the readout never shows "-0".
  const cm = (v: number) => (Math.round(v * 100) + 0).toFixed(0);
  el.eye.textContent = `${cm(eye.x)} · ${cm(eye.y)} · ${cm(eye.z)} cm`;
  el.preview.toggleAttribute("data-live", tracker.status === "tracking" || tracker.status === "searching");
  const canStart = tracker.status === "idle" || tracker.status === "no-camera";
  el.cameraBtn.hidden = !canStart;
  if (canStart) el.cameraLabel.textContent = tracker.status === "idle" ? "Start camera" : "Try again";
  const grid = isBoxRoom(currentConfig());
  el.cutoutLabel.hidden = el.cutout.hidden = !grid;
  if (grid) {
    el.cutout.textContent = settings.showFigure ? `${tracker.cutoutInfo}, ${figure.state}` : "Off";
    el.cutout.title = el.cutout.textContent;
  }
  drawPreview();
}

// ---------- Main loop ----------
let last = performance.now();

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;

  tracker.update(now);
  handTracker.enabled = currentConfig().type === "mirror";
  handTracker.update(now);
  updateEye(now, dt);
  tracker.wantCutout = settings.showFigure && isBoxRoom(currentConfig());
  figure.update(tracker, profile(), win, {
    enabled: tracker.wantCutout,
    size: settings.figureSize,
    distanceEffect: settings.figureDistanceEffect,
    roomDepth: win.width * settings.roomDepth,
  });
  applyOffAxis(camera, eye, win, room?.clipAtWindow);
  room?.update(now / 1000, eye, viewerSeen ? viewer : undefined);
  const ballHome = ballRoom();
  balls.mesh.visible = ballHome !== null;
  if (ballHome) {
    balls.update(dt, settings, ballHome, {
      mode: settings.cubeColourMode,
      palette: paletteFor(settings, settings.cubeColourMode),
    });
  }
  renderer.render(scene, camera);
  updateHud(now);

  requestAnimationFrame(frame);
}

window.addEventListener("resize", rebuild);
// Moving the window changes where it sits relative to the webcam.
setInterval(() => (win = measureWindow(profile())), 1000);

rebuild();
requestAnimationFrame(frame);
// Rooms the user added earlier live in the browser's storage.
void listUserRooms().then((list) => {
  if (!list.length) return;
  rooms.push(...list);
  rebuild();
});
