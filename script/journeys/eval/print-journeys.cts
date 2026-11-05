/**
 * CommonJS launcher for print-journeys.ts (same reason as run-grid.cts: under tsx's ESM mode the engine cannot see
 * astronomy-engine's CommonJS exports; required from a .cts entry it loads as CommonJS).
 *
 *   npx tsx script/journeys/eval/print-journeys.cts --theme A2 --limit 6
 *   npx tsx script/journeys/eval/print-journeys.cts --site london --month 1 --optic 10x50
 *   npx tsx script/journeys/eval/print-journeys.cts --availability
 *   npx tsx script/journeys/eval/print-journeys.cts --fresh --theme A9      (lens files read straight from curated/lenses)
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./print-journeys.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
