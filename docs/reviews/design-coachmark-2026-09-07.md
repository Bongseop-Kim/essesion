# 디자인 페이지 코치마크 도입과 실사화 버튼 이동 — 2026-09-07

**첫 진입의 날염·선염 설명 모달을 화면 요소를 직접 비추는 8스텝 코치마크로 바꾸고, 실사화 버튼을 툴 레일에서 입력창(옛 "아이디어 받기" 자리)으로 옮겨 그라디언트 예외 색과 1회 점등 연출을 줬다.** 아이디어 받기 기능은 프론트에서 제거했다. 실행 전 계획은 `docs/plans/design-coachmark.md`였고 이 기록으로 이동했다. 커밋은 사람이 한다.

## 결정 (2026-09-07 논의)

- 코치마크는 store 로컬 컴포넌트(`apps/store/src/features/design/ui/coach-mark.tsx`). 타깃은 `data-coach="<key>"`, 위치는 `getBoundingClientRect`, 스포트라이트는 `bg.overlay` 토큰의 큰 `box-shadow`(`index.css` `.coach-spot`). 타깃이 없거나 숨겨진 스텝은 건너뛴다.
- 스텝 8개(정본 `features/design/model/coach-steps.ts`): 예시 갤러리 → 입력창 → 모티프 → 이력 → 미리보기 → 토큰 → 도구 → **실사화**. 마지막 스텝은 고객 관점의 핵심 가치(채팅·결정론 엔진으로 느낌을 먼저 잡고, 정해지면 한 번만 이미지 생성 — 화질·세밀 조절·비용)를 한 번 설명한다. README "사용자 경험" 절에도 같은 이유를 적었다.
- 저장 키 `design:onboarding:v1` → `design:coachmark:v1`(옛 키 이관 없음). 건너뛰기·완료·Esc·다른 오버레이 열림 모두 "봤음". 다시 보기는 툴 레일 "사용법" 항목(좌상단 Help 버튼 제거).
- 실사화 버튼: 입력창 전송 버튼 왼쪽, 별(`SparklesIcon`) 아이콘, PC는 라벨 포함. `ActionButton variant="ai"`(신설) — 디자인 시스템의 그라디언트 금지에 대한 두 번째 기능성 예외로, 토큰 `bg.ai-start/mid/end`(`#4338ca`→`#7c3aed` 55%→`#db2777`, 135deg)와 `.bg-ai-gradient` 유틸리티만 소비한다(`gradient.md`·`design-token-reference.md`·`packages/shared/AGENTS.md` 갱신). 비활성은 `neutralOutline`.
- 점등 연출은 **디자인이 없다가 생기는 순간**(첫 생성·예시 시작)에만 1회: 색이 차오르고 → 1.12배 pop(480ms) → 링 확산(640ms) → 하이라이트 sweep(720ms) → 별 반짝임(360ms). 이미 디자인이 있는 채로 열리거나 수정 중 잠깐 꺼졌다 켜질 때는 색만 돌아온다. `prefers-reduced-motion`이면 연출 없음.
- 상단 재배치: 좌상단 미리보기 토글, 우상단 토큰 잔액만. 모바일에서 토큰을 토글 아래로 내리던 absolute 래퍼 제거.
- 툴 레일은 기존 형태 유지, 실사화 빠지고 사용법 들어가 5개. 모바일 시트 격자는 4열→3열(마지막 하나가 혼자 남지 않게).
- 전송 버튼은 건드리지 않았다. 백엔드 `/design/ideas`는 명세 정본이라 남겼다(별도 제안 대상).

## 검증

- `pnpm exec biome check apps/store/src packages/shared` 통과, `node scripts/check-harness.mjs` OK. `pnpm lint` 전체는 이번 변경과 무관한 기존 문서 에셋 2건(`docs/reviews/assets/design-intent-2026-09-07/qa-logo.svg` a11y, 같은 폴더 `steps.json` 포맷)으로 실패한다 — 이 커밋 전부터 있던 상태.
- `pnpm --filter store typecheck` 통과. `pnpm --filter @essesion/shared test` 69건 통과. store 전체 vitest 259건 통과(코치마크 3건, 프롬프트 바 1건 신규; 첫 진입 테스트는 스텝 수 7을 단언 — 예시 0건·로그인 환경).
- 브라우저(Aside, `http://localhost:3000/design`, 1440×900, 로컬 고객 계정, 콘솔·페이지 오류 0건):
  - 키 삭제 후 새로고침 → 디자인이 있는 상태라 갤러리 스텝이 빠진 7스텝 "1 / 7"이 뜨고, 스포트라이트가 입력창·…·실사화 버튼을 순서대로 감쌈(스크린샷 확인). 완료 후 키 `"1"`, 새로고침 시 안 뜸, 레일 "사용법"으로 다시 뜨고 Esc로 닫히면 포커스가 "사용법"으로 돌아옴.
  - 새로 시작 → 실사화가 회색 테두리 비활성 → 예시 선택 → `data-ignite="true"`와 링·하이라이트가 관찰됨 → 1.1초 뒤 속성 해제, 그라디언트 유지. 실사화 클릭 시 기존 실사화 다이얼로그가 열림.
  - 모바일 viewport는 Aside REPL에서 크기 조절 API가 없어 브라우저로 보지 못했다. 모바일 배치(토큰 한 줄, + 시트 3열, 시트에 사용법·실사화 부재)는 jsdom 390px 렌더 테스트로만 확인했다 — 실기기 확인은 남은 일.
  - 수정 요청 후 재활성화 시 연출이 없는지는 유료 생성이 필요해 브라우저로 돌리지 않았다. 로직상 `hasDesign` 전환에만 걸려 있어 busy 토글로는 재생되지 않는다.

## 처음 구현에서 고친 것

- 점등 트리거를 처음엔 `canFinalize`(= hasDesign && !busy)의 마운트 후 첫 true로 잡았다가, 이미 디자인이 있는 채로 열면 로드 즉시 점등하고 "새로 시작 → 예시"에서는 점등하지 않는 문제를 브라우저에서 확인해 `hasDesign`의 false→true 전환으로 바꿨다.
- 논의 초반에 "코치마크에 실사화 스텝을 두지 않는다"로 갔다가 사용자 요청으로 마지막 스텝을 되살렸다(고객 관점 핵심 기능).

## 남은 일

- 모바일 실기기에서 코치마크 말풍선·+ 시트 3열·실사화 아이콘 버튼 확인.
- 백엔드 `/design/ideas` 제거 여부는 `docs/api-spec/` 갱신과 함께 별도 제안.
- 코치마크·점등 계측은 `docs/analytics.md` 규약과 함께 별도 플랜.
