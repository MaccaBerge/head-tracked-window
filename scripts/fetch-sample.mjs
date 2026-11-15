// Downloads the fireplace sample scene from Spark's example assets into
// public/splats, where the "Fireplace (sample)" room looks for it.
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const URL = "https://sparkjs.dev/assets/splats/fireplace.spz";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const target = resolve(root, "public/splats/fireplace.spz");

if (existsSync(target)) {
  console.log("public/splats/fireplace.spz is already there");
} else {
  mkdirSync(dirname(target), { recursive: true });
  const res = await fetch(URL);
  if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(target));
  console.log("Saved public/splats/fireplace.spz");
}
