import * as THREE from "three";
import type { CubeColourMode } from "./cubeRoom";

/** Most colours a palette can hold. */
export const MAX_PALETTE_COLOURS = 10;

/**
 * Well-known published palettes. Colour maps are sampled evenly from
 * matplotlib 3.11 (Turbo between 5% and 95%, to skip its darkest ends;
 * Greens from 35%, to skip its near-white start). Theme colours are the
 * accent colours from each theme's official specification.
 */
const P = {
  // The classic RGB colour wheel that RGB keyboards cycle through.
  colourWheel: ["#ff0000", "#ffff00", "#00ff00", "#00ffff", "#0000ff", "#ff00ff"],
  // Google's Turbo: an improved rainbow colour map.
  turbo: ["#3d358b", "#458cfd", "#18d9c8", "#69fd66", "#cdec34", "#fea933", "#e84b0c", "#a11201"],
  // matplotlib's perceptually uniform maps.
  viridis: ["#440154", "#46327e", "#365c8d", "#277f8e", "#1fa187", "#4ac16d", "#a0da39", "#fde725"],
  magma: ["#000004", "#221150", "#5f187f", "#982d80", "#d3436e", "#f8765c", "#febb81", "#fcfdbf"],
  inferno: ["#000004", "#280b53", "#65156e", "#9f2a63", "#d44842", "#f57d15", "#fac228", "#fcffa4"],
  plasma: ["#0d0887", "#5302a3", "#8b0aa5", "#b83289", "#db5c68", "#f48849", "#febd2a", "#f0f921"],
  cividis: ["#00224e", "#35456c", "#666970", "#948e77", "#c8b866", "#fee838"],
  cool: ["#00ffff", "#55aaff", "#aa55ff", "#ff00ff"],
  // ColorBrewer (Cynthia Brewer).
  spectral: ["#9e0142", "#e2514a", "#fca55d", "#fee999", "#edf8a3", "#a2d9a4", "#47a0b3", "#5e4fa2"],
  greens: ["#a9dca3", "#7cc87c", "#46ae60", "#258d47", "#016e2d", "#00441b"],
  set1: ["#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00", "#ffff33", "#a65628", "#f781bf"],
  pastel1: ["#fbb4ae", "#b3cde3", "#ccebc5", "#decbe4", "#fed9a6", "#ffffcc", "#e5d8bd", "#fddaec"],
  // Tableau 10, matplotlib's default colour cycle.
  tableau10: [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf",
  ],
  // Okabe & Ito: distinguishable with every common kind of colour blindness.
  okabeIto: ["#e69f00", "#56b4e9", "#009e73", "#f0e442", "#0072b2", "#d55e00", "#cc79a7"],
  // Editor and terminal themes.
  nordAurora: ["#bf616a", "#d08770", "#ebcb8b", "#a3be8c", "#b48ead"],
  nordFrost: ["#8fbcbb", "#88c0d0", "#81a1c1", "#5e81ac"],
  dracula: ["#ff5555", "#ffb86c", "#f1fa8c", "#50fa7b", "#8be9fd", "#bd93f9", "#ff79c6"],
  solarized: ["#b58900", "#cb4b16", "#dc322f", "#d33682", "#6c71c4", "#268bd2", "#2aa198", "#859900"],
  catppuccinMocha: ["#f38ba8", "#fab387", "#f9e2af", "#a6e3a1", "#94e2d5", "#89dceb", "#89b4fa", "#cba6f7"],
  gruvbox: ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c", "#83a598", "#d3869b"],
};

/** The colours each effect starts with, each taken from a published palette. */
export const DEFAULT_PALETTES: Record<CubeColourMode, string[]> = {
  solid: [P.nordFrost[1]],
  breathing: P.dracula,
  cycle: P.colourWheel,
  rainbow: P.colourWheel,
  spiral: P.turbo,
  rings: P.plasma,
  starlight: P.catppuccinMocha,
  aurora: P.viridis,
  fire: P.inferno,
  rain: P.greens,
};

/** Ready-made palettes that can be loaded into any effect, grouped for the menu. */
export const PALETTE_PRESETS: { group: string; name: string; colours: string[] }[] = [
  { group: "Gradients", name: "Colour wheel (RGB)", colours: P.colourWheel },
  { group: "Gradients", name: "Turbo", colours: P.turbo },
  { group: "Gradients", name: "Viridis", colours: P.viridis },
  { group: "Gradients", name: "Magma", colours: P.magma },
  { group: "Gradients", name: "Inferno", colours: P.inferno },
  { group: "Gradients", name: "Plasma", colours: P.plasma },
  { group: "Gradients", name: "Cividis", colours: P.cividis },
  { group: "Gradients", name: "Cool", colours: P.cool },
  { group: "Gradients", name: "Spectral (ColorBrewer)", colours: P.spectral },
  { group: "Gradients", name: "Greens (ColorBrewer)", colours: P.greens },
  { group: "Sets of distinct colours", name: "Tableau 10", colours: P.tableau10 },
  { group: "Sets of distinct colours", name: "Okabe–Ito (colour-blind safe)", colours: P.okabeIto },
  { group: "Sets of distinct colours", name: "Set 1 (ColorBrewer)", colours: P.set1 },
  { group: "Sets of distinct colours", name: "Pastel 1 (ColorBrewer)", colours: P.pastel1 },
  { group: "Themes", name: "Nord Aurora", colours: P.nordAurora },
  { group: "Themes", name: "Nord Frost", colours: P.nordFrost },
  { group: "Themes", name: "Dracula", colours: P.dracula },
  { group: "Themes", name: "Solarized", colours: P.solarized },
  { group: "Themes", name: "Catppuccin Mocha", colours: P.catppuccinMocha },
  { group: "Themes", name: "Gruvbox", colours: P.gruvbox },
];

/**
 * A palette turned into something that can be sampled quickly. Colours are
 * blended in the sRGB values you pick them in, which looks like a natural
 * gradient (blending in linear light makes the middles look washed out).
 */
export class PaletteSampler {
  private key = "";
  private stops: [number, number, number][] = [];

  /** Re-reads the palette if it has changed. */
  use(colours: string[]): void {
    const key = colours.join(",");
    if (key === this.key) return;
    this.key = key;
    const c = new THREE.Color();
    const list = colours.length ? colours : ["#ffffff"];
    this.stops = list.map((hex) => {
      c.set(hex);
      const out = { r: 0, g: 0, b: 0 };
      c.getRGB(out, THREE.SRGBColorSpace);
      return [out.r, out.g, out.b];
    });
  }

  get count(): number {
    return this.stops.length;
  }

  /** One of the palette's colours, by index (wraps around). */
  pick(target: THREE.Color, index: number): THREE.Color {
    const n = this.stops.length;
    const s = this.stops[((Math.floor(index) % n) + n) % n];
    return target.setRGB(s[0], s[1], s[2], THREE.SRGBColorSpace);
  }

  /** A smooth loop through the colours: 0 and 1 are both the first colour. */
  loop(target: THREE.Color, t: number): THREE.Color {
    const n = this.stops.length;
    const x = (((t % 1) + 1) % 1) * n;
    return this.blend(target, Math.floor(x) % n, (Math.floor(x) + 1) % n, x - Math.floor(x));
  }

  /** From the first colour (0) to the last (1), without wrapping. */
  ramp(target: THREE.Color, t: number): THREE.Color {
    const n = this.stops.length;
    if (n === 1) return this.pick(target, 0);
    const x = Math.min(1, Math.max(0, t)) * (n - 1);
    const i = Math.min(n - 2, Math.floor(x));
    return this.blend(target, i, i + 1, x - i);
  }

  private blend(target: THREE.Color, a: number, b: number, f: number): THREE.Color {
    const p = this.stops[a];
    const q = this.stops[b];
    return target.setRGB(
      p[0] + (q[0] - p[0]) * f,
      p[1] + (q[1] - p[1]) * f,
      p[2] + (q[2] - p[2]) * f,
      THREE.SRGBColorSpace,
    );
  }
}
