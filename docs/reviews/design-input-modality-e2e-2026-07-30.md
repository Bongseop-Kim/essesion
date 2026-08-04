# 디자인 입력 모달리티 전수 E2E (로컬)

실행일: 2026-07-30

상태: 완료

범위: `docs/plans/design-input-modality-e2e.md` S0~S10 전수. 발견 결함 중 저작
계약 관련 수정 반영 포함. 브라우저 확인은 Aside(MCP repl), store :3000 /
api :8000 / worker :8001 / Postgres 로컬 기동 상태.

전제 이탈 1건: 플랜은 뷰포트 1440×900을 요구했으나 실행 중 Aside 브라우저 창이
**2280×1241**로 변경돼 사용자 승인 후 그대로 진행했다. lg(1280) 이상이므로 좌측
미리보기 패널·액션 배치는 플랜 전제와 동일하다(타일 앵커 메뉴 경로는 미검증).

당시 finalize inline 구성은 `.env` 열람 금지 규칙상 직접 확인하지 않고 S9-1의
실동작으로 확인했다(제출 후 폴링 1회 이내 succeeded → 인라인 실행 확정).

## 판정

| ID | 판정 | 확인 내용 |
|---|---|---|
| S0 | PASS | "네이비 바탕에 작은 도트 패턴" 후보1, 20s(오소링 4.9s + 모티프 해석 25.0s + 렌더 62ms). 화면의 네이비 바탕·흰 소형 모티프 격자가 plan `ground #000080`/`color_1 #FFFFFF`/lattice 10×10/size_ratio 0.05와 일치. 토큰 5 차감. |
| S1-1 자동 판단 | FAIL → 수정 후 PASS | 최초 실행은 4회 재시도 전부 `authoring_invalid`. 아래 결함 1·2·3의 복합. 수정 후 15s·시도 2회·Recraft 0회로 성공하고, 참고 사진(네이비 그레나딘+붉은 점선 사선+금색 벌)의 색(`#003366`/`#CC0000`/`#FFD700`)·모티프(`bee`)·구도(diagonal_up 스트라이프에 호스팅된 벌 path)를 모두 반영. |
| S1-2 색감·분위기 | WARN | 팔레트는 정확(`#006400`/`#C0C0C0`/`#000080`/`#FFFF00` = 사진의 녹색·실버·네이비·금색). 그러나 역할 격리 실패 — 사용자가 요청한 "작은 마름모"가 사라지고 사진 속 테니스 크레스트가 모티프로, 사진의 사선 구도까지 그대로 복제됐다. |
| S1-3 모티프 형태 | PASS | logo.png → 모델이 "Korean characters 'ㅇ','ㅅ'"로 인식, `source=reference`/`reference_image_index=1` 정상 선언, `reference_catalog`로 7/30 R2가 만든 `recraft-62abf37bf066` 재사용(Recraft 0회). 결과가 원본의 ㅇㅅ/ㅅㅇ 2×2 배치를 정확히 재현. |
| S1-4 배치·구도 | PASS | "버건디 바탕에 흰 별 모티프"의 색·모티프는 프롬프트대로(사진 색 미유입 = 역할 준수), 구도는 저작 단계에서 반영됨 — 직접 호출 3표본 8플랜 전부 `diagonal_down` 스트라이프, 일부 `drop=half_row`. 단 앱에서 노출된 후보는 스트라이프가 없는 플랜 0이었다(아래 관찰 A). |
| S1-E 엣지 | PASS | 6장 첨부 → 5장만 수용 + "참고 사진은 최대 5장까지 첨부할 수 있어요." / 17MB PNG → 거부 + "사진은 장당 10MB 이하로 선택해 주세요." |
| S2 SVG 모티프 | FAIL → 수정 후 PASS | Recraft 출력 SVG가 `preserveAspectRatio`→`style`→`version`→`<metadata>` 순으로 4연속 거부됐다(결함 4). 수정 후 임포트 성공, 확인 단계 없이 즉시 저장+선택("‘motif’ 모티프를 저장했어요."), 프롬프트 없이 생성 성공(`source=input`/`outcome=user_exact`), refine도 성공. 2MB 초과 → "SVG는 파일당 2MB 이하로 선택해 주세요." |
| S3 텍스트 모티프 | PASS / 품질 WARN | 나눔고딕↔나눔명조·보통↔굵게·자간 0→0.35em이 미리보기에 모두 반영(자간은 range, −0.2~1, step 0.05). 저장→선택→생성에서 `outcome=user_exact` 반영. 다만 저작이 두 모티프 레이어를 ±10° 회전·엇갈림으로 겹쳐 글자가 판독 불가(관찰 B). 엣지 3종(21자·이모지·한자)은 모두 저장 비활성+미리보기 없음으로 차단되나 **거부 사유 문구가 없다**. |
| S4 사진 모티프 | PASS / 결함 1건 | logo.png 6조합 미리보기 확인. `배경 제거/높게/1색`이 가장 유용한 실루엣, 기본값 `배경 제거/보통/4색`은 흰 글리프가 흰 미리보기 배경에서 안 보인다. **`배경 포함 + 1색`은 글자가 사라진 단색 사각형이 되는데 경고가 없다.** 배경 분리 신뢰도 100% 표시. 저장→생성 반영 확인. |
| S5 내 모티프 | FAIL → 수정 후 PASS | 2개 선택 후 3번째 비활성(2/2). **합산 회계 결함**: 모달 카운터·비활성이 `purpose=motif` 사진 슬롯을 세지 않아 1개 선택+사진1인데도 1/2로 보이고 추가 선택이 열린다. 그 조합으로 제출하면 `every motif reference photo must be represented exactly once`로 4회 재시도 후 실패(결함 5) — 수정 후 성공. 라이브러리 2개 동시 생성은 두 형상 모두 반영. 삭제는 확인 다이얼로그 → 목록·새 세션 모두 즉시 반영. |
| S6 색상 | 부분 FAIL | fixed 2색(`#000080`/`#F5F5DC`) → plan colors 정확 일치·두 색 모두 가시 PASS. 엣지 PASS(중복색 "서로 다른 색상을 2개 이상 5개 이하로 선택해 주세요.", 잘못된 HEX "HEX 색상을 #RRGGBB 또는 #RGB 형식으로 입력해 주세요."). **추출→생성 FAIL**: 추출은 무과금·5색이지만 원본의 붉은 점선·금색 벌이 탈락한 남/회 5색이고, 이 5색으로 생성하면 3요청 12회 시도 전부 `fixed palette colors must all be guaranteed visible`로 실패. **reroll FAIL**: 스트라이프 전용 디자인에서 5토큰을 차감하고 byte-identical SVG(md5 동일)를 반환. |
| S7 패턴 | PASS | 4축 단독·동시 모두 `pattern_constraints`에 기록되고 컴파일러가 결정론적으로 강제 — 크기 large→`size_mm 9.6`(tile 48×0.2), 밀도 dense→`cell 6.0`(48/8), 배열 staggered→`drop_fraction 0.5`, 방향 vertical→`fixed_rotation_deg 90`(대각선은 −45). 4축 동시 지정에서 경고 0·상충 없음. 방향은 저작 plan에 없고 컴파일러가 부여한다. |
| S8 통합·refine | 부분 FAIL | 후보4 + 모티프1 + fixed 3색 + 2축 + 프롬프트 → 4후보 전부 제약 준수(`distinct_layouts:4`, 전 후보 colorway = 지정 3색, drop 0.5, cell 8.0) PASS. **refine "모티프만 다른 것으로 바꿔줘"는 대체 소스가 없어 4회 재시도 후 항상 실패**. "간격 넓혀줘"는 성공했으나 **요청하지 않은 ground가 navy→cream으로 뒤바뀜**(7/29 §진단의 미해결 결함 재현). 다시만들기는 색·모티프 유지·배치만 변경 PASS. |
| S9 실사화·부가 | PASS / 관찰 다수 | 실사화 인라인 성공, 쿼터 10→9 차감, 결과 타일·내려받기·주문 제작하기 노출. 내려받기 `essesion-design.png` 성공·잔액 불변("PNG와 TIFF 내려받기는 토큰을 사용하지 않아요."). 아이디어 무과금·추가/바꾸기 정상이나 1차 실행이 미치환 플레이스홀더를 반환(관찰 C). 내 세션 30건 목록·열기·삭제(확인 다이얼로그) 정상. 완성본 1건 표시. 타일↔넥타이 전환 정상. 후보 클릭=즉시 선택은 최신 계약과 일치. |
| S9-2 실사화 취소 | 미검증 | 당시 inline 구성에서는 작업이 요청 내에 완료돼 "취소하고 횟수 되돌리기"가 노출되지 않았다. 이 구성으로는 도달 불가한 경로였다. |
| S10 비로그인·온보딩 | 부분 FAIL | 비로그인 `/design`은 접근 가능하고 빈 상태("첫 디자인을 만들어 보세요")+＋패널까지 열리며 잔액은 `—`. 액션 시도 → "로그인이 필요합니다 / 로그인 페이지로 이동할까요?" 정상. **로그인 성공 후 `/design`으로 복귀하지 않고 홈이 렌더된다**(URL은 한동안 `/design`으로 남아 화면과 불일치, 새로고침하면 `/`로 정정). 온보딩은 날염/선염 2스텝뿐으로 입력 기능을 하나도 안내하지 않는다. |
| 회계·콘솔 | PASS | Store 콘솔 오류·page error 0건(전 시나리오). 토큰 원장 완전 정합 — 아래. |

## 토큰 회계

시작 575 → 종료 455 (순감 120).

| 항목 | 값 |
|---|---|
| 기간 내 생성 로그 | 37건 (성공 24 · 실패 13) |
| 차감 | 185 (37 × 5) |
| 환불 | 65 (13 × 5) |
| 순감 | 120 = 성공 24 × 5 |
| 실사화 쿼터 | 10 → 9 (1회 사용, 토큰 무관) |
| 무과금 확인 | 대표 색상 추출(510→510), 아이디어 3회(455 유지), 내려받기(455 유지), 모티프 미리보기·저장 전량 |

실패 13건은 전부 `authoring_invalid`이고 전부 자동 환불됐다. 차감/환불이 work_id로
짝을 이루고 UI 잔액과 일치한다.

## 발견·수정한 결함

수정은 전부 `apps/worker`이고, 각 항목은 실측(직접 Gemini 호출 반복)으로 수정
전후를 비교했다. 프롬프트 문구만 추가한 뒤 효과가 없던 두 건은 되돌리고 별도
플랜으로 분리했다(§별도 플랜으로 분리).

### 1. `purpose=auto` 사진이 모티프 소스 계약을 통째로 지운다

`_build_prompt`에서 "No verified motif source is available…" 블록이
`purpose in {motif, auto}`면 스킵되고, 보완용 reference 선언 지침은
`purpose == "motif"`에만 붙었다. 결과적으로 **auto 사진 1장 요청의 프롬프트에
모티프 소스 지침이 0줄** 들어가 모델이 `source="input", input_index: 0`을
발명했다(스키마는 `ge=1`).

수정: 게이트를 `purpose == "motif"`로 좁히고, reference 선언 지침을
`purpose in {motif, auto}`로 넓혔다(auto는 선택적 표현).

### 2. 서빙 스키마가 버린 상한이 프롬프트에도 없다

`_UNSERVABLE_SCHEMA_KEYS`가 `maxItems`/`minimum`/`maximum` 등을 서빙 스키마에서
제거하므로 제약 디코딩이 막지 못하는데, 프롬프트에도 상한 문장이 없었다. 줄무늬
참고 사진에서 모델이 `bands`를 7~10개 만들어 `bands ≤ 4`를 매번 위반했고, 그것을
막으면 `stripe band coverage ≤ 0.75`와 `host_band_index requires host_stripe_index`가
차례로 드러났다.

수정: 개수 상한 1줄(2~8색·모티프 2·레이어 5·밴드 4·격자 16)과 validator-only 관계
규칙 1줄(밴드 폭 합 0.75·offset+width ≤ 1·색 중복 금지·host 쌍/방향 일치)을
추가하고, `_PLAN_FEEDBACK_HINTS`에 "at most 4 items" → period_ratio를 줄이라는
힌트를 넣었다. `AUTHORING_PROMPT_REVISION`을 `…-v5-count-limits`로 올렸다.

### 3. 근거 없는 모티프 소스 변형 고착은 프롬프트로 안 풀린다

1·2를 고친 뒤에도 사진이 붙으면 모델이 `source="input"` → (금지 문구 추가 후)
`source="catalog"` + 날조 `catalog_ref`로 고착을 옮겼다. compiler에 두 고착에 대한
교정 피드백 주석이 이미 있었을 만큼 알려진 문제였고, 금지 문구로는 4회 재시도가
전부 소진됐다.

수정: `_servable_json_schema(model, without=[...])`가 `$defs` 항목과 그것을 참조하는
union 브랜치를 제거하도록 하고, `author_designs`가 정확 입력이 없으면
`InputMotifSource`, 카탈로그 후보가 없으면 `CatalogMotifSource`를 withhold한다.
제약 디코딩이 애초에 그 변형을 만들 수 없게 하는 방식이다.

실측: 수정 전 `source="input"` 3/3 → 수정 후 유효 플랜 0/6 실패 없음, S1-1 UI 성공.

### 4. 모티프 임포트가 무해한 SVG boilerplate를 거부한다

`normalize_motif_svg`가 svg-safety 허용 목록으로 검증하는데, Recraft가 내보내는
SVG는 항상 `preserveAspectRatio`·`style="display: block;"`·`version`·`<metadata>`를
달고 나온다. 즉 **우리 자신의 출력물조차 모티프로 다시 들여올 수 없었다.** 사용자에게는
사유 없이 "이미지 워커가 요청을 거부했습니다"만 보였다.

수정: 허용 목록(보안 경계)을 넓히지 않고, 인테이크에서 렌더 무관 boilerplate만
떼어내는 `_drop_inert_wrappers`를 `_validate_tree` 앞에 넣었다. `<metadata>`·
`<title>`·`<desc>`와 `version`·`preserveAspectRatio`·`xml:space`를 제거하고,
`style`은 `url(`/`fill`/`stroke`/`color`/`display:none` 같은 페인트 토큰이 없을
때만 제거한다(있으면 종전대로 거부 — 조용히 색이 바뀌지 않게).

검증: 원본 SVG가 정리본과 **동일한 id**(`upload-7a895a90ade4`)로 임포트된다.

### 5. 정확 모티프 입력과 `purpose=motif` 사진이 함께 오면 항상 실패

`motif_ids`가 있을 때 exact-input 블록만 강하게 들어가고 사진의 선언 방법은 역할
한 줄에만 있었다. 모델이 사진을 통째로 빠뜨려
`every motif reference photo must be represented exactly once`로 매번 실패했다(3/3).

수정: exact-input 블록 뒤에 필요한 소스 집합 전체와 총 개수를 못박는 한 줄을
추가했다("Image 1 is also a motif source, so every plan's motifs array holds
exactly 2 entries…"). 실측 0/3 → **4/4** 개선, S5-2 UI 성공.

### 반영 검증

`uv run pytest apps/worker/tests/` 533 passed, `uv run ruff check apps/worker/`
통과, `uv run pyright apps/worker/src/worker/adapters/gemini.py` 0 errors.
회귀 테스트 3건 추가(`apps/worker/tests/test_adapters.py`:
auto 참고 사진의 소스 규칙 / 서빙 스키마 변형 withhold / 정확 입력+모티프 사진 조합,
`apps/worker/tests/test_api_motifs.py`: boilerplate 제거와 페인트 style 유지).

## 별도 플랜으로 분리

프롬프트 문구로 고쳐지지 않음을 실측으로 확인해 문구를 되돌리고 구조적 수정을
플랜으로 분리했다.

- `docs/plans/design-reference-role-isolation.md` — `purpose=color_mood`/`composition`
  역할 격리. 금지 문구를 넣어도 사진 속 형태가 모티프 subject로 새어 나온다
  (누출 4/4 vs 문구 없을 때 3/4 — 차이 없음, 오히려 형태를 프라이밍).
- `docs/plans/design-motif-lattice-overlap.md` — 격자 셀보다 큰 `size_ratio`로 인한
  모티프 겹침. 관계를 알려주는 프롬프트 규칙의 위반율 31%(n=13) vs 없을 때 38%(n=8)로
  유의차 없음.

## 개선 관찰

이번 브라우저 실행에서 실측한 항목과, 병행한 코드 감사(8축 · 파일:행 근거 · 반증
검증 통과분)에서 나온 항목을 합쳤다. 브라우저에서 직접 본 것은 **[실측]** 표시.

### 기능 결함

| # | 관찰 | 근거 |
|---|---|---|
| F1 | **[실측]** `purpose=color_mood`가 팔레트 외에 형태·구도까지 가져오고 사용자가 지정한 모티프를 지운다 | S1-2, 누출 4/4. 플랜 분리 |
| F2 | **[실측]** fixed 5색 + 참고 사진 = 가시성 계약 충족 0/4(사진 없으면 3/4, 3색+사진 2/4). 대표 색상 추출이 항상 5색을 채워 이 실패 경로로 유도한다 | S6-3, 12회 시도 전부 실패 |
| F3 | **[실측]** 스트라이프 전용 디자인의 다시만들기가 byte-identical SVG(md5 동일)를 5토큰에 판다 | S6-4 |
| F4 | **[실측]** refine에서 요청하지 않은 ground 색이 뒤바뀐다(navy→cream). `_ensure_requested_refine_changes`가 "colors가 뭐라도 바뀌었나"만 보는 7/29 진단의 미해결 구멍 | S8-2b |
| F5 | **[실측]** 라이브러리 모티프가 선택된 세션에서 "모티프를 바꿔줘" refine은 대체 소스가 제공되지 않아 항상 실패한다 | S8-2 |
| F6 | **[실측]** `배경 포함 + 1색` 사진 모티프가 단색 사각형으로 붕괴하는데 경고가 없다 | S4 |
| F7 | **[실측]** 로그인 후 `/design`으로 복귀하지 않고 홈이 렌더되며, URL과 화면이 한동안 불일치한다 | S10-2 |
| F8 | **[실측]** 배경 제거 안내가 영문 원문 그대로 노출된다 — "automatic separation is limited to flat border-connected backgrounds" | `apps/worker/src/worker/motifs/photo_svg.py:314` |
| F9 | **[실측]** 워커 거부 사유가 api에서 버려져 사진·SVG 실패가 "이미지 워커가 요청을 거부했습니다" 하나로 뭉개진다(결함 4의 진단을 어렵게 만든 원인) | `apps/api/src/api/integrations/worker.py:162-167` |
| F10 | **[실측]** 내 모티프 모달의 카운터·비활성이 `purpose=motif` 사진 슬롯을 세지 않는다 | `motif-library-modal.tsx:52,56-58,91,107` vs `router.py:1107` |
| F11 | 401 후 토큰 갱신은 되지만 POST는 재시도되지 않아(설계상 GET/HEAD만) 모티프 임포트·저장이 유실되고, 로그인 상태인데 "로그인이 필요합니다"가 뜬다 | `apps/store/src/shared/lib/api-client.ts:186-212`. 실행 중 2회 발생 |
| F12 | 비로그인 "사진 첨부"가 인증 확인보다 먼저 파일 선택창을 열어, 고른 파일이 버려진다 | `composer.tsx:446-451` |
| F13 | 온보딩을 X·바깥 클릭·ESC로 닫으면 완료가 저장되지 않아 진입마다 blocking 모달이 다시 뜬다 | `index.tsx:1412` vs `1413-1416` |
| F14 | 크기·밀도 축이 서로를 모르고 적용돼 9조합 중 5조합이 모티프 겹침을 만든다("크게+여유롭게"조차 13.44mm를 12mm 셀에) | `engine/constraints.py:21-24,180-183,231-245`. 플랜 분리 |
| F15 | `direction="horizontal"`은 모티프 전용 디자인에서 완전한 no-op(각도 0.0이 기본값과 동일, 사후 검증도 통과) | `engine/constraints.py:25,273-292,400-407` |
| F16 | 밀도만 지정해도 placement dict가 통째로 교체돼 저작이 부여한 `fixed_rotation_deg`가 소실된다(−8°→0°) | `engine/constraints.py:186-198,201-211,252-265` |
| F17 | export 실패 스낵바가 "토큰은 자동으로 환불돼요"라고 말한다 — 같은 다이얼로그의 "토큰을 사용하지 않아요"와 정면 모순 | `index.tsx:882-884` vs `export-dialog.tsx` |
| F18 | 텍스트 모티프의 "미리보기 안내" Callout은 응답에 warnings 필드가 없어 도달 불가한 죽은 UI | `worker/api/schemas.py:251-252` |
| F19 | 벡터화 진행 중 옵션을 바꾸면 로딩 표시가 사라지고 중복 요청이 가능해진다 | `photo-motif-modal.tsx:103-111,141-142` |
| F20 | 무과금 helper `/design/palette/extract`에 rate limit이 없다(`/design/ideas`에는 있다) | `router.py:636-658` vs `698-706` |
| F21 | 워커 503(미구성)/502(일시 장애) 구분이 api에서 단일 502로 접혀 항상 "일시적인 오류…"로 나간다 — §4의 "503 분기 실질 미작동"은 **확인** | `integrations/worker.py:162-169`, `errors.py:82-86` |
| F22 | 쿼터 소진 409의 대기 안내가 `max(1, …)`로 내림 방지되어 2분 남아도 "약 1시간 후"라고 말한다 | `domains/design/quota.py:107-109` |

### UX·기획

| # | 관찰 | 근거 |
|---|---|---|
| U1 | **[실측]** 후보 1개일 때 2~4 플랜을 전부 저작·모티프 해석하고 design 0의 1개만 노출한다. 입력을 더 잘 반영한 플랜이 버려질 수 있다(S1-4가 실제 사례) | `engine/candidates.py:288-300` round-robin, `diagnostics.plan_count:3` vs `candidate_count:1` |
| U2 | **[실측]** auto 팔레트 슬롯 채우기가 `#FF0000`/`#00FF00`/`#0000FF` 같은 순수 RGB를 넣고, 렌더 후보가 쓰지도 않는 그 색들이 CMYK gamut 경고 3~5건을 만든다 → "인쇄하면 색이 다르게 보일 수 있어요" 오탐 | S0·S7 로그 |
| U3 | **[실측]** 텍스트·사진 모티프가 겹쳐 형상이 뭉개진다(S3 ±10° 두 레이어, S4 size 0.3 > cell 0.25) | 플랜 분리 |
| U4 | **[실측]** 대표 색상 추출이 면적 기준이라 악센트 색이 탈락한다. 네이비 바탕+붉은 점선+금색 벌 사진에서 남/회 5색만 나왔다 | `photo_svg.py:108-135` population 내림차순 |
| U5 | **[실측]** 추출 색 개수를 고를 수 없어 항상 5색이 들어오고 사용자가 손으로 지워야 한다(그리고 5색은 F2의 실패 경로다) | `context-tools.ts:22-28` |
| U6 | **[실측]** 온보딩이 실제 사용법을 하나도 안내하지 않는다 — ＋ 패널 뒤 입력 12개 언급 0건, 대신 실사화 다이얼로그에서 다시 고르는 날염/선염 설명만 2스텝. **§4 "발견성 낮음, 온보딩이 커버하는지" → 커버하지 않음** | `onboarding-dialog.tsx:17-36` |
| U7 | **[실측]** 토큰 잔액·회당 비용이 ＋ 패널 안에만 있고 비로그인에는 `—`로 보여, 못 보는 것인지 0인지 구분되지 않는다. **§4 항목 확인** | `composer.tsx:518-523,540-542` |
| U8 | **[실측]** "자동 판단"이 실제로 무엇을 골랐는지 고객·관리자 어디에도 표시되지 않는다(로그의 `input_type`·`motifs[].source`로만 사후 확인). **§4 항목 확인** | `turn-feed.tsx:266-271` |
| U9 | **[실측]** 팔레트·패턴 설정이 생성 성공 시 auto로 리셋된다(`resetComposerDraft`). 의도된 턴 단위 설계지만 리셋 안내가 없어 같은 팔레트로 이어가려면 매번 다시 지정해야 한다 | `index.tsx:413-425` |
| U10 | **[실측]** 텍스트 모티프 20자·이모지·한자 거부가 저장 비활성으로만 표현되고 사유 문구·글자수 카운터가 없다 | `text-motif-modal.tsx:185-191` |
| U11 | **[실측]** 사진 모티프 미리보기 배경이 흰색 고정이라 흰색 모티프(기본 조합의 결과)가 보이지 않는다 | S4 |
| U12 | **[실측]** 세션 목록의 제목이 최신 프롬프트라서 같은 문구가 반복되면 구분이 안 되고, 실사화까지 끝낸 세션도 "작업 중"으로 표시된다 | S9-5, 30건 중 "잠수함 모티프 패턴" 6건 |
| U13 | **[실측]** 아이디어가 컴포저 초안만 문맥으로 쓰고 현재 정본 디자인은 보지 않는다. 설정이 턴마다 리셋되므로(U9) 이어가기에서는 사실상 무문맥이 된다 | S9-4, `_build_ideas_prompt` |
| U14 | **[실측]** 아이디어 1차 실행이 `바탕색 변경: [색상 이름]으로 변경`처럼 미치환 플레이스홀더 4건을 반환했다(2차는 정상 문장) | S9-4 |
| U15 | **[실측]** 비로그인 화면에 로그인 유도 신호가 없다 — 빈 상태 문구는 "첫 디자인을 만들어 보세요"뿐 | `turn-feed.tsx:111-121` |
| U16 | 사진 5장이 다 찬 뒤에도 "사진 첨부" 버튼이 활성이고 남은 슬롯 카운터가 없다. 개수 초과 문구가 전량 거부와 일부 절삭에 동일하고 몇 장이 빠졌는지 알려주지 않는다 | `composer.tsx:446-451`, `index.tsx:457-464` |
| U17 | 검증 실패 파일마다 스낵바가 큐에 쌓여 4초씩 순차 노출된다(10MB 초과 3장 → 12초) | `index.tsx:465-480`, `snackbar-store.ts:20` |
| U18 | 사진 첨부 실패 문구가 store 해요체 원칙을 벗어난 합니다체다("…업로드할 수 있습니다.") | `shared/lib/upload.ts:12` |
| U19 | 모티프 슬롯이 가득 차면 SVG·텍스트·사진 모티프 **저장 진입 자체**가 막힌다 — 라이브러리 저장은 이번 생성 슬롯과 무관하다 | `index.tsx:502-514` |
| U20 | 라이브러리에 검색·정렬·이름 변경이 없고 최신순 단일 스크롤뿐인데 상한이 100개다. 사용량(n/100)도 어디에도 없다 | `motif-library-modal.tsx:88-145` |
| U21 | fixed 팔레트로 한 번 생성하면 그 세션의 colorway 축이 영구히 `default` 1개로 붕괴한다 | `engine/constraints.py:161` → `router.py:1926-1957` |
| U22 | "방향" 라벨이 실제 동작과 다르다 — 격자·흩뿌림에서는 배치 흐름이 아니라 모티프 글리프 회전이고, path 배치에서는 경로 방향이 안 바뀐다 | `engine/constraints.py:273-292` |
| U23 | 쿼터를 다 쓰면 실사화 버튼이 비활성화돼, 정작 이유와 리셋 시각을 설명하는 Callout이 있는 다이얼로그를 열 수 없다 | `index.tsx:1464-1473` |
| U24 | export가 폭만 입력받는데 실제 출력은 폭×폭 정사각인 것을 알려주지 않는다. dpi×폭 상한 검증도 없어 600 DPI+200mm가 서버에서 실패한다 | `export-dialog.tsx:54-61,145-161` |
| U25 | 아이디어 모달은 열 때마다 provider를 호출하는데 "다른 아이디어 보기"가 없어 닫았다 여는 패턴을 유발한다 | `ideas-modal.tsx:65-75` |
| U26 | Recraft 요청당 상한 소진으로 모티프 레이어가 drop돼도 사용자에게 안내가 없다 | `motifs/resolver.py:641-643,744` |
| U27 | 같은 geometry를 다른 이름으로 다시 저장하면 기존 항목이 반환되는데 스낵바는 옛 이름으로 "저장했어요"라고 한다 | `router.py:751-762` |
| U28 | 이미 삭제된 모티프를 다시 삭제하면 404 → "삭제하지 못했습니다"로 표시된다(결과 상태는 목표대로 삭제됨) | `router.py:838-839` |

### 코드

| # | 관찰 | 근거 |
|---|---|---|
| C1 | **[실측]** 사진 첨부 `input[type=file][multiple]`에 aria-label이 없다. SVG는 "SVG 모티프 파일 선택", 사진 모티프는 "벡터화할 사진 선택"을 갖는다. **§4 항목 확인 — 한 줄 수정감** | `composer.tsx:527-535` |
| C2 | **[실측]** 사용자 SVG 정규화가 전면 배경 사각형을 제거하지 않아, 배경이 있는 로고 SVG가 사각 덩어리 모티프가 된다. Recraft 인테이크 게이트는 제거한다(`_find_backgrounds`) — 두 경로의 비대칭 | `motifs/normalize.py:324-403` vs `adapters/recraft.py:100-132` |
| C3 | `_contract_feedback`이 `lines[:6]`로 잘려, 힌트가 붙으면 뒤쪽 플랜의 실제 오류가 피드백에서 사라진다 | `adapters/gemini.py:_contract_feedback` |
| C4 | 미사용 엔드포인트 3건(`POST /design/sessions/{id}/branch`·`/motifs/candidates`·`/motifs/generate`) 프론트 호출자 0. **§4 항목 확인 — 제거 후보** | `router.py:1412,2746,2764` |
| C5 | 세션 Recraft 예산(`design_recraft_budget`=3 / `recraft_used`)이 미사용 엔드포인트에만 걸려 실사용 경로에서 항상 0 — 사실상 죽은 비용 통제 장치. **§4 항목 확인** | `config.py:86`, `router.py:2778-2785` |
| C6 | Playwright config가 project별 파일명 리터럴 `testMatch`로 고정돼 새 스펙이 조용히 실행되지 않고, webServer에 worker가 없어 디자인 경로 이관이 불가. **§4 항목 확인** | `playwright.config.ts:56,61`, `:20-52` |
| C7 | 워커 `/readyz` 503은 어떤 자동 경로도 소비하지 않는 죽은 신호(Cloud Run probe는 `/healthz`만) | `worker/main.py:61-72`, `infra/cloudrun.tf` |
| C8 | `assert_constraints_satisfied`의 4축 검증 전체가 `if tile > 0:` 블록 안에 갇혀 있어, `tile_mm`이 없거나 0이면 패턴 검증을 조용히 통째로 건너뛴다 | `engine/constraints.py:343-423` |
| C9 | 워커 warning 원문이 sanitize 없이 클라이언트·턴 payload까지 전달돼 내부 layer id가 노출된다 | `engine/candidates.py:257` |
| C10 | 상한값이 경계마다 하드코딩돼 있고 일치를 지키는 테스트가 없다 — 사진 5장/10MB(store·api·worker), SVG 2MB(4곳), 팔레트 2~5색(4곳) | `attachments.ts:13,15`, `upload.ts:2`, `router.py:69-72,237-252` |
| C11 | `/design/ideas`만 모티프 합산 상한 검증이 빠져 있다(api·worker 양쪽) | `router.py:349-367` vs `1106-1113` |
| C12 | 라이브러리 링크를 모두 지운 뒤 남는 `source='user_upload'` motifs 행이 어떤 정리 경로에도 걸리지 않는다(`prune_stale_seeds`는 `source='seed'`만) | `motifs/store.py:437-459` |
| C13 | 텍스트·사진 모티프 모달과 온보딩·비로그인 경로에 유닛 테스트가 없다. 기존 페이지 테스트는 온보딩 키를 세팅하고 다이얼로그를 mock해 항상 우회한다 | `index.test.tsx:205-207,263-270` |
| C14 | 자간 컨트롤이 raw `input[type=range]`로 디자인 시스템 밖에 있다 | `text-motif-modal.tsx:219-230` |
| C15 | 색상 행의 key가 `${index}-${colors.length}`라서 행 추가·삭제 시 전 행이 remount된다 | `color-settings-modal.tsx:203` |
| C16 | 인증 게이트가 호출부 13곳에 흩어져 있고 색상·패턴 설정·새로 만들기·충전은 누락돼 있다 | `index.tsx:384` 정의 vs 적용부 |
| C17 | 참고 방식 트리거의 클릭 타깃이 접근성 최소 24×24px 미만이다 | `composer.tsx:272-291` |

## 자동화 부채

이번 수동 검증에서 확보한 안정 셀렉터는 아래와 같다. Playwright 이관 시
§코드 C6(파일명 고정 `testMatch`, webServer에 worker 부재)을 먼저 풀어야 한다.

- 옵션 패널: `getByRole("button", {name:"옵션 더보기"})` → 사진 첨부·SVG 모티프·
  텍스트 모티프·사진 모티프·내 모티프·색상·패턴 설정·후보 N개·내 세션·내 완성본·
  새로 만들기·충전
- 파일 입력: 사진 `input[type=file][multiple]`, SVG `input[type=file][accept=".svg,image/svg+xml"]`,
  벡터화 `getByLabel("벡터화할 사진 선택")`
- 참고 방식: `getByRole("button", {name:/참고 방식/})` → `menuitemradio` 4종
- 패턴 4축 radio group name: 크기 `_r_7_`, 밀도 `_r_8_`, 배열 `_r_9_`, 방향 `_r_a_`
  (값 auto/small·sparse·lattice·vertical …)
- 생성 완료 대기: `li:has-text("디자인을 생성하고 있어요")`가 사라질 때까지
- 후보: `getByRole("button", {name:/^디자인 후보 \d+$/})`, 선택 상태는 `aria-pressed`

### Aside 하네스 주의점 (다음 실행자용)

- `page.setViewportSize`·`page.context()`·`page.waitForTimeout`이 없다. 대기는
  `setTimeout` 래퍼로, 뷰포트는 창 크기로만 제어된다.
- `page.on("request"/"response")`가 이벤트를 전달하지 않는다. 네트워크 확인은
  페이지 안에서 `window.fetch`를 감싸야 한다.
- `setInputFiles`가 `accept=".svg,…"` 입력에서 파일을 붙이지 않는다(파일 선택창
  경로도 동일). `DataTransfer`로 File을 만들어 `el.files`에 대입하고 `change`를
  디스패치해야 한다. 세션 디렉터리 밖 경로는 거부되므로 샘플을
  `~/.aside/u/0/sessions/<id>/`로 복사해 상대 경로로 넘긴다.
- 모달이 전부 마운트돼 있어 같은 이름의 버튼이 여러 개 잡힌다. `getBoundingClientRect().width > 0`로
  보이는 것을 골라야 한다.
- 스낵바는 `[role="status"]`에 4초만 존재한다. MutationObserver로 잡는 게 안전하다.

## 플랜 문서

`docs/plans/design-input-modality-e2e.md`는 실행 완료로 제거했다. 다음 두 건을
후속 플랜으로 남겼다.

- `docs/plans/design-reference-role-isolation.md`
- `docs/plans/design-motif-lattice-overlap.md` — 실행 완료,
  `docs/reviews/design-motif-lattice-overlap-2026-07-30.md`
