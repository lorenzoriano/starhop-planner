/**
 * CommonJS launcher for export-calibration-slates.ts (same reason as run-export.cts: under tsx's ESM mode the
 * engine cannot see astronomy-engine's CommonJS exports; required from a .cts entry it loads as CommonJS).
 *
 *   npx tsx script/journeys/train/export-calibration-slates.cts            writes calibration-slates.json, previews slate 1
 *   npx tsx script/journeys/train/export-calibration-slates.cts --show 3   prints slate 3 of the existing file
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./export-calibration-slates.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e); process.exit(1); });
