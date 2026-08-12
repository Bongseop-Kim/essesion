#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import {
  normalizeDependencyCruiser,
  normalizeImportLinter,
} from "./normalize.mjs";

const root = resolve(import.meta.dirname, "../..");

const dependencyCruiser = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "scripts/gc/fixtures/architecture/apps/store/src",
    "--config",
    "dependency-cruiser.config.mjs",
    "--output-type",
    "json",
  ],
  { cwd: root, encoding: "utf8" },
);
const dependencyFindings = normalizeDependencyCruiser(
  JSON.parse(dependencyCruiser.stdout),
).findings;
if (
  dependencyFindings[0]?.rule !== "frontend-no-server-internals" ||
  !dependencyFindings[0]?.guidance
) {
  throw new Error(
    "dependency-cruiser fixture did not fail with corrective rule",
  );
}
const dependencyCruiserFailure = spawnSync(
  "pnpm",
  [
    "exec",
    "depcruise",
    "scripts/gc/fixtures/architecture/apps/store/src",
    "--config",
    "dependency-cruiser.config.mjs",
  ],
  { cwd: root, encoding: "utf8" },
);
if (
  dependencyCruiserFailure.status === 0 ||
  !dependencyCruiserFailure.stdout.includes("frontend-no-server-internals")
) {
  throw new Error(
    "dependency-cruiser fixture did not return a blocking exit code",
  );
}

const pythonFixture = resolve(root, "scripts/gc/fixtures/architecture/python");
const importLinter = spawnSync(
  resolve(root, ".venv/bin/lint-imports"),
  ["--config", ".importlinter", "--no-cache"],
  { cwd: pythonFixture, encoding: "utf8" },
);
const importFindings = normalizeImportLinter(importLinter.stdout).findings;
if (
  importLinter.status === 0 ||
  importFindings.length !== 1 ||
  !importFindings[0].guidance
) {
  throw new Error(
    "import-linter fixture did not fail with corrective contract",
  );
}

console.log("architecture fixtures: expected violations detected");
