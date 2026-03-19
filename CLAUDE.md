# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

StarHop Planner — an astronomy observation planning tool that computes star-hopping routes from bright anchor stars to deep-sky targets (Messier objects, binocular targets). It runs as a client-heavy single-page app with a minimal Express backend.

## Commands

- `npm run dev` — Start dev server (Express + Vite HMR on port 5000)
- `npm run build` — Production build (Vite client → `dist/public`, esbuild server → `dist/index.cjs`)
- `npm run start` — Run production build
- `npm run check` — TypeScript type checking (no emit)
- `npm run db:push` — Push Drizzle schema to PostgreSQL (requires `DATABASE_URL`)

## Architecture

**Frontend-heavy app.** Almost all logic lives in the client. The server is a thin Express 5 shell that serves static files and has stub CRUD routes (currently unused — `shared/schema.ts` has no real DB schema).

### Client (`client/src/`)
- **Single page:** `pages/planner.tsx` is the entire UI — observing parameter form, target selector, route display, and animation controls.
- **Astronomy engine:** `lib/astronomy.ts` (~1200 lines) is the core. It handles:
  - Catalog loading from static JSON (`public/data/bsc5-short.json`, `messier.json`, `binocular-catalog.json`, `constellations.lines.json`)
  - Coordinate transforms (equatorial ↔ horizontal) via `astronomy-engine`
  - Sky graph construction with FOV-overlap-aware edge costs
  - Dijkstra pathfinding from anchor stars to targets
  - Star pattern recognition (triangle, chain, bracket, pair, field)
  - Route scoring and human-readable hop instruction generation
  - Stereographic projection for the sky chart SVG
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
