# worker 명세 3/3 — 래스터화·API 표면

§5부터는 아키텍처 통합에 따른 **결정사항**(ARCHITECTURE §1·§6) — 소유권 경계를 명시한다.

> 개정 2026-10-19: AI 디자인 제거로 finalize(결정론 원단 렌더 + AI 실사화)·weave 에셋·export·LLM 저작·
> 구성 patch·모티프 검색/생성·아이디어 계약을 지웠다. 절 번호는 코드 참조를 지키려고 그대로 둔다.

## 1. 래스터화

- 원본: 시스템 바이너리 서브프로세스 — `rsvg-convert` 우선, 없으면 `resvg`. stdin으로 UTF-8 SVG, stdout으로 PNG.
  - rsvg-convert: `-w {W} -h {H} -f png -` / resvg: `-w {W} -h {H} - -c`
- 픽셀: `mm_to_px = round(mm/25.4·dpi)`, `max(1, ...)`. **상한 20,000px**(초과 RasterError).
- 항상 Pillow로 재인코딩해 물리 DPI 스탬프: PNG `dpi=(dpi,dpi)`.
- **재구현 판정**: resvg 파이썬 바인딩은 형상·색은 같지만 경계 AA의 byte parity를 충족하지 못했다. 따라서 librsvg(`rsvg-convert`) 서브프로세스를 기준선으로 유지한다(ARCHITECTURE §8.1, `docs/reviews/resvg-parity.md`). renderer 버전 고정은 결정론을 위한 남은 운영 항목이다.

## 2~3. (삭제 — 2026-10-19 AI 디자인 제거)

## 4. API 표면 (소유권·인증 경계는 §5)

- `GET /healthz`, `GET /readyz`, `POST /generate`, `POST /motifs/photo-preview`, `POST /motifs/import`. 원본의 세션 라우트(LangGraph)·팔레트 프리셋·export는 승계하지 않는다 — 세션은 api 소유(design_sessions/turns)다.
- 미들웨어: X-Request-ID(정규화: 비허용문자→`-`, 128자 캡), 인증 없음, CORS 없음. 에러 body `{detail, request_id}`.

## 5. worker 소유권 계약

**공통**: 한 코드베이스(apps/worker), Cloud Run 서비스 하나(worker-generate). stateless — fingerprint 메모 외 프로세스-로컬 상태 없음(멱등이라 재계산 안전). obs(request_id·JSON 로깅·Sentry) 승계, api가 준 X-Request-ID 전파. 앱 인증 없음 → **경계 인증으로 대체**: api OIDC, Cloud Run IAM상 비공개.

api의 design intent·turn JSON은 compact UTF-8 1MB 이하이면서 NaN/Infinity 없는 JSON이어야 한다.

- `POST /generate` — 무세션 worker 계약. API가 부여한 필수 `run_id`와 필수 `intent`를 받는 **결정론 재렌더**다(템플릿 변형 또는 `motif_slot{slot,motif_id}` 모티프 위치 교체). 모델을 호출하지 않는다. `motif_slot`은 그 슬롯 레이어 전부의 `motif_id`만 결정적으로 바꾸고(슬롯 = 같은 모티프 레이어 묶음 — 레이어에 박힌 `slot`이 우선, 없으면 고유 `motif_id`가 처음 나오는 순서. 첫 교체가 모든 모티프 레이어에 `slot`을 박아 두어 두 슬롯에 같은 모티프를 넣어도 합쳐지지 않는다. api `current_motifs`·로고 자리도 같은 규칙, 빈 위치 2는 기존 모티프 레이어에서 같은 격자·반 칸 엇갈림으로 파생, 모티프가 0개면 6분할 기본 격자 한 장을 셀의 절반 크기(tile/12)로 만든다 — 종전 tile×0.18은 셀보다 커서 첫 로고가 벽처럼 붙었다, 2026-09-07 S5) concrete-color symbol로 재합성한다. `slot:"logo"`는 배치형(panel) 포인트 로고 자리다. 같은 입력은 byte-identical SVG다. 선택적 `session_id`·`user_id`는 로그 표식 전용이다 — worker가 `seamless_generation_logs`에 그대로 남겨 admin이 요청자·세션 턴과 상관한다. **응답은 원본과 달리 풍부하게**: 내부 서비스이므로 `design{id, layout_id, source_fidelity, colorway_id, seed, svg, png_object_key, panel_svg}` + `{generation_log_id, request_id, registry_version, engine_version, intent, warnings}` 반환 — api는 `generation_log_id == run_id`를 검증하고 공개 응답·assistant turn에는 `run_id`만 노출한다.
- `warnings`는 `[{code, message}]`다. 엔진의 영문 진단 문자열은 로그·`diagnostics`의 정본으로 남기고, `worker.warnings.WARNING_MESSAGES`에 한글 문구가 있는 코드만 응답에 담는다(코드별 1건). 매핑에 없는 경고는 고객에게 노출하지 않는다. 문구를 두는 기준은 **요청과 다른 결과가 나왔고 화면만 보고는 알 수 없는 것**(색역·모티프 드랍·엇갈림 밀도 조정)이며, 캔버스에서 보이는 자동 맞춤(크기 클램프·간격 스냅·줄 너비 축소·산개 개수 미달)과 고객이 손쓸 수 없는 실패(프리뷰 업로드)는 로그·admin `warning_groups`에만 남긴다.
- 사용자 수정 가능한 422는 `{detail:{code,stage,message}}` 고정 계약이다. code는 `constraint_conflict|intent_invalid|design_invalid`, stage는 각각 `constraints|intent|design`다. strict request에 계약 밖 필드가 오면 일반 422로 거부한다.
- 프리뷰 PNG는 GCS `previews/{request_id}/{design_id}/{sha256(png)[:16]}.png`에 create-only 업로드(`if_generation_match=0`)한다(공개 assets 버킷, best-effort — 실패 시 key null+경고). 같은 내용의 기존 객체로 인한 412는 멱등 성공이며 덮어쓰지 않는다. 호출자가 `X-Request-ID`를 재사용해도 다른 PNG는 다른 키가 된다.
- `POST /motifs/import` — 모든 user SVG를 공통 sanitize/normalize/content-hash 경계로 처리하되 worker DB에는 쓰지 않고 `{motif_id,symbol,bbox,anchor,preview_svg}`를 반환한다. API가 Motif+사용자 소유 링크를 하나의 transaction으로 저장한다. `POST /motifs/photo-preview`는 제한적 로컬 배경 분리+VTracer 결과를 concrete-color standalone SVG로 만들고 같은 import 경계로 넘긴다(worker-motifs.md §7.1). CPU 작업은 thread pool에서 실행한다.
- 모티프는 concrete-color symbol을 그대로 사용한다. intent는 모티프 색을 bind하거나 재색하지 않는다.
- seamless_generation_logs INSERT는 워커가 직접(원 동작 — system of record). `input_type`은 항상 `intent`이고, `diagnostics` JSONB에는 mode(`variation|motif_slot`), 단계별 시간(`compose_ms`·`render_ms`), 실패 code/stage를 저장한다. worker JSON 로그에는 내부 예외 원문을 넣지 않는다.

**DB 접근**: 워커는 motifs(R — 시드 스크립트만 W)·seamless_generation_logs(W). SQLAlchemy async + essesion-db 모델 재사용(ARCHITECTURE §2). 세션 테이블은 api 전용.

## 6. 결정론 회귀 테스트

결정론 계약은 두 층으로 지킨다.

1. **골든 대조** — `apps/worker/tests/golden/`(intent 25세트 + SVG 27개 + 참조 모티프 덤프)이 채점표다. `golden_helpers.py`가 로드하며 엔진 출력과 바이트 비교한다. **엔진 변경으로 골든이 깨지면 골든을 덮어쓰기 전에 의도한 변경인지 판정할 것** — 무단 재생성은 계약 파기다.
2. **런타임 동치** — 동일 입력 2회, PYTHONHASHSEED 0/1/12345 서브프로세스 교차 바이트 동일, colorway 변경 시 바이트 변경, repro 메타 전파, clone 순서 안정.

래스터라이저를 교체할 때는 골든 intent 세트를 양쪽으로 래스터해 픽셀 diff로 판정한다(완전 일치 우선, 불일치 시 librsvg 폴백).
