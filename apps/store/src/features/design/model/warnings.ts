/**
 * 워커 경고 중 사용자가 실제로 대응할 수 있는 안내 하나만 고른다.
 *
 * 원문은 턴과 운영 로그에 그대로 남긴다. 자동 보정이나 내부 처리 경고는 화면에
 * 노출해도 다음 행동이 없으므로 고객 Callout으로 승격하지 않는다.
 */

export type DesignWarningNotice = {
  title: string;
  description: string;
};

const PARTIAL_CANDIDATES =
  /^partial: (\d+) candidate\(s\) available after de-dup \(requested (\d+)\)/;

export function getDesignWarningNotice(
  warnings: readonly string[] | undefined,
): DesignWarningNotice | null {
  if (!warnings || warnings.length === 0) return null;

  for (const warning of warnings) {
    const match = warning.match(PARTIAL_CANDIDATES);
    if (match) {
      return {
        title: `후보를 ${match[1]}개만 만들었어요`,
        description:
          "요청 조건으로는 서로 다른 시안을 충분히 만들기 어려웠어요. 조건을 조금 단순하게 하거나 후보 수를 줄여 다시 시도해 보세요.",
      };
    }
  }

  if (warnings.some((warning) => /likely outside CMYK gamut/.test(warning))) {
    return {
      title: "인쇄하면 색이 다르게 보일 수 있어요",
      description:
        "채도가 높은 색을 조금 낮추면 화면과 인쇄물의 차이를 줄일 수 있어요.",
    };
  }

  return null;
}
