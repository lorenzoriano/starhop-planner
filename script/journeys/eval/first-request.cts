// CommonJS launcher (see run-grid.cts): npx tsx script/journeys/eval/first-request.cts [instant lat lon]
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { main } = require('./first-request.ts') as { main: () => Promise<void> };
main().catch((e: unknown) => { console.error(e); process.exit(1); });
