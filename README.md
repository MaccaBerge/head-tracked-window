# head-tracked-window

Turns a screen into a window. A webcam follows your head and the 3D room behind
the screen is redrawn from where your eyes are, so it shifts in perspective as
you move, like looking through a real window. Rooms can be Gaussian splat scans,
or generated rooms built in code.

Runs in the browser on a laptop or a computer plugged into a TV. One viewer at a
time.

## Run it

```bash
npm install
npm run fetch-sample   # downloads the fireplace sample scene from Spark's examples
npm run dev
```

Open the address Vite prints in Chrome and allow the camera. Press **F** for
fullscreen, then sit about 50 cm from the screen and use **Calibrate at 50 cm**
under Display and camera.

Keys: **H** hides the panel, **F** fullscreen, **M** steers with the mouse
instead of the camera, **P** turns head tracking of the view on and off.

### On another computer at home

Browsers only allow the webcam on `https` pages, so serving to the home
network needs a certificate. Make a self-signed one once (put your computer's
network address in place of `10.0.0.167`), then start the server:

```bash
mkdir -p .certs && openssl req -x509 -newkey rsa:2048 -nodes -days 825 -keyout .certs/key.pem -out .certs/cert.pem -subj "/CN=window-room.local" -addext "subjectAltName=IP:10.0.0.167,DNS:localhost,IP:127.0.0.1"
npm run host
```

Open the Network address it prints on the other computer and accept the
browser's warning about the certificate. Settings are kept per browser.

## Rooms

- **Grid room**: a wireframe box with depth targets, for checking the effect.
- **Cube room**: walls of cubes with keyboard-style colour effects, published
  colour palettes, and adjustable layout and movement, plus balls that bounce
  off the moving cubes.
- **Aquarium**: a coral reef around a pirate shipwreck in the open ocean (or a
  glass fish tank). Fish school, come up to the glass to look at you, dart away
  when you move suddenly, and swim in and out of a hole in the wreck. Reef,
  sails, light and fish are adjustable in the panel.
- **Fogged mirror**: your reflection (the webcam) in a steamed-up mirror. Wipe
  it clear with an open hand or draw in it with one finger (or the mouse); the
  fog creeps back, frost grows in from the edges, and drops run down the glass.
- **Particle mirror**: a cloud of dust that gathers into your outline, coloured
  by the webcam, with some relief. An open hand blows the particles away, a fist
  pulls them into a spinning ball that bursts when you open it, and one finger
  draws a sparkler trail (the mouse pushes and pulls too). Moving fast smears
  you; Shatter breaks you apart. Colours can be the camera's, one tint, or a
  heat glow.
- **Splat rooms**: Gaussian splat scenes (`.ply`, `.spz`, `.splat`, `.ksplat`,
  `.sog`). Drag a file onto the page to add it, or put it in `public/splats/`
  and add an entry in `src/rooms.ts`. Placement behind the window is adjusted in
  the panel.

The grid and cube rooms can show you inside them, cut out of the webcam image
and standing on the floor at a depth that follows your distance.

`public/splats/` is not in the repository. The entries `custom_1` and `custom_2`
in `src/rooms.ts` are scans of the author's own rooms and load only where those
files exist.

## How it works

- **Head tracking**: MediaPipe Pose Landmarker in the browser finds the viewer,
  locks onto one person, and estimates eye position and distance from body
  proportions (`src/headTracker.ts`). In the mirror and particle rooms,
  MediaPipe Hand Landmarker tells an open hand, a pointing finger and a fist
  apart (`src/handTracker.ts`). The particle room runs its simulation on the
  GPU in float textures (`src/particles.ts`).
- **Person cutout**: MediaPipe's multiclass selfie segmenter finds the person
  (the pose model's own mask is a fallback, switchable under Cutout in the
  panel). The mask is clipped to a body shape drawn around the tracked
  skeleton, so furniture and wall beside you are left out (`src/bodyGate.ts`),
  then steadied over time (`src/maskCleaner.ts`).
- **Off-axis projection**: the camera frustum is fitted to the physical screen
  from the eye position (`src/offAxis.ts`), with display size and webcam
  position stored per display profile.
- **Rendering**: Three.js, with Spark for Gaussian splats.

## Stack

TypeScript, Vite, Three.js, Spark (`@sparkjsdev/spark`), MediaPipe Tasks
Vision, Geist fonts, lucide icons.
