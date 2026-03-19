# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

StarHop Planner — an astronomy observation planning tool that computes star-hopping routes from bright anchor stars to deep-sky targets (Messier objects, binocular targets). It runs as a client-heavy single-page app with a minimal Express backend.

## Git

There is no remote repository. Do not attempt to push commits.

## Commands

- `npm run dev` — Start dev server (Express + Vite HMR on port 5000)
- `npm run build` — Production build (Vite client → `dist/public`, esbuild server → `dist/index.cjs`)
- `npm run start` — Run production build
- `npm run check` — TypeScript type checking (no emit)
- `npm run db:push` — Push Drizzle schema to PostgreSQL (requires `DATABASE_URL`)
- `npx vitest` — Run unit tests

## Testing

- **Run tests after every change.** After any code modification, run `npx vitest` and confirm all tests pass before considering the work done.
- **Always look for opportunities to add unit tests to core algorithms.** The routing and astronomy logic in `lib/astronomy.ts` and `lib/route-planner.ts` are the heart of the app — new behaviour in these files should have corresponding tests in `client/src/lib/__tests__/`.

## Architecture

**Frontend-heavy app.** Almost all logic lives in the client. The server is a thin Express 5 shell that serves static files and has stub CRUD routes (currently unused — `shared/schema.ts` has no real DB schema).

### Client (`client/src/`)
- **Single page:** `pages/planner.tsx` is the entire UI — observing parameter form, target selector, route display, and animation controls.
- **Astronomy engine:** `lib/astronomy.ts` (~1200 lines) is the core. It handles:
  - Catalog loading from static JSON (`public/data/bsc5-short.json`, `messier.json`, `binocular-catalog.json`, `constellations.lines.json`, `stars-dense.json`)
  - Coordinate transforms (equatorial ↔ horizontal) via `astronomy-engine`
  - Sky graph construction with FOV-overlap-aware edge costs
  - Star pattern recognition (triangle, chain, bracket, pair, field)
  - Stereographic projection for the sky chart SVG
- **Route planner:** `lib/route-planner.ts` (~460 lines) — Variable-Reach A* pathfinding, difficulty levels, instruction compression, human-readable hop generation
- **SkyChart component:** `components/SkyChart.tsx` — interactive SVG sky chart with zoom/pan, constellation lines, route overlay, and FOV indicator.
- **Routing:** wouter with hash-based location (`useHashLocation`)
- **UI:** shadcn/ui (new-york style) + Tailwind CSS + Radix primitives

### Path Aliases
- `@/*` → `client/src/*`
- `@shared/*` → `shared/*`
- `@assets` → `attached_assets/` (Vite only)

### Server (`server/`)
- Express 5 with `http.createServer` wrapper
- `storage.ts` exports a `MemStorage` class (in-memory, currently empty interface)
- In dev: Vite middleware via `vite.ts`. In prod: static serving via `static.ts`
- Port from `PORT` env var, defaults to 5000

### Key Domain Concepts
- **Observing modes:** `telescope` vs `binocular` — different FOV defaults, hop cost profiles, and anchor brightness thresholds
- **FOV overlap:** Routes prefer hops where consecutive fields of view overlap (30-70% of FOV width is the sweet spot)
- **Pattern recognition:** Each hop step identifies geometric patterns among visible guide stars to help the observer confirm position
- **Unified targets:** Messier catalog + binocular catalog merged with deduplication

## Current Status (as of 2026-03-19)

### Recently Completed
- **Variable-Reach A\* routing** (`lib/route-planner.ts`) — replaces original greedy Dijkstra. Three difficulty levels (beginner/intermediate/expert) apply soft cost penalties to prefer shorter hops and brighter waypoints for beginners. Goal deduplication prevents routing through duplicate catalog entries.
- **Instruction clarity** — `displayName()` eliminates bare HR catalog numbers; `patternLabel()` adds compact Bayer/Flamsteed labels; directional context added to guide star references; binocular targets show nickname + designation (e.g. "Double-Double (ε Lyr)").
- **Dense star field** — `client/public/data/stars-dense.json` used for background star rendering in SkyChart.
- **In-chart display controls** — font size slider, navigation star size slider, HTML legend overlay with show/hide toggle.
- **Confusion penalty** — penalizes routes through dense, hard-to-distinguish star fields.
- **Vitest test suite** — 40 tests in `client/src/lib/__tests__/` covering A* routing and difficulty differentiation. Run with `npx vitest`.
- **Free-port server fix** — dev server auto-finds a free port if 5000 is taken.

### Known State
- `star-hopping.md` (untracked) contains algorithm research notes — not part of the build.
- DB/storage layer is unused stubs; no PostgreSQL setup required for normal dev.
