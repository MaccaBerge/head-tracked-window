# Window Room

A webcam tracks one viewer's head, and a 3D room behind the screen is drawn
with an off-axis projection so the screen acts like a window. It runs in the
browser on a MacBook (M1, built-in webcam), often plugged into a TV over HDMI.
Vite + TypeScript + Three.js; MediaPipe for tracking, Spark for Gaussian splats.

## Working together

- **Keep personal room scans out of git**: `public/splats/*` is ignored. The
  fireplace sample is downloaded with `npm run fetch-sample`, never committed.
  The GitHub repo is public.
- **Check visual changes in the browser before calling them done**: look at
  the result and compare it with what was asked. Say plainly what couldn't be
  checked (webcam and hand tracking can't be tested in the in-app browser).
- Fun personal project: favour trying things and tuning by eye over long
  discussions, but ask when a choice changes what gets built.

## Git & GitHub rules

- Never commit directly to `main`. Start every task on a new branch:
  `feat/<short-name>`, `fix/<short-name>`, or `chore/<short-name>`.
- Commit in small, logical steps with clear messages: `<type>: <summary>`
  (types: feat, fix, test, refactor, docs, chore).
- Run `npm run build` (type check + build) and check the change in the
  browser before the final commit.
- Never commit `.certs/`, `node_modules/`, `dist/`, room scans or other
  personal files.
- When done: push the branch and open a PR to `main` with `gh pr create`,
  describing what changed and how it was tested (what was checked in the
  browser, and what couldn't be, such as the webcam).
- Never merge PRs, never force-push, never rewrite history on pushed branches.
  The owner reviews and merges PRs on GitHub.
- CI (`.github/workflows/ci.yml`) runs on PRs and pushes to `main`: `npm ci`,
  then `npm run build`. It needs no repository secrets.

## Commands

```bash
npm run dev            # dev server (Vite prints the address)
npm run host           # HTTPS on the home network, for another computer (needs .certs/, see README)
npx tsc --noEmit       # type check; run after every change
npm run build          # type check + production build
```

## How it fits together

- **Window space**: metres, origin at the centre of the screen, +z towards the
  viewer. `offAxis.ts` measures the window from the display profile and builds
  the asymmetric frustum; `clipAtWindow` puts the near plane on the glass.
- **Rooms** implement `Room` in `rooms.ts`: `group`, optional `fog` and
  `background`, `update(timeS, eye?, viewer?)`, `dispose()`. `eye` is where the
  view is drawn from (fixed when Follow head is off); `viewer` is where the
  person really is (head or mouse). Anything that reacts to the person uses
  `viewer`, so it keeps working with Follow head off. Mouse mode steers the
  view even with Follow head off.
- Add a room: a config type and entry in `ROOMS` (`rooms.ts`), a branch in
  `rebuild()` (`main.ts`), its panel section shown or hidden in `syncHud()`.
- **Tracking**: `headTracker.ts` (pose model, sticky lock on one person,
  OneEuro filtering, optional person cutout). `handTracker.ts` (hand model,
  palm / point / fist) runs only in the mirror and particle rooms. Both
  lazy-load MediaPipe. The particle room also turns on the person cutout.
- Splat rooms lazy-load Spark; keep heavy libraries out of the first download.

## Settings and panel

- Settings live in localStorage (`window-room-settings-v2`) and are merged
  with defaults on load, so new keys need only a default. Each room module
  exports its settings interface and `*_DEFAULTS`; `settings.ts` combines them.
- A new numeric setting needs: the interface field with a doc comment, a
  default, a slider in `index.html` (`data-tank` / `data-mirror` / ...), and
  an entry in the matching `format*Value` record in `main.ts`.
- Prefer settings that are read live each frame (uniforms, per-frame reads).
  Only settings that change geometry go in a rebuild set (e.g. `rebuildsTank`),
  and those use `commitSoon()` so dragging rebuilds at most once per frame.
- Panel layout: a few key controls at the top of a room's section, the rest in
  collapsible `<details class="fold">` sections with a `chevron-right` icon.
  Sentence case, no full stops on labels, explanations in `title` tooltips.
- Lucide icons must be imported and listed in `createIcons` in `main.ts`
  before `<i data-lucide="...">` works.
- Keyboard shortcuts: H panel, F fullscreen, M mouse, P follow head.

## Three.js gotchas

- In `onBeforeCompile` string replacements, every `#include <...>` must be on
  its own line, or the shader fails to compile.
- `ShaderMaterial` needs `#include <colorspace_fragment>` (own line) to output
  correct colours, and the fog chunks plus `UniformsLib.fog` to take part in fog.
- Lights don't scale with their parent. Model-sized things (the shipwreck is a
  few tens of centimetres) need tiny point-light intensities and distances.
- Size things by the window (`unit = windowHeight`) so a bigger tank means
  more space, not bigger fish.

## Verifying in the in-app browser

- The browser pane often runs at about 1 fps when not in focus. To check
  behaviour, import the module and step `room.update()` by hand, e.g.
  `const A = await import('/src/aquarium.ts?x=' + Date.now())`.
- The console keeps errors from earlier hot reloads; check fresh failures with
  `performance.getEntriesByType('resource')` (responseStatus >= 400) or the
  timestamp in the error's URL.
- Reset any viewport size you set, and put back settings changed for a test
  (they persist in localStorage).

## Style

- British spelling in code, comments and UI ("colour").
- Comments explain why, in plain words. Names say what things are.
