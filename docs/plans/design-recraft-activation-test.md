# Recraft 모티프 생성 활성화·검증 플랜

> 지금까지의 디자인 E2E(7/29 텍스트 프롬프트 A~C 시리즈)는 카탈로그에 이미 있는
> 모티프만 사용해 Recraft 신규 생성 경로가 한 번도 검증되지 않았다. Recraft는
> 로컬에서 `RECRAFT_API_KEY` 미설정으로 비활성 상태였다. 이 플랜은 키를 설정해
> Recraft를 활성화하고, UI로 도달 가능한 두 신규 생성 경로(카탈로그 미스
> 프롬프트, 사진 참고 방식=모티프 형태)가 정상 동작하는지 확인한다.
> `design-input-modality-e2e.md`(전체 시나리오 테스트)의 **선행 조건**이다.

## 1. 코드 기준 기대 동작 (실행 전 숙지)

- Recraft 사용처는 두 곳뿐: `resolve_spec`(`apps/worker/src/worker/motifs/resolver.py:426`) → `generate_motif`(`apps/worker/src/worker/adapters/recraft.py:355`).
  - `/generate` 내부: 플랜의 `generate`/`reference` 모티프 소스가 카탈로그 래더(lexical exact-token → pgvector τ=0.84)를 miss했을 때.
  - 워커 `POST /motifs/generate`: **store·admin 어느 쪽도 호출하지 않는 미사용 엔드포인트**. 이번 검증은 UI 경로만 다룬다.
- 컴파일러 규칙: `generate` 소스는 **검증된 카탈로그 후보가 비어 있을 때만 허용**(`compiler.py` "generated motifs are allowed only when the verified catalog is empty"). 따라서 프롬프트로 Recraft를 유발하려면 카탈로그(시드 97종)에 없는 소재를 써야 한다.
- 사진 참고 방식=모티프 형태(`purpose="motif"`)는 **필수(required) 모티프 spec** — 실패 시 레이어 drop으로 구제되지 않고 요청 전체가 실패한다(비활성 상태에서 502였던 경로). 활성화 후엔 벡터화 성공이 기대값.
- 비용 상한: 요청당 `motif_generate_per_request_limit=2`(재프롬프트 포함 카운트, 소진은 soft 실패=레이어 drop). 세션당 예산 `design_recraft_budget=3`(`recraft_used`)은 미사용 엔드포인트에만 적용되므로 메인 경로에서는 **작동하지 않는다** — 관찰 항목 §4 참고.
- 생성된 모티프는 `motifs` 테이블에 `source='recraft'`로 저장되고, 색 슬롯 라벨링(`label_slots`, Gemini)이 뒤따른다.

## 2. 환경 준비

1. `.env`에 `RECRAFT_API_KEY=<키>` 추가 — 키는 사용자가 제공(시크릿이므로 파일 내용 확인·출력 금지). `.env.example`에 이 키가 누락돼 있으니 `RECRAFT_API_KEY=` 빈 항목을 추가해 두는 것을 이 플랜에서 함께 처리한다.
2. **worker 재시작 필수** — `--reload` 없이 떠 있고 설정이 `lru_cache`라 재시작 없이는 키가 반영되지 않는다. api·store는 재시작 불필요.
3. 서버 확인: store :3000, api :8000, worker :8001, db. Aside는 고객·관리자 모두 로그인된 상태.
4. 활성화 확인은 별도 헬스 엔드포인트가 없으므로 R1 첫 실행으로 행동 확인한다.
5. 토큰 잔액 확인. 부족하면 admin `http://localhost:3001/customers/5a771852-05c1-4f97-9ebe-73e4def6624b`에서 충전(`POST /admin/tokens/manage`).

## 3. 시나리오

공통 절차: 새 세션(새로 만들기) → 후보 수 1 → 실행 전후 토큰 잔액 기록 → 실행 후 `/seamless-logs`(admin)와 DB로 교차 확인. 콘솔 오류 0건 유지.

Recraft 호출 여부의 판정은 화면이 아니라 DB가 정본이다:

```bash
docker compose exec -T db psql -U essesion -d essesion \
  -c "select id, source, created_at from motifs where source='recraft' order by created_at desc limit 5"
```

### R1 — 카탈로그 미스 프롬프트로 신규 모티프 생성

1. 소재 선정: 시드 카탈로그(97종: 동물·꽃·별·체스·골프·배·자전거 등)에 없는 것. 후보 예시: 잠수함, 소화기, 재봉틀, 현미경. 사용 전 확인:
   ```bash
   docker compose exec -T db psql -U essesion -d essesion \
     -c "select id, array_to_string(tags,',') from motifs where tags && array['잠수함','submarine']"
   ```
   (0건이어야 함. 단 임베딩 τ=0.84 유사 매칭까지는 사전 보장 불가 — 실행 후 DB로 최종 판정.)
2. 프롬프트 예: "잠수함 모티프를 격자로 배치한 네이비 패턴".
3. 기대: 생성 성공, 결과 패턴에 해당 모티프 등장, `motifs`에 `source='recraft'` 신규 행, 토큰 5 차감.
4. 카탈로그를 우회하지 않고 기존 모티프로 대체됐다면(신규 행 없음) 소재를 바꿔 1회 재시도. 2회 연속 카탈로그로 흡수되면 WARN으로 기록하고 프롬프트·로그를 남긴다.

### R2 — 사진 참고 방식=모티프 형태 (벡터화 경로)

1. 새 세션에서 사진 첨부: `/Users/duegosystem/Desktop/logo.png` (흑백 고대비).
2. 첨부 칩 메뉴에서 참고 방식을 **모티프 형태**로 변경.
3. 프롬프트 예: "이 로고를 모티프로 반복 배치한 패턴".
4. 기대: 성공, 로고 형상이 모티프로 반영. 비활성 시절의 502/일반 오류가 재현되면 FAIL.
5. 보조: `/Users/duegosystem/Downloads/ChatGPT Image 2026년 6월 13일 오후 07_30_10.PNG`(컬러 일러스트)로 1회 반복 — 사진 유형에 따른 벡터화 품질 차이 관찰.

### R3 — 요청당 상한(soft 실패) 관찰 (선택)

1. 카탈로그에 없는 소재 **3종**을 한 프롬프트에 요구 (예: "잠수함, 소화기, 재봉틀을 함께 배치한 패턴").
2. 기대: Recraft 호출은 최대 2회, 초과분은 레이어 drop + 경고(부분 성공 `partial`). 전체 실패가 아니어야 한다.
3. `/seamless-logs`에서 경고 분류("Tier-1 gate exhausted" 계열)와 탈락 레이어 수 확인.

### R4 — 회계·로그 정합 (R1~R3 전반에서 수집)

- 실행별 토큰 차감 5·실패 시 환불, 순변동 기록.
- `/seamless-logs`에 성공·실패 전 실행이 기록되고 attempts·경고가 화면 설명과 일치.
- Store·Admin 콘솔 오류 0건.

## 4. 개선 관찰 항목 (테스트 중 확인해 기록)

- **세션당 Recraft 예산 미적용**: `recraft_used` 예산(3회)이 미사용 엔드포인트(`/motifs/generate`)에만 걸려 있어, 메인 프롬프트 경로는 요청당 2회 상한만 있고 세션 누적 상한이 없다. 비용 통제 관점에서 메인 경로에도 세션 예산을 적용할지 결정 필요.
- **미사용 엔드포인트 정리**: `POST /design/sessions/{id}/motifs/candidates`·`/motifs/generate`(그리고 기존 문서에 기록된 `branch`)가 프론트 어디서도 호출되지 않는다. 모바일 계획에 없다면 제거+codegen 재생성 후보.
- **`.env.example`에 `RECRAFT_API_KEY` 부재** — §2에서 처리.
- Recraft 실패가 사용자에게 어떤 문구로 보이는지(502 → 일반 재시도 문구로 뭉개지는지) — 활성 상태에서도 일시 오류 시 동일 경로를 타므로 문구 적절성 기록.

## 5. 기록

결과는 `docs/reviews/design-recraft-activation-<날짜>.md`에 R1~R4 판정표(PASS/WARN/FAIL)와 토큰 회계, 개선 관찰(§4 포함)로 기록하고 이 플랜을 제거한다. 완료 후 `design-input-modality-e2e.md`로 진행.

## 검증

- [ ] R1: 카탈로그 미스 소재로 `source='recraft'` 신규 모티프 생성 확인
- [ ] R2: 사진 모티프 형태(벡터화) 경로 성공
- [ ] R3(선택): 요청당 2회 상한과 soft 실패(레이어 drop) 동작
- [ ] R4: 토큰 차감·환불 정합, seamless-logs 기록, 콘솔 오류 0건
- [ ] `.env.example`에 `RECRAFT_API_KEY=` 추가
- [ ] 결과를 `docs/reviews/`로 이동, 본 플랜 제거

## 상태 — 계획
