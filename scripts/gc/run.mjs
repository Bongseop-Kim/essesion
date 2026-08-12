#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";

import {
  normalizeDependencyCruiser,
  normalizeDiagnostics,
  normalizeImportLinter,
  normalizeJscpd,
  normalizeKnip,
  normalizeReactDoctor,
  normalizeVulture,
} from "./normalize.mjs";

const root = resolve(import.meta.dirname, "../..");
const config = JSON.parse(readFileSync(join(root, "gc.config.json"), "utf8"));
const changed = process.argv.includes("--changed");
const baseIndex = process.argv.indexOf("--base");
const base = baseIndex === -1 ? "main" : process.argv[baseIndex + 1];
if (baseIndex !== -1 && !base) throw new Error("--base requires a git ref");

const output = resolve(
  root,
  process.env.GC_OUTPUT_DIR ?? config.artifactDirectory,
);
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, "raw"), { recursive: true });

const baselinePath = join(root, config.baseline);
const baseline = existsSync(baselinePath)
  ? JSON.parse(readFileSync(baselinePath, "utf8"))
  : { metrics: {} };

function runCommand(command, extraArgs = []) {
  const [executable, ...configuredArgs] = command;
  const args = [...configuredArgs, ...extraArgs].map((arg) =>
    arg.replaceAll("{output}", output),
  );
  const started = performance.now();
  const result = spawnSync(executable, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      VITE_API_BASE_URL: "https://gc-sensor.invalid",
      VITE_TOSS_CLIENT_KEY: "gc_sensor_placeholder",
    },
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    ...result,
    duration: Math.round(performance.now() - started),
    command: [executable, ...args],
  };
}

function readReport(definition, result) {
  if (definition.report)
    return readFileSync(join(output, definition.report), "utf8");
  return result.stdout;
}

function normalize(sensor, definition, raw) {
  if (definition.parser === "vulture") return normalizeVulture(raw);
  if (definition.parser === "importLinter") return normalizeImportLinter(raw);
  const report = JSON.parse(raw);
  if (definition.parser === "dependencyCruiser")
    return normalizeDependencyCruiser(report);
  if (definition.parser === "diagnostics") return normalizeDiagnostics(report);
  if (definition.parser === "knip") return normalizeKnip(report);
  if (definition.parser === "jscpd")
    return normalizeJscpd(report, sensor, root);
  if (definition.parser === "reactDoctor")
    return normalizeReactDoctor(report, root);
  throw new Error(`Unknown parser: ${definition.parser}`);
}

function addBaseline(sensor, definition, normalized) {
  return normalized.metrics.map((metric) => {
    const baselineValue = baseline.metrics?.[sensor]?.[metric.name] ?? null;
    return {
      ...metric,
      direction: definition.direction,
      target: definition.target,
      baseline: baselineValue,
      delta: baselineValue === null ? null : metric.value - baselineValue,
    };
  });
}

function markNewFindings(sensor, findings) {
  const known = new Set(baseline.findings?.[sensor] ?? []);
  return findings.map((finding) => ({
    ...finding,
    is_new: !known.has(finding.id),
  }));
}

function unknownSensor(sensor, definition, duration, message) {
  return {
    sensor,
    tool_version: null,
    scope: definition.scope,
    status: "unknown",
    duration_ms: duration,
    metrics: [],
    findings: [],
    suppressed_count: 0,
    parser_errors: [message],
    partial: true,
  };
}

const selected = changed ? ["react-doctor"] : Object.keys(config.sensors);
const sensors = [];

for (const sensor of selected) {
  const definition = config.sensors[sensor];
  const extraArgs = changed
    ? ["--scope", "changed", "--base", base, "--include-untracked"]
    : [];
  const result = runCommand(definition.command, extraArgs);
  const rawPath = join(
    output,
    "raw",
    `${sensor}.${definition.parser === "vulture" ? "txt" : "json"}`,
  );
  writeFileSync(rawPath, result.stdout || "", "utf8");
  if (result.stderr) writeFileSync(`${rawPath}.stderr`, result.stderr, "utf8");

  if (!definition.successExitCodes.includes(result.status)) {
    sensors.push(
      unknownSensor(
        sensor,
        definition,
        result.duration,
        `command failed (${result.status}): ${(result.stderr || result.error?.message || "unknown").slice(0, 500)}`,
      ),
    );
    continue;
  }

  try {
    const raw = readReport(definition, result);
    const normalized = normalize(sensor, definition, raw);
    normalized.findings.sort((left, right) => left.id.localeCompare(right.id));
    sensors.push({
      sensor,
      tool_version: normalized.tool_version,
      scope: definition.scope,
      status: normalized.parserErrors?.length ? "unknown" : "ok",
      duration_ms: result.duration,
      metrics: addBaseline(sensor, definition, normalized),
      findings: markNewFindings(sensor, normalized.findings),
      suppressed_count: 0,
      parser_errors: normalized.parserErrors ?? [],
      partial: Boolean(normalized.partial || normalized.parserErrors?.length),
    });
  } catch (error) {
    sensors.push(
      unknownSensor(
        sensor,
        definition,
        result.duration,
        `parser failed: ${error.message}`,
      ),
    );
  }
}

const summary = {
  schema_version: config.schemaVersion,
  mode: changed ? "changed" : "full",
  sensors,
};
writeFileSync(
  join(output, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
  "utf8",
);

const rows = sensors.map((sensor) => ({
  sensor: sensor.sensor,
  status: sensor.status,
  findings: sensor.findings.length,
  duration_ms: sensor.duration_ms,
}));
console.table(rows);
console.log(`GC summary: ${join(output, "summary.json")}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## Harness GC sensors",
    "",
    "| Sensor | Status | Findings | New | Baseline delta | Duration |",
    "|---|---:|---:|---:|---:|---:|",
    ...sensors.map((sensor) => {
      const total = sensor.metrics.find(
        (metric) => metric.name === "total_findings",
      );
      const newCount = sensor.findings.filter(
        (finding) => finding.is_new,
      ).length;
      const delta =
        total?.delta === null || total?.delta === undefined ? "—" : total.delta;
      return `| ${sensor.sensor} | ${sensor.status} | ${sensor.findings.length} | ${newCount} | ${delta} | ${sensor.duration_ms} ms |`;
    }),
    "",
    "실패하거나 partial인 센서는 개선으로 해석하지 않는다.",
    "",
  ];
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"), "utf8");
}

if (sensors.some((sensor) => sensor.status === "unknown")) process.exitCode = 2;
