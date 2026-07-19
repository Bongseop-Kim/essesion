# 오버레이·피드백

겹쳐 뜨거나 끼어드는 UI 8종의 결정 체계. 생김새가 비슷하므로 **용도로 고른다** — 형태로 고르지 말 것. 값은 [design-token-reference.md](./design-token-reference.md), 모션은 [motion.md](./motion.md).

## 결정 트리 (위에서 첫 매치)

1. 사용자의 진행을 **멈추고 결정·확인**을 받아야 한다 → **AlertDialog**
2. 결과·상태를 방해 없이 알리고 **수 초 뒤 사라져도** 된다 → **Snackbar**
3. 현재 문맥 위에서 **임시 작업·콘텐츠**(폼·필터·상세) → **ResponsiveModal**
   (모바일 = BottomSheet, md 이상 = 중앙 Modal 자동 전환 — essesion 기본 패턴)
   — 그 내용이 "액션 목록"이고 **앵커(트리거 요소) 문맥이 없다**면 → **SwipeableMenuSheet**(모바일) / **Menu**(데스크톱)
4. **트리거 요소에 붙는** 짧은 보조 설명 → **HelpBubble**
5. **트리거·앵커 요소에 붙는** 소형 선택지/명령 목록 → **Menu** — 앵커 문맥이 중요하면(타일·행 단위 액션) **모바일 포함** 브레이크포인트 무관
6. 측면 맥락 유지가 중요한 **넓은 보조 작업**(admin 상세·설정) → **SidePanel** — 그 외 데스크톱 보조 작업은 Modal이 기본
7. 특정 섹션에 **상주하는 안내·경고** → **Callout**
8. **페이지 전체 범위**의 공지(페이지당 1개) → **PageBanner**

## AlertDialog vs SwipeableMenuSheet

| | AlertDialog | SwipeableMenuSheet |
|---|---|---|
| 목적 | 결정 승인·파괴적 행동 확인 | 여러 액션 중 선택 |
| 액션 수 | 1–2개(주/보조) | 2개 이상 목록 |
| 위치 | 화면 중앙 | 화면 하단 |
| 닫기 모델 | **명시적 전용** — 버튼·Esc만, 바깥 클릭 무시 | light-dismiss — 바깥 탭·스와이프·Esc |

파괴적 확인(삭제·이탈·초기화)은 AlertDialog + primary `criticalSolid`. 임의 콘텐츠를 넣고 싶다면 그건 AlertDialog가 아니다(BottomSheet/SidePanel 검토).

## Callout vs PageBanner

| | Callout | PageBanner |
|---|---|---|
| 위치 | 관련 콘텐츠 옆 인라인 | 페이지 최상단 |
| 너비 | 부모 콘텐츠 폭 | 화면 전체 폭 |
| 용도 | 해당 섹션에 관한 팁·안내·주의 | 페이지·시스템 수준 상태·공지 |
| 범위 | 섹션(로컬) | 페이지(글로벌) |
| 개수 | 여러 개 가능 | **페이지당 1개**, sticky는 앱 레벨 |

dismissible(X 버튼)은 **한 번만 전달해도 되는 정보에만** — 경고·오류에 금지, 닫은 뒤 재노출 금지.

## Snackbar를 쓰지 말아야 할 때

| 상황 | 대신 |
|---|---|
| 사용자의 응답·결정이 필요 | AlertDialog |
| 계속 보여야 하는 정보 | Callout |
| 페이지 수준 공지 | PageBanner |
| 긴 내용·여러 액션 | BottomSheet |

Snackbar는 방금 한 액션의 **낮은 심각도 결과**(저장됨·삭제됨·복사됨) 전용. 보조 액션은 최대 1개, 구체적 동사 라벨("되돌리기"). 화면당 1개 표시 + 큐, 기본 4초, hover/focus 시 일시정지.

## 닫힘 모델 4분류

HelpBubble은 기본 최대 너비를 두지 않는다. 호출부가 내용과 화면 여백을 고려해 `contentProps`로 적절한 `maxWidth`를 지정한다.

| 모델 | 컴포넌트 | 규칙 |
|---|---|---|
| 명시적 전용 | AlertDialog | 버튼·Esc만. 바깥 클릭 무시 — 실수로 결정을 건너뛰지 못하게 |
| light-dismiss | Modal · BottomSheet · SwipeableMenuSheet · SidePanel · Menu · HelpBubble | 바깥 탭 + Esc(+시트는 스와이프·드래그). 중요한 폼이 든 Modal/BottomSheet는 `showCloseButton` 권장 |
| 자동 소멸 | Snackbar | 4초 타이머, 상호작용 시 일시정지 |
| 인라인 상주 | Callout · PageBanner | 오버레이 아님. dismiss 버튼만(선택적) |

## 반응형 매핑

모바일 하단 시트 ↔ 데스크톱 대응 쌍:
- **임시 작업·콘텐츠 = BottomSheet ↔ Modal** — **`ResponsiveModal`이 md 기준 자동 전환**(열림 상태를 래퍼가 소유해 열려 있는 동안 브레이크포인트를 넘어도 유지). essesion 기본 패턴.
- **앵커 기준 액션 목록 = Menu** — 브레이크포인트 무관(모바일 포함). 타일·행처럼 "무엇에 대한 액션인지"가 앵커로 전달되는 경우.
- **앵커 없는 화면 수준 액션 목록 = SwipeableMenuSheet ↔ Menu** — 자동 스위치 없음, 호출부가 `useBreakpoint()`로 분기.
- SidePanel은 측면 맥락 유지가 중요한 admin 화면에서만 직접 사용.

## 중첩·top-layer 규칙

- top-layer는 연 순서대로 쌓인다. **모달 위 모달 금지**(최대 1겹 — 필요해 보이면 설계를 의심).
- Menu(popover)는 dialog 안에서 사용 가능.
- Snackbar는 표시할 때마다 재승격되지만, **모달이 열려 있는 동안은 inert**(표시만 되고 액션 클릭 불가) — 모달 흐름의 결과 안내는 모달을 닫은 뒤 띄울 것.

## 구현 계약 (모달 4종 공통 — internal/use-dialog.ts)

- 네이티브 `<dialog>` + `showModal()`: top-layer·포커스 트랩·배경 inert·포커스 복원·Esc를 브라우저가 제공. 포털·z-index 없음.
- 항상 마운트 + controlled 동기화. `onClose` 이벤트가 상태의 최종 진실.
- 등장 = `@starting-style`(`starting:` variant, 미지원 브라우저는 애니메이션만 생략). 퇴장 = `data-closing` 부여 후 지연 `close()` — 순수 CSS 퇴장(`overlay` 전환)은 Chromium 전용이라 쓰지 않는다.
- 딤 = `backdrop:bg-bg-overlay`. 배경 스크롤 잠금 = theme.css의 `html:has(dialog:modal)` 한 줄. 스크롤바 소멸 시프트는 `html { scrollbar-gutter: stable }`이 방지(JS 보상 없음).
- dialog 셸은 viewport 안에서 `overflow: hidden`, 긴 내용은 헤더·푸터 사이 콘텐츠 바디의 `overflow-y: auto`가 소유한다. dialog 자체를 스크롤 컨테이너로 만들지 않는다.
- **dialog/popover 요소에 display 클래스(flex 등) 금지** — UA의 닫힘 상태 `display:none`을 덮어쓴다. 레이아웃은 내부 래퍼로.
- 백드롭 클릭 닫기는 pointerdown과 click 둘 다 target이 dialog일 때만(드래그 릴리즈 오닫힘 방지).
