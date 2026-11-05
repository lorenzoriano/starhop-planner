// CommonJS launcher (see run-grid.cts): npx tsx script/journeys/eval/examples.cts > data-dev/journeys-eval/examples.md
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./examples.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e); process.exit(1); });
