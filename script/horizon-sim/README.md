# Horizon simulation harness

Drives the real "Add trees and buildings" capture in Chrome with a synthetic world whose skyline, lens, north offset
and sensor errors are known, then compares what the app saved with the truth (docs/local-horizon-design.md, 10.2).
Not part of `npm test`. Outputs go to the session scratch folder (`HORIZON_SIM_OUT` overrides), never the repo.

## Run

```sh
export NODE_PATH=/home/lorenzo/.npm/_npx/705bc6b22212b352/node_modules   # where `playwright` lives
npx tsx script/horizon-sim/scenarios.ts                                 # list scenarios and pass criteria
npx tsx script/horizon-sim/run.ts --scenario day-sun-hills              # builds what is missing, starts a dev server
npx tsx script/horizon-sim/run.ts --scenario day-sun-hills --base http://localhost:5173/   # reuse a running server
```

All scenarios: `for s in $(npx tsx script/horizon-sim/scenarios.ts | cut -d' ' -f1); do npx tsx script/horizon-sim/run.ts --scenario $s --base http://localhost:5173/; done`
(runs can also go in parallel against one server; the first build of each scenario takes ~2 min and ~1.5 GB of video).

`run.ts` options: `--rebuild` (regenerate scene, video, sensors), `--headed`, `--timeout <s>` (default 420).
Without `--base` it starts `npm run dev` on `PORT` (default 5173) and stops that process group afterwards.
Exit code 0 = pass. Results: `<out>/<scenario>/report.json`, `shot-*.png`, `panorama.webp`.

Steps can be run on their own (each takes `--scenario`):

| Script | Output |
|---|---|
| `make-scene.ts` | `world.rgb` (4096×2048 equirect), `world-preview.png` (true skyline in red), `truth.json` |
| `make-video.ts` | `scene.y4m` (1280×960, 30 fps, ~27 s, ~1.5 GB; bottom 12 px = frame barcode), `poses.json`; `--snapshots` writes a few frames as PNG |
| `sensors.ts` | `sensors.json` (relative/absolute quaternions, accelerometer, gyroscope per frame) and a round-trip check |
| `tiles.ts` | self-check of the synthetic Terrarium tiles and the truth terrain skyline |
| `probe.ts` | plumbing check: fake camera + barcode crop, sensor override, landscape angle, fixed clock, PNG tiles |

## How it works

- The camera image the app sees is 1280×948 (the barcode strip is cropped by the init script in `lib/inject.ts`
  before the app gets the track); the true HFOV is across those 1280 px, principal point at its centre.
- Each camera frame's barcode is reported to the runner, which pushes that frame's sensor readings over CDP
  (`Emulation.setSensorOverrideReadings`). Chrome loops the video; readings follow the frame number.
- Vite's HMR socket is answered by the runner (never reaches the server), so edits to the tree during a run cannot
  hot-reload the page mid-capture (a Fast Refresh remount stops the camera and sensors and silently drops the tap).
- The page clock is fixed at the scene time (`Date` only), so the Sun, Moon and stars match the rendered sky.
- Terrain tiles for both Mapterhorn and AWS Terrarium are served from the scene's DEM, so the app's terrain layer
  equals the truth terrain (computed with the app's own ray caster on the same quantised tiles).
- The runner presses Start during the start hold (the guide's first heading), "Finish sweep" or "Add the tall-tree
  ring" when ring 0 is done, "Tap when centred" in the middle of the alignment hold (or "Skip"), traces the true
  skyline + noise on `horizon-trace` at night, then "Save", and reads localStorage + IndexedDB.
