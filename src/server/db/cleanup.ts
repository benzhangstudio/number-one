import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { config } from "../config.js";
import { sqlite } from "./client.js";

/** Folders in data/ left behind by features that were removed (BLACKPINK Poker's card photos). */
const leftovers = ["card-photos"];

/**
 * Frees disk space on start-up: deletes leftover folders, and shrinks the database file when a lot of it is
 * empty space (SQLite keeps the space from deleted rows and dropped tables until the file is rebuilt).
 */
export function freeDiskSpace() {
  for (const name of leftovers) {
    const dir = join(config.dataDir, name);
    if (!existsSync(dir)) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
      console.log(`[cleanup] deleted data/${name}`);
    } catch (err) {
      console.warn(`[cleanup] couldn't delete data/${name}:`, (err as Error).message);
    }
  }
  try {
    const pages = Number((sqlite.prepare("PRAGMA page_count").get() as { page_count: number }).page_count);
    const free = Number((sqlite.prepare("PRAGMA freelist_count").get() as { freelist_count: number }).freelist_count);
    if (free > 256 && free > pages * 0.2) {
      sqlite.exec("VACUUM");
      sqlite.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      console.log(`[cleanup] shrank the database (freed ${free} unused pages)`);
    }
  } catch (err) {
    console.warn("[cleanup] couldn't shrink the database:", (err as Error).message);
  }
}
