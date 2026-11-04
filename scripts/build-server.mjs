// Builds the bot (src/ → dist/) by turning each TypeScript file into JavaScript, without checking types.
// It needs far less memory than `tsc` (which the small Wispbyte server ran out of) and takes about a second.
// Types are still checked with `npm run typecheck` while developing.
import { build } from "esbuild";

await build({
  entryPoints: ["src/server/**/*.ts", "src/features/**/*.ts", "src/shared/**/*.ts"],
  outbase: "src",
  outdir: "dist",
  bundle: false,
  platform: "node",
  format: "esm",
  target: "node22",
  sourcemap: true,
  logLevel: "warning",
});
console.log("[build] bot built into dist/");
