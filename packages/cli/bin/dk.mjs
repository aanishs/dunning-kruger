#!/usr/bin/env node
// `dk` launcher. The CLI source is TypeScript run through tsx (this repo has no emit step),
// so the bin is a thin wrapper rather than a compiled dist/cli.js that doesn't exist. Running
// via `node --import tsx` keeps `dk ...` working after `npm link` / global install.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const entry = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "cli.ts");
const res = spawnSync(process.execPath, ["--import", "tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
