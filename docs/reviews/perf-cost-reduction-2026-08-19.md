# 성능·비용 절감 플랜 1차 실행 기록 (2026-08-19)

`docs/plans/perf-cost-reduction.md`의 1순위(1~5번)와 2순위 중 코드로 완결되는 항목
(8·9번), 6번의 tf 선언까지 실행했다. 6번 apply와 7번(Cloudflare 프록시 본체),
3·4순위는 플랜에 남겼다.

## 실행한 것

1. **`GET /products` limit 기본값 None → 20** — `products/router.py`. 타입도
   `int | None` → `int`로 정리(무제한 반환 경로 자체를 제거). OpenAPI 기본값 변경이라
   `pnpm codegen` 실행, `types.gen.ts`의 `limit?: number | null` → `number` 반영.
   점검 때 관찰된 "홈이 무파라미터 호출"은 현 코드에 없음 — store 호출부 3곳 모두
   이미 limit 명시(홈 4, 문의 모달 20, 샵 무한스크롤 PAGE_SIZE+1)라 프론트 수정 불필요.
2. **전역 `refetchOnWindowFocus: "always"` → `true`** — store `query-client.ts`,
   admin `app-providers.tsx`. store의 e2e-02 경로는 `FOCUS_REFETCH`(staleTime 0 +
   true)가 opt-in으로 유지. admin은 staleTime 30초라 탭 복귀 시 30초 지난 데이터만
   재요청되므로 별도 opt-in 불필요로 판단. 구 정책을 고정하던 가드 테스트 2건을
   새 정책(전역은 staleTime 존중 + opt-in 계약)으로 갱신, `FOCUS_REFETCH` export.
3. **admin seamless-list 폴링 게이팅** — seamless 로그는 종결 상태
   (success/partial/error)뿐이라 jobs-list의 queued/processing 게이트를 그대로 못 씀.
   "최신 로그가 5분 이내"를 활동 신호로 하는 `hasRecentSeamlessActivity` 게이트를
   list·stats 쿼리 양쪽에 적용(목록은 created_at desc라 첫 행이 최신).
4. **`signed_read_url` 프로세스 로컬 캐시** — `integrations/gcs.py`. 키=객체 키,
   TTL 600초(URL TTL 15분보다 짧게), 상한 2048건 도달 시 통삭제(content-hash 키라
   무한 성장 방지). 캐시 적중 시 IAM signBlob 네트워크 호출 생략.
5. **`address-select-modal`에 `enabled: open`** — 닫힌 모달(비로그인 포함)이
   `GET /addresses`를 쏘지 않는다.
6. **GCS 버킷 소프트 삭제 off 선언(tf만, apply 남음)** — `infra/main.tf` 두 버킷에
   `soft_delete_policy { retention_duration_seconds = 0 }`. 나이 기준 자동 삭제는
   넣지 않음 — 만료·클레임 정리는 도메인 규칙을 아는 cleanup-images 배치가 담당.
   `main.tf:28`의 "Cloudflare 프록시 경유" 주석 드리프트도 사실대로 수정(7번의 문서
   드리프트 하위 작업). `tofu validate` 통과 — **`tofu plan` 확인 후 apply는 사람이 실행**.
7. **worker 저작 LLM 호출 예산** — `adapters/llm.py`에 `LLMCallBudget`(이미지 경로
   `MotifGenerationBudget`과 같은 패턴) 도입. `author_design` 요청 1건당 유료 chat
   호출 상한 6회(정상 자기수정 4회는 통과, 최악 4×4=16회 차단) + 마감 170초(api
   `worker_timeout_seconds` 180초보다 짧게 — api가 끊은 뒤 과금 지속 방지).
   `_chat`의 HTTP 시도 단위로 차감, 소진 시 `authoring_budget_exhausted` /
   `authoring_deadline_exceeded` reason_code로 중단.
8. **주문 트랜잭션 내 원단 단가 중복 조회 제거** — `calculate_custom_amounts`가
   기본 키 + 원단 키를 `find_pricing_constants`(신규, 비검증 조회) 한 방으로 조회.
   원단 키 누락=invalid_options / 기본 키 누락=pricing_not_configured 구분은 유지.
   플랜 원안의 pricing TTL 캐시는 기각(플랜 "기각한 대안" 참조).

## 검증

- api: `test_products` `test_orders_create` `test_gcs`(캐시 테스트 신규 포함)
  `test_gcs_emulator` `test_quotes` 전부 통과, `ruff` `pyright` 클린.
- worker: `test_adapters.py` 82건 통과 — 예산 테스트 신규
  (`test_author_design_stops_paid_calls_at_the_request_budget`: 재시도 가능 실패
  연속 주입 시 정확히 6번째 호출에서 중단).
- JS: `pnpm lint`/`typecheck`/`test`(store 222·admin 235) /`build` 통과
  (build는 `VITE_API_BASE_URL` 더미로).
- 브라우저 실측(Aside, localhost): store 홈 비로그인 — `GET /addresses` 없음,
  `/products?sort=popular&limit=4`만 호출. 탭 포커스 시뮬레이션(visibilitychange+focus)
  후 재요청 0건(store·admin 모두, 수정 전 "always"는 전체 재요청). admin
  `/seamless-logs` 유휴 상태 40초 관찰 폴링 0건(수정 전 분당 4요청).
- `curl localhost:8000/products?limit=1 | jq length` = 1, OpenAPI `limit.default` = 20.
- `pnpm architecture:check` 통과.

## 되돌리는 법

- 서명 URL 캐시: `signed_read_url`의 캐시 분기만 제거하면 원상복구.
- focus 정책: 갱신 누락 리포트가 오면 해당 쿼리에 `FOCUS_REFETCH` 추가가 정답
  (전역값 원복 아님 — 플랜의 상향 신호 문단).
- LLM 예산: `_AUTHORING_CALL_LIMIT`/`_AUTHORING_DEADLINE_S` 상수 조정.
- 소프트 삭제(apply 후): retention을 604800(7일)으로 되돌려 apply.

## 남긴 과제

- 6번 apply: GCP 자격 증명으로 `cd infra && tofu plan` → 두 버킷의
  soft_delete_policy 변경만 뜨는지 확인 후 apply.
- 6번 하위: 만료 발생량이 100건/일(cleanup-images LIMIT)을 넘는지 운영에서 관찰.
- 7번 본체(Cloudflare Worker 캐시 프록시)와 3·4순위는 플랜 문서에 유지.
