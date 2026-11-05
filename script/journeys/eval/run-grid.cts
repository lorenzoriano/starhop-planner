/**
 * CommonJS launcher for run-grid.ts (same reason as train/run-export.cts: under tsx's ESM mode the engine
 * cannot see astronomy-engine's CommonJS exports; required from a .cts entry it loads as CommonJS, exactly like
 * vitest/vite resolve it).
 *
 *   npx tsx script/journeys/eval/run-grid.cts --label after            full grid (5 sites in parallel) + themes
 *   npx tsx script/journeys/eval/run-grid.cts --label quick --quick    15th of each month only, no themes
 *   npx tsx script/journeys/eval/run-grid.cts --site London --no-themes   one site, in-process
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./run-grid.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e); process.exit(1); });
