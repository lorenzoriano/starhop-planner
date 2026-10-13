import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, readFile, readdir, writeFile } from "fs/promises";
import { createHash } from "crypto";

// server deps to bundle to reduce openat(2) syscalls
// which helps cold start times
const allowlist = [
  "@google/generative-ai",
  "axios",
  "connect-pg-simple",
  "cors",
  "date-fns",
  "drizzle-orm",
  "drizzle-zod",
  "express",
  "express-rate-limit",
  "express-session",
  "jsonwebtoken",
  "memorystore",
  "multer",
  "nanoid",
  "nodemailer",
  "openai",
  "passport",
  "passport-local",
  "pg",
  "stripe",
  "uuid",
  "ws",
  "xlsx",
  "zod",
  "zod-validation-error",
];

async function buildAll() {
  await rm("dist", { recursive: true, force: true });

  console.log("building client...");
  await viteBuild();

  // Precache every emitted asset and catalog, including hashed JS/CSS bundles.
  async function filesIn(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? filesIn(`${dir}/${e.name}`) : [`${dir}/${e.name}`],
      ),
    );
    return nested.flat();
  }
  const files = (await filesIn("dist/public"))
    .filter((p) => !p.endsWith("/sw.js"))
    .sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file);
    hash.update(await readFile(file));
  }
  const build = hash.digest("hex").slice(0, 16);
  // The page can distinguish its own assets from a still-active older worker.
  const html = await readFile("dist/public/index.html", "utf8");
  await writeFile("dist/public/index.html", html.replace("</head>", `<meta name="starhop-build" content="${build}"></head>`));
  await writeFile(
    "dist/public/offline-assets.json",
    JSON.stringify({
      build,
      files: files.map((p) => `./${p.slice("dist/public/".length)}`),
    }),
  );
  const worker = await readFile("dist/public/sw.js", "utf8");
  await writeFile(
    "dist/public/sw.js",
    worker.replace("__STARHOP_BUILD__", build),
  );

  console.log("building server...");
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const allDeps = [
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ];
  const externals = allDeps.filter((dep) => !allowlist.includes(dep));

  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: "dist/index.cjs",
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: externals,
    logLevel: "info",
  });
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
