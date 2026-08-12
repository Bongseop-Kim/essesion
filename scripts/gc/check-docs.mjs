#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const markdownLink = /!?\[[^\]]*\]\(([^)]+)\)/g;
const diagnostics = [];

function id(rule, path, _line, target) {
  return createHash("sha256")
    .update([rule, path, target].join("\0"))
    .digest("hex");
}

function add(rule, path, line, target, message, guidance) {
  diagnostics.push({
    id: id(rule, path, line, target),
    rule,
    path,
    line,
    message,
    guidance,
  });
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
for (const plan of readdirSync(join(root, "docs/plans")).filter((name) =>
  name.endsWith(".md"),
)) {
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

diagnostics.sort((left, right) => left.id.localeCompare(right.id));
process.stdout.write(`${JSON.stringify({ version: "1", diagnostics })}\n`);
if (process.argv.includes("--check") && diagnostics.length > 0)
  process.exitCode = 1;
