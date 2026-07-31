# 5단계 — 모티프 모달 통합

> 총괄: `00-overview.md`. 선행: 3단계(검색·생성·교체 API), 4단계(좌측 모티프 패널).
> 목표 화면: 목업 03(모티프 바꾸기) · 04(새로 만들기)

## 목표

흩어진 모티프 모달 4개를 **하나의 모달**로 합친다. 기본 경로는 목록이 아니라 **문장 입력 →
RAG 검색**이고, 유료 생성은 맨 아래 한 줄로 분리된다.

## 화면 — 모티프 바꾸기 (ResponsiveModal: PC 모달 / 모바일 BottomSheet)

```
모티프 바꾸기
어떤 그림을 넣을지 알려주세요.

[🔍 작은 벌                                    ]   ← 입력만. 찾기 버튼 없음(엔터로 검색)

비슷한 모티프  추가 비용 없음
[ 벌 ✓ ] [ 날개 편 벌 ] [ 작은 벌 ] [ 지금 쓰는 그림 ]

────────────────────────────────────────
[🖌] 원하는 모양이 없나요?            [5토큰] [새로 만들기]
     문장 그대로 새로 만들어요 · 2번 더 가능

[⤒ SVG 올리기] [📷 사진에서 따오기] [文 글자로 만들기] [🔖 내 모티프]

                                  취소   [이 그림으로 바꾸기]
```

- 검색 결과는 최대 4개, `preview_svg`를 그대로 그린다. 현재 쓰는 모티프도 한 칸으로 표시해
  "무엇을 바꾸는 중인지" 보이게 한다.
- 무료 경로(검색·SVG·사진·글자·내 모티프)가 먼저, 유료(AI 생성)가 아래. **순서가 비용 안내**다.
- 슬롯 대상은 좌측 패널에서 어떤 슬롯을 눌러 열었는지로 결정된다(슬롯 1 교체 / 슬롯 2 추가).
  모달 안에 슬롯 안내 문구를 두지 않는다(좌측 패널의 `n/2`가 이미 말한다).

## 화면 — 새로 만들기 (좁은 모달)

```
모티프 새로 만들기
[🖌 작은 벌                                    ]   ← 생성 프롬프트(검색어 프리필, 수정 가능)
                                  취소   [🖌 5토큰으로 만들기]
```

인용 블록·설명 문단·잔액 계산 줄은 두지 않는다. 가격은 버튼 라벨에 있다.
검색어를 그대로 쓰는 확인창이 아니라 **생성 프롬프트를 다시 쓸 수 있는 입력창**이다.

## 경로별 매핑

| UI | 호출 | 비용 |
|---|---|---|
| 문장 입력 + 엔터 | `POST /design/sessions/{id}/motifs/search` | 없음 |
| 결과 카드 선택 + `이 그림으로 바꾸기` | `POST /design/sessions/{id}/motifs/activate` | 없음(재렌더만) |
| SVG 올리기 | `POST /design/motifs`(기존 import) → activate | 없음 |
| 사진에서 따오기 | `POST /design/motifs/photo-preview` → 확정 시 import → activate | 없음 |
| 글자로 만들기 | `POST /design/motifs/text-preview` → import → activate | 없음 |
| 내 모티프 | `GET /design/motifs` → activate | 없음 |
| AI로 새로 만들기 | `POST /design/sessions/{id}/motifs/generate` → activate | 5토큰, 세션 예산 |

## 삭제

| 파일 | 대체 |
|---|---|
| `features/design/ui/motif-library-modal.tsx` | 모달의 `내 모티프` 탭 |
| `features/design/ui/photo-motif-modal.tsx` | `사진에서 따오기` |
| `features/design/ui/text-motif-modal.tsx` | `글자로 만들기` |
| `pages/design/index.tsx`의 숨은 SVG file input | `SVG 올리기` |

## 신규

- `features/design/ui/motif-modal.tsx` — 위 화면 전체
- `features/design/ui/motif-generate-modal.tsx` — 생성 프롬프트 + 유료 확인
- `features/design/model/use-motif-search.ts` — 검색·activate·generate 뮤테이션과 슬롯 상태

## 규칙

- 모달 위 모달 금지(`packages/shared/AGENTS.md` 오버레이 계약). 생성 확인은 모티프 모달을 **닫고**
  띄운다. 취소하면 모티프 모달을 다시 연다(검색어·결과 유지).
- SVG 업로드 실패·용량 초과·배경 있는 파일은 기존 import 에러 코드를 그대로 문구로 매핑한다.
  별도 사전 안내 문구는 두지 않는다(무료 경로라 재시도 비용이 없다).
- 생성 예산 소진(`recraft_budget_exhausted`)은 유료 행에 `이번 디자인에서 더 만들 수 없어요`로
  표시하고 버튼을 비활성한다.

## 검증

- 컴포넌트 테스트: 엔터로 검색 호출, 결과 0건 안내, 유료 행 비활성 조건, 생성 확인 후 activate
- 인가: 다른 사용자 세션 id로 호출 시 거부(서버 테스트에서 이미 고정 — 프론트는 낙관적 처리 금지)
- Aside 브라우저: 문장 검색 → 교체 → 이력에 새 스텝 1개, 잔액 불변. 생성 경로는 로컬에서
  Recraft 키가 없으면 예산·오류 표시까지만 확인
- 모바일 390: BottomSheet로 전환, 결과 그리드 3열

## 완료 판정

1. 모티프 관련 모달이 파일 기준 1(+생성 확인 1)개다
2. 모티프 목록을 통째로 노출하는 화면이 없다
3. 무료 경로에서 토큰 잔액이 변하지 않는다(테스트로 고정)
4. 생성은 확인 모달 없이 호출되지 않는다
