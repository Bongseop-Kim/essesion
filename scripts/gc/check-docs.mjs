#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
const diagnostics = [];

function add(_rule, path, line, _target, message, _guidance) {
  diagnostics.push(`${path}:${line}: ${message}`);
}

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(path);
    return extname(entry.name) === ".md" ? [path] : [];
  });
}

const files = [
  join(root, "AGENTS.md"),
  join(root, "ARCHITECTURE.md"),
  ...markdownFiles(join(root, "docs")),
];
for (const file of files) {
  const relativeFile = relative(root, file);
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(markdownLink)) {
      const rawTarget = match[1]
        .trim()
        .replace(/^<|>$/g, "")
        .split(/\s+["']/)[0];
      if (
        !rawTarget ||
        rawTarget.startsWith("#") ||
        /^[a-z][a-z+.-]*:/i.test(rawTarget)
      )
        continue;
      const withoutFragment = rawTarget.split("#", 1)[0];
      let decoded;
      try {
        decoded = decodeURIComponent(withoutFragment);
      } catch {
        add(
          "invalid-link-encoding",
          relativeFile,
          index + 1,
          rawTarget,
          `링크를 디코딩할 수 없음: ${rawTarget}`,
          "URL 인코딩을 고치고 저장소 상대 경로를 사용한다.",
        );
        continue;
      }
      const target = resolve(dirname(file), decoded);
      if (!existsSync(target)) {
        add(
          "missing-local-link",
          relativeFile,
          index + 1,
          rawTarget,
          `존재하지 않는 로컬 링크: ${rawTarget}`,
          "대상 문서를 만들거나 현재 위치에서 올바른 상대 경로로 수정한다.",
        );
      }
    }
  }
}

for (const agentsFile of [
  join(root, "AGENTS.md"),
  join(root, "apps/admin/AGENTS.md"),
  join(root, "apps/store/AGENTS.md"),
  join(root, "packages/shared/AGENTS.md"),
]) {
  const count = readFileSync(agentsFile, "utf8").split("\n").length;
  if (count > 300) {
    add(
      "context-size",
      relative(root, agentsFile),
      1,
      String(count),
      `컨텍스트 파일이 300줄을 초과함: ${count}줄`,
      "발견 가능한 세부 내용을 정본 문서로 옮기고 이 파일에는 링크와 지뢰만 남긴다.",
    );
  }
}

for (const pointer of [
  "CLAUDE.md",
  "apps/admin/CLAUDE.md",
  "apps/store/CLAUDE.md",
  "packages/shared/CLAUDE.md",
]) {
  const file = join(root, pointer);
  for (const [index, line] of readFileSync(file, "utf8")
    .split("\n")
    .entries()) {
    if (!line.startsWith("@")) continue;
    const target = resolve(dirname(file), line.slice(1));
    if (!existsSync(target) || !statSync(target).isFile()) {
      add(
        "broken-context-pointer",
        pointer,
        index + 1,
        line,
        `존재하지 않는 컨텍스트 포인터: ${line}`,
        "중복 컨텍스트를 만들지 말고 실제 AGENTS.md를 가리키도록 수정한다.",
      );
    }
  }
}

const completed = new Set(
  readdirSync(join(root, "docs/reviews"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.replace(/\.md$/, "")),
);
const plansDirectory = join(root, "docs/plans");
const plans = existsSync(plansDirectory) ? readdirSync(plansDirectory) : [];
for (const plan of plans.filter((name) => name.endsWith(".md"))) {
  const stem = plan.replace(/\.md$/, "");
  if (completed.has(stem)) {
    add(
      "completed-plan-not-removed",
      `docs/plans/${plan}`,
      1,
      stem,
      "같은 이름의 완료 리뷰가 있는데 미실행 플랜이 남아 있음",
      "완료 결과를 reviews에 보존하고 plans의 실행 문서는 제거한다.",
    );
  }
}

diagnostics.sort();
for (const diagnostic of diagnostics) console.error(diagnostic);
if (process.argv.includes("--check") && diagnostics.length > 0)
  process.exitCode = 1;
