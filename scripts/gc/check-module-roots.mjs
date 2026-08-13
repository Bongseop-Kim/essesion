#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const allowed = {
  apps: new Set(["admin", "api", "store", "worker"]),
  db: new Set(["migrations", "src"]),
  packages: new Set(["api-client", "shared", "tsconfig"]),
  libs: new Set(["obs", "svg-safety"]),
};
const diagnostics = [];

for (const [parent, names] of Object.entries(allowed)) {
  for (const entry of readdirSync(join(root, parent), {
    withFileTypes: true,
  })) {
    if (
      !entry.isDirectory() ||
      entry.name.startsWith(".") ||
      entry.name === "__pycache__"
    )
      continue;
    if (names.has(entry.name)) continue;
    const path = relative(root, join(root, parent, entry.name));
    diagnostics.push(`정의되지 않은 모듈 루트: ${path}`);
  }
}

diagnostics.sort();
for (const diagnostic of diagnostics) console.error(diagnostic);
if (process.argv.includes("--check") && diagnostics.length > 0)
  process.exitCode = 1;
