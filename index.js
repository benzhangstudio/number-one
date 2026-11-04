// Entry point for Wispbyte (set the panel's start file to index.js).
// The TypeScript source is compiled into dist/ when it starts (see scripts/build.mjs).

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const [major, minor] = process.versions.node.split(".").map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `Number One needs Node.js 22.13 or newer (this server has ${process.versions.node}). ` +
      "Pick a newer Node.js version in the Wispbyte panel's Startup tab.",
  );
  process.exit(1);
}

// Node prints a one-time "SQLite is experimental" notice; it's expected, so keep the console clean.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  if (String(warning).includes("SQLite is an experimental feature")) return;
  emitWarning(warning, ...args);
};

// Build the bot and the dashboard (skipped when nothing changed). This runs here, after `npm install` has
// finished, rather than inside it, so npm's memory is freed first: the small Wispbyte server ran out of memory
// building inside `npm install`. If the build fails but an older build exists, keep running that one.
const build = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: import.meta.dirname, stdio: "inherit" });
if (build.status !== 0) {
  if (!existsSync(new URL("./dist/server/index.js", import.meta.url))) {
    console.error("Number One couldn't be built, and there's no earlier build to fall back on. See the errors above.");
    process.exit(1);
  }
  console.error("[build] The new version couldn't be built, so the previous version is starting instead.");
}

await import("./dist/server/index.js");
