import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-mono/400.css";
import {
  ArrowUpDown,
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
  Plus,
  RotateCcw,
  Scan,
  ScanFace,
  Shuffle,
  Trash,
  Upload,
  X,
  createElement,
  createIcons,
} from "lucide";
import * as THREE from "three";
import { SparkRenderer } from "@sparkjsdev/spark";
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
  type CubeRoomSettings,
} from "./cubeRoom";
import { PALETTE_PRESETS } from "./palettes";
import { createGridRoom } from "./gridRoom";
import { HeadTracker } from "./headTracker";
import { applyOffAxis, measureWindow, type WindowGeometry } from "./offAxis";
import { ROOMS, isBoxRoom, type Placement, type Room, type RoomConfig, type SplatRoomConfig } from "./rooms";
import { activeProfile, loadSettings, saveSettings, type DisplayProfile } from "./settings";
import { createSplatRoom, rotatePlacement, type SplatRoom } from "./splatRoom";
import { addUserRoom, deleteUserRoom, isSplatFile, listUserRooms } from "./userRooms";

// Line icons for the panel (placeholders are <i data-lucide="name"> in index.html).
createIcons({
  icons: {
    ArrowUpDown,
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
    Plus,
    RotateCcw,
    Scan,
    ScanFace,
    Shuffle,
    Trash,
    Upload,
  },
});

const settings = loadSettings();
const tracker = new HeadTracker(settings);
const profile = (): DisplayProfile => activeProfile(settings);

// ---------- Scene ----------
const canvas = document.getElementById("scene") as HTMLCanvasElement;
// No WebGL anti-aliasing: it does nothing for splats and costs a lot.
const renderer = new THREE.WebGLRenderer({ canvas });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x04070b);
const camera = new THREE.PerspectiveCamera();
// Spark draws every splat room in the scene through this one object.
scene.add(new SparkRenderer({ renderer }));
// The viewer, cut out of the webcam image and stood inside the room.
const figure = new MirrorFigure();
scene.add(figure.mesh);

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
    if (config.type === "splat") {
      const saved = settings.placements[config.id];
      splatRoom = createSplatRoom(config, saved ?? defaultPlacement(config), win);
      room = splatRoom;
      // A file the user just added has no placement yet: guess one.
      if (config.user && !saved) autoFit();
    } else {
      splatRoom = null;
      const depth = win.width * settings.roomDepth;
      room =
        config.type === "cubes"
          ? createCubeRoom(win.width, win.height, depth, settings)
          : createGridRoom(win.width, win.height, depth, settings.showObjects);
    }
    scene.add(room.group);
    if (import.meta.env.DEV) Object.assign(window, { room, tracker });
  }
  syncHud();
}

function commit(): void {
  saveSettings(settings);
  rebuild();
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
    p = rotatePlacement(rotatePlacement(p, "y", dx * 0.15), "x", dy * 0.15);
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

function updateEye(now: number, dt: number): void {
  let timeConstant = 0.03; // light smoothing between webcam frames
  if (adjusting) {
    // Hold the view still while the room is being placed.
    target.set(0, 0, REST_DISTANCE);
    timeConstant = 0.15;
  } else if (!settings.followHead) {
    // Perspective switched off: a fixed view, straight on. Eased, so switching isn't a jump.
    target.set(0, 0, REST_DISTANCE);
    timeConstant = 0.25;
  } else if (mouseMode) {
    target.set(mouse.x, mouse.y, mouse.z);
  } else if (tracker.head && now - tracker.lastSeen < REST_AFTER_MS) {
    // Camera space -> window space: undo the camera's upward tilt, then
    // shift by where the lens sits relative to the centre of the window.
    const p = profile();
    const tilt = THREE.MathUtils.degToRad(p.cameraTiltDeg);
    const h = tracker.head;
    const y = h.y * Math.cos(tilt) + h.z * Math.sin(tilt);
    const z = -h.y * Math.sin(tilt) + h.z * Math.cos(tilt);
    target.set(h.x + win.cameraX, y + win.cameraY, z + p.cameraForwardM);
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
  el.cubeMode.value = settings.cubeColourMode;
  buildPaletteEditor();
  el.cubeSpeed.value = String(settings.cubeSpeed);
  syncCubeControls();
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
  document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(fillSlider);
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
  });
});

let notice = "";
let noticeUntil = 0;
function flash(text: string): void {
  notice = text;
  noticeUntil = performance.now() + 2500;
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
  commit();
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
    if (isLayoutKey(key)) commit();
    else saveSettings(settings);
  });
}
el.cubeLayout.addEventListener("change", () => {
  const layout = CUBE_LAYOUTS.find((l) => l.id === el.cubeLayout.value);
  if (layout) settings.cubeLayout = layout.id;
  el.cubeLayout.blur();
  commit();
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
    setPlacement(rotatePlacement(splatRoom.placement, b.dataset.rot as "x" | "y" | "z", Number(b.dataset.deg)));
  });
});
button("btn-flip").addEventListener("click", () => {
  // Half a turn about the viewing direction: same view, other way up.
  if (splatRoom) setPlacement(rotatePlacement(splatRoom.placement, "z", 180));
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
function toggleHud(): void {
  settings.showHud = !settings.showHud;
  el.hud.classList.toggle("hidden", !settings.showHud);
  saveSettings(settings);
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
window.addEventListener("keydown", (e) => {
  const t = e.target;
  const typing = t instanceof HTMLInputElement && (t.type === "number" || t.type === "text");
  if (typing || e.metaKey || e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === "h") toggleHud();
  else if (k === "f") toggleFullscreen();
  else if (k === "m") setMouseMode(!mouseMode);
  else if (k === "p") setFollowHead(!settings.followHead);
  else if (k === "escape") setAdjusting(false);
});

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
  const pill = now < noticeUntil ? notice : loading !== undefined ? `Loading room… ${Math.round(loading * 100)}%` : "";
  el.loading.hidden = pill === "";
  if (pill) el.loading.textContent = pill;
  if (!settings.showHud) return;

  let cls = "";
  let text = "";
  if (adjusting) {
    cls = "mouse";
    text = "Placing room";
  } else if (!settings.followHead) {
    cls = "mouse";
    text = "Fixed view";
  } else if (mouseMode) {
    cls = "mouse";
    text = "Mouse mode";
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
  el.eye.textContent = `${(eye.x * 100).toFixed(0)} · ${(eye.y * 100).toFixed(0)} · ${(eye.z * 100).toFixed(0)} cm`;
  el.preview.toggleAttribute("data-live", tracker.status === "tracking" || tracker.status === "searching");
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
  updateEye(now, dt);
  tracker.wantCutout = settings.showFigure && isBoxRoom(currentConfig());
  figure.update(tracker, profile(), win, {
    enabled: tracker.wantCutout,
    size: settings.figureSize,
    distanceEffect: settings.figureDistanceEffect,
    roomDepth: win.width * settings.roomDepth,
  });
  applyOffAxis(camera, eye, win, room?.clipAtWindow);
  room?.update(now / 1000, eye);
  renderer.render(scene, camera);
  updateHud(now);

  requestAnimationFrame(frame);
}

window.addEventListener("resize", rebuild);
// Moving the window changes where it sits relative to the webcam.
setInterval(() => (win = measureWindow(profile())), 1000);

rebuild();
requestAnimationFrame(frame);
void tracker.start();
// Rooms the user added earlier live in the browser's storage.
void listUserRooms().then((list) => {
  if (!list.length) return;
  rooms.push(...list);
  rebuild();
});
