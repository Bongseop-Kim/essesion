import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

const issueKinds = [
  "binaries",
  "catalog",
  "catalogReferences",
  "dependencies",
  "devDependencies",
  "duplicates",
  "enumMembers",
  "exports",
  "files",
  "namespaceMembers",
  "optionalPeerDependencies",
  "types",
  "unlisted",
  "unresolved",
];

function stableId(parts) {
  return createHash("sha256").update(parts.join("\0")).digest("hex");
}

function finding(
  sensor,
  rule,
  path,
  line,
  name,
  message,
  guidance,
  severity = "warning",
) {
  return {
    id: stableId([sensor, rule, path, line ?? "", name ?? ""]),
    rule,
    severity,
    path,
    line,
    message,
    guidance,
  };
}

function excerpt(path, start, end = start) {
  try {
    return readFileSync(path, "utf8")
      .split("\n")
      .slice(Math.max(0, start - 1), end)
      .join("\n")
      .trim();
  } catch {
    return `${start}:${end}`;
  }
}

export function normalizeKnip(report) {
  const findings = [];
  const counts = Object.fromEntries(issueKinds.map((kind) => [kind, 0]));

  for (const issue of report.issues ?? []) {
    for (const kind of issueKinds) {
      for (const value of issue[kind] ?? []) {
        const item = typeof value === "string" ? { name: value } : value;
        counts[kind] += 1;
        const itemFinding = finding(
          "knip",
          kind,
          issue.file,
          item.line ?? null,
          item.name,
          `${item.name ?? issue.file}: unused ${kind}`,
          "동적 진입점과 공개 API 참조를 먼저 확인하고, 오탐이면 knip.json에 진입점을 등록한다.",
        );
        itemFinding.id = stableId([
          "knip",
          kind,
          issue.file,
          item.name ?? issue.file,
        ]);
        findings.push(itemFinding);
      }
    }
  }

  return {
    tool_version: "6.32.2",
    metrics: [
      ...Object.entries(counts)
        .filter(([, value]) => value > 0)
        .map(([name, value]) => ({ name, value })),
      { name: "total_findings", value: findings.length },
    ],
    findings,
  };
}

export function normalizeJscpd(report, sensor, root) {
  const total = report.statistics?.total ?? {};
  const findings = (report.duplicates ?? []).map((duplicate) => {
    const firstPath = relative(root, duplicate.firstFile.name);
    const secondPath = relative(root, duplicate.secondFile.name);
    const duplicateFinding = finding(
      sensor,
      "duplicate-block",
      firstPath,
      duplicate.firstFile.start,
      `${secondPath}:${duplicate.secondFile.start}`,
      `${duplicate.lines} duplicated lines with ${secondPath}:${duplicate.secondFile.start}`,
      "두 블록의 목적과 변경 주기를 확인한 뒤 같은 책임일 때만 통합한다.",
    );
    duplicateFinding.id = stableId([
      sensor,
      "duplicate-block",
      firstPath,
      secondPath,
      excerpt(
        duplicate.firstFile.name,
        duplicate.firstFile.start,
        duplicate.firstFile.end,
      ),
    ]);
    return duplicateFinding;
  });

  return {
    tool_version: "5.0.14",
    metrics: [
      { name: "clones", value: total.clones ?? findings.length },
      { name: "duplicated_lines", value: total.duplicatedLines ?? 0 },
      { name: "duplication_percentage", value: total.percentage ?? 0 },
      { name: "total_findings", value: findings.length },
    ],
    findings,
  };
}

export function normalizeReactDoctor(report, root) {
  const findings = (report.diagnostics ?? []).map((diagnostic) => {
    const path = diagnostic.id?.split("::", 1)[0] ?? diagnostic.filePath;
    return {
      id: stableId([
        "react-doctor",
        diagnostic.rule,
        path,
        excerpt(join(root, path), diagnostic.line, diagnostic.endLine),
      ]),
      rule: diagnostic.rule,
      severity: diagnostic.severity,
      path,
      line: diagnostic.line ?? null,
      message: diagnostic.message,
      guidance: diagnostic.help,
    };
  });
  const errors = findings.filter((item) => item.severity === "error").length;

  return {
    tool_version: report.version ?? "0.9.11",
    metrics: [
      { name: "errors", value: errors },
      { name: "warnings", value: findings.length - errors },
      { name: "total_findings", value: findings.length },
    ],
    findings,
    partial: Boolean(report.error),
  };
}

export function normalizeVulture(output) {
  const pattern = /^(.*?):(\d+): unused (.+?) '([^']+)' \((\d+)% confidence\)$/;
  const findings = [];
  const parserErrors = [];

  for (const line of output.split("\n").filter(Boolean)) {
    const match = line.match(pattern);
    if (!match) {
      parserErrors.push(`unparsed: ${line}`);
      continue;
    }
    const [, path, lineNumber, kind, name, confidence] = match;
    const itemFinding = finding(
      "vulture",
      kind.replaceAll(" ", "-"),
      path,
      Number(lineNumber),
      name,
      `${name}: unused ${kind} (${confidence}% confidence)`,
      "프레임워크 등록·리플렉션·공개 API 참조를 확인한 뒤 실제 미사용일 때만 삭제한다.",
    );
    itemFinding.id = stableId(["vulture", itemFinding.rule, path, name]);
    findings.push(itemFinding);
  }

  return {
    tool_version: "2.16",
    metrics: [{ name: "total_findings", value: findings.length }],
    findings,
    parserErrors,
  };
}

export function normalizeDiagnostics(report) {
  return {
    tool_version: report.version ?? "1",
    metrics: [
      { name: "total_findings", value: report.diagnostics?.length ?? 0 },
    ],
    findings: report.diagnostics ?? [],
  };
}

export function normalizeDependencyCruiser(report) {
  const findings = (report.summary?.violations ?? []).map((violation) =>
    finding(
      "dependency-cruiser",
      violation.rule?.name ?? "architecture",
      violation.from,
      null,
      violation.to,
      `${violation.from} must not depend on ${violation.to}`,
      violation.rule?.comment ??
        "ARCHITECTURE.md §4.2의 허용 간선에 맞게 의존 방향을 수정한다.",
      violation.rule?.severity ?? "error",
    ),
  );
  return {
    tool_version: report.summary?.environment?.version ?? "18.2.0",
    metrics: [{ name: "total_findings", value: findings.length }],
    findings,
  };
}

export function normalizeImportLinter(output) {
  const findings = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(.+?) BROKEN$/);
    if (!match) continue;
    findings.push(
      finding(
        "import-linter",
        "broken-contract",
        ".importlinter",
        null,
        match[1],
        match[1],
        "출력에 표시된 import chain을 제거하고 ARCHITECTURE.md §4.2의 하위 계층으로 의존하게 한다.",
        "error",
      ),
    );
  }
  return {
    tool_version: "2.13",
    metrics: [{ name: "total_findings", value: findings.length }],
    findings,
  };
}
