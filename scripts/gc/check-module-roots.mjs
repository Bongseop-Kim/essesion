#!/usr/bin/env node
import { createHash } from "node:crypto";
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
    const rule = "unknown-module-root";
    diagnostics.push({
      id: createHash("sha256").update(`${rule}\0${path}`).digest("hex"),
      rule,
      path,
      line: null,
      message: `정의되지 않은 모듈 루트: ${path}`,
      guidance:
        "ARCHITECTURE.md §4에 소유권과 허용 의존 방향을 먼저 정의한 뒤 디렉터리를 추가한다.",
    });
  }
}

diagnostics.sort((left, right) => left.id.localeCompare(right.id));
process.stdout.write(`${JSON.stringify({ version: "1", diagnostics })}\n`);
if (process.argv.includes("--check") && diagnostics.length > 0)
  process.exitCode = 1;
