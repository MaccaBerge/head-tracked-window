/// <reference lib="webworker" />
/**
 * Tracking runs here, off the page's main thread, so drawing the room never
 * waits for the pose model, the person segmenter, reading masks back from the
 * GPU or cleaning them up. The page sends each new webcam frame while the
 * worker is free (frames that arrive while it's busy are skipped) and gets
 * the results back a moment later.
 */
import type { ToWorker } from "./trackerMessages";
import { TrackerCore } from "./trackerCore";

declare const self: DedicatedWorkerGlobalScope;

const core = new TrackerCore();
let ready = false;

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === "init") {
    try {
      await core.init(message.wasmPath);
      ready = true;
      self.postMessage({ type: "ready" });
    } catch (e) {
      self.postMessage({ type: "failed", error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }
  if (!ready) {
    message.frame.close();
    return;
  }
  const result = await core.process(message.frame, message.now, message.options);
  // The frame, mask and body shape move to the page rather than being copied.
  const transfer: Transferable[] = [];
  if (result.cutout) transfer.push(result.cutout.frame, result.cutout.mask.buffer);
  if (result.gate) transfer.push(result.gate);
  self.postMessage(result, transfer);
};
