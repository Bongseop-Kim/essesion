# 디자인 후보 타게팅 단순화 플랜

> 배경: `/design` 대화는 서버 편집 포인터(생성 성공 시 최신 런 첫 후보 자동 커밋, `apps/api/src/api/domains/design/router.py:1911`) 위에서 동작한다. 그런데 프론트가 그 위에 "타일 클릭=조회 스테이징(로컬), 커밋은 '이 이미지로 편집' 별도 액션"이라는 이중 상태를 얹어 두 가지 문제를 만들었다. ① 사용자가 "보는 것 ≠ 편집하는 것" 상태 모델을 학습해야 한다. ② 타일 앵커 메뉴에서 "이 이미지로 편집"은 탭한 후보에, "다시만들기"·"실사화하기"는 편집 대상(selection)에 동작해 앵커가 어긋난다(`apps/store/src/pages/design/index.tsx:1049` 주석이 이를 명시). 미드저니 V1~V4의 핵심(타깃을 액션에 내장)만 가져와 **타일 클릭=선택** 단일 상태로 합치고, 편집 대상 표시는 `[편집중]` 배지 대신 컴포저 칩으로 옮긴다. 이중 상태가 방어하던 "구경만 했는데 정본이 바뀜"의 피해는 낮다 — 다음 생성이 완료되면 서버 자동 커밋이 포인터를 최신으로 되돌린다. **서버 변경 없음.** V1~V4식 번호 배지·후보별 상주 버튼 줄은 도입하지 않는다(디스코드 제약의 산물, 타일 자체가 타깃).

## 1. 단일 상태 전환 — 타일 클릭 = 선택

대상: `apps/store/src/pages/design/index.tsx`, `apps/store/src/features/design/ui/turn-feed.tsx`

- 삭제: `viewedCandidate` 상태와 그 파생(`viewedImageSrc`, `previewImageSrc`의 viewed 분기), `viewCandidate` 핸들러, `selectFromViewed`, `DesignActions`의 `editBasis` prop·"이 이미지로 편집" 버튼, `candidateMenu`의 "이 이미지로 편집" 항목, 각 흐름의 `setViewedCandidate(null)` 정리 호출.
- `TurnFeed.onViewCandidate` → `onSelectCandidate`로 개명하고 `selectCandidate`를 직접 연결. 이미 선택된 후보 재클릭은 기존 가드대로 no-op(현재의 "재클릭 시 조회 해제" 토글은 함께 사라진다).
- `selectCandidate`의 낙관적 `selectionOverride`와 `selectionEpoch`은 **유지** — 클릭 즉시 링·미리보기가 반응하고 연타 경합을 처리하는 최소 장치다. 실패 시 롤백+스낵바도 유지.
- PC 좌측 미리보기는 selection 기준(`selectedImageSrc`)만 남는다. `resultPreview`(실사화 결과 스테이징)의 우선순위는 그대로.
- `TurnFeed`에 `candidateActionsDisabled={generateMutation.isPending}`을 배선한다. 지금은 조회가 로컬이라 생성 중 클릭이 무해했지만, 단일 상태에서는 클릭=서버 select이고 select는 생성 중 409(`generation_in_progress`)를 반환하므로 타일을 잠가 서버 계약과 맞춘다.
- `turn-feed.tsx:58`·`index.tsx:713` 등 이중 상태를 설명하던 주석을 새 의미(클릭=선택 커밋)로 재작성.

## 2. 컴포저 타깃 칩

대상: `apps/store/src/features/design/ui/composer.tsx`, `apps/store/src/features/design/ui/candidate-grid.tsx`

- 컴포저 입력창 위에 편집 대상 칩 1개: `selection?.candidate?.svg`가 있을 때 [작은 썸네일(24px) + "이 디자인에 이어서"]를 표시. 기존 attachments 행과 같은 자리·같은 프리미티브 패턴을 재사용하고 shared 사다리(①공통 컴포넌트 → ②프리미티브+토큰)를 따른다.
- 해제(✕) 액션은 두지 않는다 — 포인터는 항상 존재하며 비울 수 없고, 다음 생성이 자동 커밋으로 옮긴다. 칩은 순수 표시다.
- `candidate-grid.tsx`의 `[편집중]` Badge(Float 오버레이)를 제거하고 선택 링(`stroke.brand` 테두리 + `bg.brand-weak`)만 남긴다. 배지 주석의 전제("입력창 쪽 별도 표시가 없으므로")가 칩으로 해소된다.

## 3. 타일 메뉴 앵커 자연 교정 (미드저니 V에 해당)

대상: `apps/store/src/pages/design/index.tsx:1049` 부근

- 별도 구현 없음 — 1의 결과로 타일 탭이 곧 낙관적 select이므로, 같은 탭으로 열리는 앵커 메뉴의 "다시만들기"(select된 intent의 variation reroll)·"실사화하기"·"내려받기"가 자동으로 **탭한 후보** 기준이 된다. 어긋난 앵커가 코드 추가 없이 교정된다.
- 알려진 틈: `intent`는 select 응답으로 채워지므로 응답 전 수십~수백 ms 동안 메뉴의 다시만들기·실사화가 비활성이다. 상태 갱신 시 메뉴가 리렌더되어 풀리므로 허용한다. <!-- ponytail: select 응답 대기 중 잠깐 비활성, 체감 문제가 보고되면 selectCandidate promise를 액션이 await하는 방식으로 승격 -->
- 데스크톱은 패널의 "다시만들기" 버튼이 selection(=마지막 클릭 타일) 기준으로 동작하므로 추가 노출 없음. 후보별 hover 퀵 액션은 도입하지 않는다.

## 4. 테스트·문서 갱신

- 테스트: `use-selection.test.tsx`·`turn-feed.test.tsx`에서 조회 스테이징/"이 이미지로 편집" 케이스를 삭제하고 "클릭=선택 커밋(낙관적 표시→서버 확정, 실패 롤백)" 케이스로 치환. `selection.ts`(restore 로직)와 그 테스트는 변경 없음 — select 턴 기록 방식은 그대로다.
- `docs/plans/design-text-prompt-manual-test.md` 판정 원칙 재작성:
  - §1 "타일 클릭은 조회만 — 클릭으로 정본이 바뀌면 FAIL" → 정반대로: 클릭=정본 이동이 PASS.
  - `[편집중]` 배지 언급 전부 → 선택 링 + 컴포저 칩 기준으로.
  - §"과거 후보" 시나리오(300행 부근)의 "미리보기 → 이 이미지로 편집" 2단계 → 클릭 1단계로.
- 완료 후 이 문서를 `docs/plans/`에서 제거하고 결과를 `docs/reviews/`에 기록한다.

## 검증

- `pnpm turbo build typecheck test` + `pnpm lint` 통과.
- aside-browser 수동 확인: ① 생성 → 다른 후보 클릭 → 링·컴포저 칩이 즉시 이동, 좌측 미리보기 동기화 ② 후속 발화("간격 넓혀줘")가 클릭한 후보 기준으로 반영 ③ 과거 런 후보 클릭 → 대화 되감기 없이 포인터만 이동 ④ 생성 중 타일 비활성 ⑤ 모바일 뷰포트에서 타일 탭 → 메뉴의 다시만들기가 탭한 후보를 변형.
- 다음 생성 완료 시 칩·링이 최신 런 첫 후보로 자동 복귀하는지 확인(서버 자동 커밋 경로, 변경 없음).

## 상태 — 계획
