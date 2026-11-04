// Builds the bot and the dashboard into dist/. index.js runs this on every start, after `npm install`
// has finished, so npm's own memory is freed first (the small Wispbyte server ran out of memory when
// the build ran inside `npm install`). When nothing changed since the last build, it's skipped, so most
// restarts are quick. Run `npm run build` to build again anyway.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const stampFile = join(dist, ".build-hash");
const force = process.argv.includes("--force");

/** A fingerprint of everything the build reads, so an unchanged checkout isn't built twice. */
function fingerprint() {
  const hash = createHash("sha256");
  const add = (path) => {
    for (const name of readdirSync(path).sort()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      const full = join(path, name);
      if (statSync(full).isDirectory()) add(full);
      else hash.update(full.slice(root.length)).update(readFileSync(full));
    }
  };
  for (const dir of ["src", "dashboard", "scripts"]) add(join(root, dir));
  for (const file of ["package.json", "tsconfig.json"]) hash.update(file).update(readFileSync(join(root, file)));
  return hash.digest("hex");
}

const step = (label, args) => {
  console.log(`[build] ${label}…`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`[build] ${label} failed${r.signal === "SIGKILL" ? " (the server ran out of memory)" : ""}.`);
    process.exit(1);
  }
};

const current = fingerprint();
const built = existsSync(join(dist, "server/index.js")) && existsSync(join(dist, "dashboard/index.html"));
if (!force && built && existsSync(stampFile) && readFileSync(stampFile, "utf8") === current) {
  console.log("[build] nothing changed since the last build, skipping it");
  process.exit(0);
}

step("building the bot", ["scripts/build-server.mjs"]);
// The dashboard is built next to the old one and swapped in at the end, so a failed build leaves the old one working.
const next = join(dist, "dashboard.next");
step("building the dashboard", ["node_modules/vite/bin/vite.js", "build", "--config", "dashboard/vite.config.ts", "--outDir", next, "--emptyOutDir", "--logLevel", "warn"]);
rmSync(join(dist, "dashboard"), { recursive: true, force: true });
renameSync(next, join(dist, "dashboard"));
writeFileSync(stampFile, current);
console.log("[build] done");
