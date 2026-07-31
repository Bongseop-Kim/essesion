# Recraft 모티프 생성 활성화·검증 (로컬)

실행일: 2026-07-30

상태: 완료

범위: `docs/plans/design-recraft-activation-test.md` R1~R4, 발견 회귀 수정 포함.
`RECRAFT_API_KEY`는 실행 전 `.env`에 이미 설정돼 있었고 worker도 키 설정 이후
기동 상태였다(`.env.example`의 `RECRAFT_API_KEY=` 항목도 이미 존재). Recraft
활성 확인은 R1 첫 실행으로 했다.

## 판정

| ID | 판정 | 확인 내용 |
|---|---|---|
| R1 | PASS | "잠수함 모티프를 격자로 배치한 네이비 패턴" → `recraft-c25f939dfc82`(subject 잠수함, 6슬롯) 신규 생성, 패턴에 격자 반영, 토큰 5 차감. 단 1차 실행은 아래 회귀 1로 실패했고 수정 후 성공. 배경 네이비가 검정에 가깝게 저작되는 기존 색상 의미 WARN 계열을 재관찰. |
| R2 | PASS | logo.png(흑백 로고)+모티프 형태: 모델이 로고를 "korean characters 'ㅇ','ㅅ'"로 인식, `recraft-62abf37bf066` 생성 후 나머지 플랜은 reference_catalog 재사용, 경고 0. 비활성 시절의 502는 재현되지 않음. 최초 실행들은 아래 회귀 2로 실패했고 수정 후 성공. 보조(컬러 일러스트): 대상을 "bee"로 인식 → 시드 카탈로그 벌 모티프 재사용(신규 생성 없음 — reference도 카탈로그 래더 우선이라는 설계 확인). 1회 재시도 필요(저작이 stripe bands 10>4 위반). |
| R3 | WARN | 한 요청에서 Recraft 2회(소화기 `recraft-d0bc98ec1df0` + 재봉틀 `recraft-a87f5dc27c43`) 성공 = 요청당 상한(2회) 경계 동작 검증. 상한 **소진**(초과분 레이어 drop) 경로는 UI로 도달 불가: 3종 소재 프롬프트는 "플랜당 모티프 최대 2종" 계약에 걸려 저작 단계에서 반복 거부됐고(2요청×4시도 전부), 요청 내 카탈로그 재사용 때문에 한 요청에서 3개 이상의 신규 생성이 사실상 발생하지 않는다. 소진 경로는 기존 단위 테스트 커버리지로 갈음. |
| R4 | PASS | 13회 실행(성공 4·실패 9): 차감 13건(-5)·환불 9건(+5)이 work_id로 정확히 짝을 이루고 순변동 -20 = 성공 4×5토큰, UI 잔액(600→580)과 일치. `/seamless-logs` 목록·상세가 전 실행을 정확히 분류(계획 저작 vs Intent 검증, 참고 이미지 vs 텍스트 프롬프트)하고 상세에 Recraft 신규 생성·카탈로그 재사용·토큰 정산·경고 묶음이 표시됨. Store·Admin 콘솔 오류/page error 0건. |

## 발견·수정한 회귀

Recraft 신규 생성 경로가 이번에 처음 실행되면서, 그 경로에서만 재현되는 회귀
2건을 발견해 수정했다.

1. **지명색 + 신규 생성 모티프 = 요청 전체 실패.** 7/29에 넣은 named-color
   보정이 slot_count를 알 수 없는(간주값 1) 생성 모티프 레이어에
   `color_indices` 1개를 주입하고, 해석 후 실제 슬롯 수(최대 6)와 불일치해
   `intent_invalid`(422)로 요청 전체가 죽었다. 모델이 자발적으로 혼색
   `color_indices`를 붙이는 경우(R3에서 2색 vs 3슬롯)도 동일했다.
   → 바인딩(`routes.py _bind_resolved_motif_colors`)의 길이 불일치 하드
   실패를 제거하고 기존 모듈로 순환 배정으로 적응. 카탈로그 모티프는 컴파일
   단계가 slot_count 메타데이터로 정확 일치를 이미 강제하므로, 바인딩에
   도달하는 불일치는 플랜 시점에 슬롯 수를 알 수 없던 생성/사진 모티프뿐이다.
   적응 시 diagnostics `color_binding_adapted`에 레이어를 기록한다.
2. **사진 모티프 형태에서 저작 고착.** 모델이 첨부 이미지를
   `{"source":"reference","reference_image_index":N}` 대신
   `source="input"`(+0-기반 인덱스)으로 반복 선언해 3요청×4시도 전부
   실패했다. 프롬프트가 올바른 필드명을 알려주지 않았고, 검증 피드백
   ("input_index ≥ 1")이 오히려 input 소스를 강화했다.
   → 프롬프트의 purpose=motif 역할 지시문과 전용 문단에 선언 JSON 템플릿을
   명시하고, 컴파일 피드백("unknown exact motif input")을 reference 선언
   교정 지시로 교체. 수정 후 동일 요청 성공(저작 3시도).

수정 파일: `apps/worker/src/worker/api/routes.py`,
`apps/worker/src/worker/authoring/compiler.py`,
`apps/worker/src/worker/adapters/gemini.py`, `apps/worker/tests/test_api_generate.py`
(불일치 거부 테스트를 순환/브로드캐스트 적응 테스트로 교체, 422 API 테스트는
단위 커버리지로 대체·제거).

## 개선 관찰 (플랜 §4 + 신규)

- **세션당 Recraft 예산 미적용(플랜 §4 확인).** `design_recraft_budget`
  (`recraft_used`)은 미사용 엔드포인트(`/motifs/generate`)에만 걸려 있고 메인
  경로는 요청당 2회 상한뿐. 세션/사용자 누적 상한 정책 결정 필요.
- **미사용 엔드포인트 정리 후보(플랜 §4 확인).** `POST
  /design/sessions/{id}/motifs/candidates`·`/motifs/generate`는 프론트 어디서도
  호출하지 않는다.
- **실패 문구.** 저작 실패는 "디자인 구성을 만들지 못했어요"+재시도 버튼으로
  적절하나, intent 단계 실패는 프롬프트 실행인데 "선택한 디자인을 처리할 수
  없어요"로 표기돼 문구가 상황과 어긋난다(재시도 버튼도 없음). Recraft 자체
  실패(502)는 이번 검증에서 발생하지 않아 문구 미관찰.
- **3종 이상 소재 프롬프트가 일반 오류로 뭉개짐.** "플랜당 모티프 최대 2종"
  제약을 모델이 조율하지 못하고(소재를 빼는 대신 3개 선언 고수) 사용자에게는
  구체성 안내만 나간다. 소재 수 초과를 사용자 문구로 안내할지 검토.
- **저작 안정성.** flash-lite가 계약 위반(stripe bands 10>4, 모티프 3종)을
  피드백 후에도 반복하는 사례가 잦아 컬러 일러스트·복수 소재 요청은 재시도
  1회가 필요했다. 저작 실패는 전액 환불되므로 회계 영향은 없음.
- **다색 모티프의 배경 대비.** 로고 모티프(흑+백+회 5슬롯)가 검정 바탕에서
  검정 부위가 묻혀 조각처럼 보인다. 원색 유지 경로에 바탕 대비 고려가 없다.
- **reference 모티프는 벡터화가 아니라 재생성.** 사진 픽셀이 Recraft로 가지
  않고 Gemini 설명(subject/style/description)으로만 전달된다. 로고 재현은
  ㅇ·ㅅ 자모를 반영한 재해석 수준 — 정확 재현이 요구라면 별도 벡터화 경로가
  필요하다.

## 자동 검사

- `uv run pytest`: 1,194 passed (기존 Starlette deprecation warning 1건)
- `uv run ruff check .`·`uv run ruff format --check`·`uv run pyright`: 통과
- JS 변경 없음 (worker Python만 수정)

후속: `docs/plans/design-input-modality-e2e.md` 진행 가능 (선행 조건 충족).
