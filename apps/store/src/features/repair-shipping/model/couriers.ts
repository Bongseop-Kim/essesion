/** 택배사 코드 — YeongSeon 데이터와 동일한 코드 세트 유지 (이관 주문의 courier_company 표시 호환).
 *  코드는 백엔드 검증 규칙 `^[a-z0-9_-]{1,30}$`을 따른다. */
export const COURIER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "cj", label: "CJ대한통운" },
  { value: "hanjin", label: "한진택배" },
  { value: "lotte", label: "롯데택배" },
  { value: "logen", label: "로젠택배" },
  { value: "epost", label: "우체국택배" },
  { value: "cupost", label: "CU 편의점택배" },
  { value: "cvsnet", label: "GS Postbox" },
  { value: "kyungdong", label: "경동택배" },
  { value: "daesin", label: "대신택배" },
  { value: "ilyang", label: "일양로지스" },
  { value: "chunil", label: "천일택배" },
  { value: "hapdong", label: "합동택배" },
  { value: "slx", label: "SLX택배" },
  { value: "etc", label: "기타" },
];

/** 미등록 코드는 코드 그대로 반환 (이관 데이터 등 방어) */
export function courierLabel(code: string | null | undefined): string {
  if (!code) return "";
  return COURIER_OPTIONS.find((option) => option.value === code)?.label ?? code;
}
