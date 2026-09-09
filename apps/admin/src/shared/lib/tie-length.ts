// 키→권장 넥타이 길이 환산. store의 안내표
// (apps/store/src/features/reform/ui/reform-service-guide.tsx의 HEIGHT_GUIDE, 150→41 ~ 190→57)를
// 선형식(length = 0.4 * height - 19)으로 근사한 것 — 두 파일은 항상 같이 바꾼다.
export function recommendedTieLengthCm(heightCm: number): number {
  return Math.round(0.4 * heightCm - 19);
}
