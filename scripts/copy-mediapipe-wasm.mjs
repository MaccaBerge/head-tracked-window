// Copies the MediaPipe WASM runtime out of node_modules so the app serves it
// itself (same version as the installed package, no CDN needed for it).
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const from = resolve(root, "node_modules/@mediapipe/tasks-vision/wasm");
const to = resolve(root, "public/mediapipe-wasm");

if (existsSync(from)) {
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log("Copied MediaPipe WASM runtime to public/mediapipe-wasm");
}
