/**
 * 워커의 영문 운영 경고를 고객 안내 문구로 변환한다.
 *
 * 경고 원문은 디자인 턴 payload에 영구 저장되고(과거 턴 포함) 워커 내부 로직·테스트가
 * 원문 프리픽스에 의존하므로, 서버 계약을 바꾸지 않고 표시 시점에 매핑한다.
 * 원문 출처: apps/worker의 engine/candidates.py · engine/validate.py · api/routes.py
 */

type WarningRule = {
  pattern: RegExp;
  message: string | ((match: RegExpMatchArray) => string);
};

const WARNING_RULES: WarningRule[] = [
  {
    pattern: /failed to render and were dropped/,
    message: "일부 시안이 렌더링에 실패해 제외됐어요.",
  },
  {
    pattern: /^diversity shortfall:/,
    message: "비슷한 구성이 많아 서로 다른 시안을 충분히 만들지 못했어요.",
  },
  {
    pattern:
      /^partial: (\d+) candidate\(s\) available after de-dup \(requested (\d+)\)/,
    message: (match) =>
      `요청한 ${match[2]}개 중 ${match[1]}개의 시안만 생성됐어요.`,
  },
  {
    pattern: /^design \d+ dropped:/,
    message: "일부 디자인이 조건에 맞지 않아 제외됐어요.",
  },
  {
    pattern: /^canvas\.dpi .* clamped to/,
    message: "인쇄 해상도가 지원 값으로 자동 조정됐어요.",
  },
  {
    pattern: /normalized to/,
    message: "일부 패턴 배치가 자동 보정됐어요.",
  },
  {
    pattern: /likely outside CMYK gamut/,
    message: "일부 색상은 실제 인쇄에서 화면과 다르게 보일 수 있어요.",
  },
  {
    pattern: /spacing_mm .* snapped to/,
    message: "패턴 간격이 균일한 배치에 맞게 자동 조정됐어요.",
  },
  {
    pattern: /^preview upload skipped$/,
    message: "일부 미리보기 저장을 건너뛰었어요. 시안 확인에는 영향이 없어요.",
  },
];

const FALLBACK_MESSAGE = "일부 결과 생성에 제약이 있었어요.";

/** 영문 경고 목록 → 중복 제거된 한국어 안내 목록. 알 수 없는 경고는 일반 문구로 폴백. */
export function localizeDesignWarnings(
  warnings: readonly string[] | undefined,
): string[] {
  if (!warnings || warnings.length === 0) return [];
  const localized = warnings.map((warning) => {
    for (const { pattern, message } of WARNING_RULES) {
      const match = warning.match(pattern);
      if (match) {
        return typeof message === "function" ? message(match) : message;
      }
    }
    return FALLBACK_MESSAGE;
  });
  return [...new Set(localized)];
}
