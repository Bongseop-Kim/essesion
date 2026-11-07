// 키→권장 넥타이 길이(매듭 포함) 환산. store 수선 안내표(150→41 ~ 190→57)도 이 함수로 그린다.
export function recommendedTieLengthCm(heightCm: number): number {
  return Math.round(0.4 * heightCm - 19);
}
