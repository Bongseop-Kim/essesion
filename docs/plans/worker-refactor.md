# worker 리팩토링 실행 계획

명세: [specs/worker-refactor.md](../specs/worker-refactor.md) (R1~R15) · 선행: 4단계 완료 상태(현행 main) · 관련: [phase4-worker.md](phase4-worker.md)

## 원칙

- **매 커밋 후 골든 27세트 byte-identical**(`test_gallery_goldens_byte_identical`) + `uv run pytest` + `pyright` + `ruff check` 통과. 골든이 깨지면 그 커밋은 잘못된 것 — SVG 출력 경로는 이 계획의 어떤 항목도 건드리지 않는다.
- 커밋 단위 = 아래 스텝 1개. 각 스텝은 독립적으로 리버트 가능해야 한다.
- api OpenAPI가 바뀌는 스텝(6·7)은 `pnpm codegen` 재생성물을 같은 커밋에.
- 순서는 의존성·리스크 기준: 보안·결함 가드(1~3) → 어댑터·resolver(4~5) → api 경계(6~7) → 구조 정리(8) → 테스트 이관(9) → 마무리(10).

## 실행 순서 (커밋 단위)

**1. config 검증 복원 — R2**
- `worker/config.py`에 pydantic `Field` 제약 복원(tau ge=0/le=1, aspect_ratio gt=1.0/allow_inf_nan=False, seam tol gt=0/non-finite 거부, 리소스 상한 ge=1).
- 원본 `test_config.py` 대응 테스트 포팅(`tests/test_config.py` 신설).
- 완료 기준: 경계값·nan/inf 거부 테스트 통과. 기존 기본값으로 임포트 가능(시크릿 없는 로컬 부팅 불변).

**2. sanitize 파서 하드닝 — R3**
- `defusedxml` 의존성 추가(핀), `render/sanitize.py`의 `ET.fromstring` → `defusedxml.ElementTree.fromstring`. 문자열 사전검사는 보조 방어로 유지.
- `register_namespace` 전역 부작용 → `root.set("xmlns", …)` 국소화(R12의 sanitize 몫을 여기서 함께 — 같은 파일 두 번 열지 않는다).
- 테스트: DOCTYPE/외부엔티티/billion-laughs 다중 페이로드 + 기존 test_sanitize 전체.
- 완료 기준: allowlist 동작 무변경(기존 테스트 그대로 통과), scrub 출력 바이트 불변 확인.

**3. resolver 가드 — R1 + R8**
- `motifs/resolver.py`: ① `text`/`source_image_index` spec 명시 거부(spec 단위 실패 + warning, 요청 전체는 지속). ② exact/τ 조회 예외를 miss로 흡수 + 경고 로깅(upsert 예외는 전파 유지).
- 테스트: 미지원 spec → Recraft 호출 0회·warning 포함 / 조회 예외 주입 → 생성 래더 폴백.
- 완료 기준: 기존 resolver 래더 테스트(exact→scope→τ→generate) 전부 불변 통과.

**4. 어댑터 클라이언트 수명 — R5**
- `adapters/gemini.py`: `httpx.AsyncClient`를 어댑터 생성 시 1개 보유, 재시도 루프에서 재사용, `aclose`에서 실제 close. Recraft·Embedding 동일 패턴 적용, `Adapters.aclose()` 실배선 확인(lifespan 종료 시 전 클라이언트 close).
- `complete(images=...)` 죽은 파라미터 제거(R11 몫 중 이 파일 것만 함께).
- 완료 기준: 백오프 계약 테스트(`slept==[0.5,1.0]` 핀 포함) 그대로 통과, aclose 후 closed 검증 테스트 추가.

**5. stripe 정규화 복원 + 임베딩 메모 — R9 + R15**
- 대각 스트라이프 결정론 후처리를 순수 함수로 재작성(원본 명세 기준 — 코드 복사 금지), `author_designs`의 validate 콜백 인접에 배선.
- resolver에 요청 스코프 임베딩 메모 dict(동일 descriptor 재호출 방지).
- 테스트: 대각 입력 → -45°·고정 반복수 정규화 / 동일 descriptor 2회 → 임베딩 1회.
- 완료 기준: intent-direct 경로(골든) 무영향 — 이 후처리는 LLM 저작 경로에만 닿는다.

**6. api 경계 견고화 — R7 + R10**
- api `WorkerClient`: status·detail 보존 예외로 전파. design 라우트에서 422→사용자 오류(환불+422), 5xx→일시 장애(환불+502) 분기.
- `DesignGenerateRequest.candidate_count: Field(ge=1, le=8)` 선검증.
- `pnpm codegen` 재생성 포함.
- 완료 기준: 422/502 분기 테스트(환불 여부·응답 코드), 경계 밖 count → api 422·워커 호출 0회. 인가 테스트는 실 Postgres(mock 금지).

**7. `/export` 배선 — R4**
- api export 라우트(소유자 인가, 과금 없음) + `WorkerClient.export` + codegen.
- 워커 측은 무변경(구현 존재) — 순차 프리뷰 루프 `_render_candidates`의 `asyncio.gather` 병렬화(R6)를 워커 몫으로 이 커밋에 포함(후보 순서 불변 assert).
- 완료 기준: api→worker export E2E(실 Postgres 인가 포함), 후보 순서 결정론 테스트, codegen 드리프트 0.

**8. 구조 정리 — R11 + R12(render) + R14**
- `render/weave.py` 추출: `_apply_weave`·`_tile_to`·`_weave_image` 이동, fabric·materials·inlay가 공용 import — 순환 import·private 월경 해소. fabric 픽셀 결정론(2회 바이트 동일) 테스트로 확인.
- 죽은 코드 삭제: `recraft.vectorize`+`_VECTORIZE_PATH`, `nearest_dpi` 중복(validate 인라인을 호출로 교체), registry 테스트 폴백 전역 분리 검토.
- docstring 정정(DryRun ≠ 503 비활성), `KNOWN_WEAVES` 상호 참조 주석.
- 완료 기준: grep 잔존 참조 0, 임포트 그래프 순환 0, 전체 스위트 통과.

**9. 테스트 이관 — R13**
- 래스터 seam 가드: `edge_seam`/`tiling_seam`을 `tests/` 유틸로 이관, 대표 골든 3~5세트에 렌더-후 이음새 회귀 테스트(rsvg 없는 환경은 skip 마커).
- normalize→motif_id parity: orphan 픽스처 `recraft_samples/` 3종 재정규화 → 원본 motif_id 일치 검증(원본 레포에서 기대 id를 추출해 상수로 커밋).
- geometry 경계 테스트 포팅(arc/bezier/reflected-control/transform), 엔진 엣지 케이스(snap_angle·snap_spacing·torus_dist·de-dup 타이브레이크) 포팅.
- 완료 기준: 신규 테스트 전부 통과. orphan이던 픽스처가 참조됨(motif_eval은 여전히 미사용이면 이 커밋에서 삭제).

**10. 검증·마무리**
- 전체: `uv run pytest`(PYTHONHASHSEED 0/1/12345 교차) + `pyright` + `ruff` + `pnpm turbo build typecheck test` + codegen 드리프트 0.
- 골든 27세트 최종 byte-identical 확인.
- [CHECKLIST.md](../CHECKLIST.md) §4 관련 항목 갱신, 이 문서에 결과 기록(스텝별 완료 표).

## 진행 기록

| 스텝 | 요구사항 | 상태 |
|---|---|---|
| 1 | R2 | ✅ 2026-07-07 — Field 제약 복원 + test_config.py 15건 (pyright는 positional default 미인식 → `default=` 키워드 사용) |
| 2 | R3 (+R12 sanitize) | ☐ |
| 3 | R1·R8 | ☐ |
| 4 | R5 | ☐ |
| 5 | R9·R15 | ☐ |
| 6 | R7·R10 | ☐ |
| 7 | R4·R6 | ☐ |
| 8 | R11·R12·R14 | ☐ |
| 9 | R13 | ☐ |
| 10 | 검증 | ☐ |
