/**
 * CommonJS launcher for export-candidates.ts. tsx loads .ts files as ESM in this "type": "module" package, and
 * in that mode astronomy-engine's CommonJS exports are not visible through `import * as`; required from a
 * .cts entry the whole engine loads as CommonJS, exactly like vitest/vite resolve it.
 *
 *   npx tsx script/journeys/train/run-export.cts --meta-only
 *   npx tsx script/journeys/train/run-export.cts --kb synthetic --n 60 --out data-dev/journeys-training
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./export-candidates.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e); process.exit(1); });
