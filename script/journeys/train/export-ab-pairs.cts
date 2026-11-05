/**
 * CommonJS launcher for export-ab-pairs.ts (same reason as run-export.cts: under tsx's ESM mode the engine cannot
 * see astronomy-engine's CommonJS exports; required from a .cts entry it loads as CommonJS).
 *
 *   npx tsx script/journeys/train/export-ab-pairs.cts            writes ab-round1.json, previews pair 1
 *   npx tsx script/journeys/train/export-ab-pairs.cts --show 3   prints pair 3 of the existing file
 *   npx tsx script/journeys/train/export-ab-pairs.cts --round round2 --themes "A3:A7,A1:A9@Colorado dark site/7/new"
 *                                                                hand-picked pairs (see README.md, Owner A/B rounds)
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./export-ab-pairs.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e); process.exit(1); });
