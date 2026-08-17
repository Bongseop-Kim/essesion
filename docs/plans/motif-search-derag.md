# 모티프 탐색 시트에서 벡터 검색 제거 → 태그 검색·브라우징

**한 줄**: 모티프 모달의 탐색(`POST /design/sessions/{id}/motifs/search`)에서 임베딩 다리를
떼고, 그 자리를 카테고리 태그와 브라우징으로 채운다. 디자인 생성 grounding의 벡터 검색은
**그대로 둔다**.

관련: `docs/api-spec/worker-motifs.md` §5·§9·§10(정본), `apps/worker/src/worker/motifs/resolver.py`,
`apps/worker/src/worker/api/routes.py:961`, `apps/api/src/api/domains/design/router.py:2358`.

## 측정 근거 (2026-08-17, 로컬 :8001 직접 호출)

카탈로그 현황: approved 공개 모티프 97행, 임베딩 97/97, 태그 평균 2.9개.
태그는 사실상 영·한 1:1 번역쌍(`{crow, 까마귀}`)이고 description은 파일명 템플릿
`"{stem} outline icon"`(`seed_motifs.py:173`)이다 — 임베딩 문서의 절반이 "outline icon" 노이즈다.

`POST /motifs/candidates`, `top_k=4` 실측:

| 쿼리 | 결과 | 지연 |
|---|---|---|
| 바다에 사는 동물 | dolphin 0.4100 (τ=0.40 턱걸이) | ~270ms |
| 귀여운 반려동물 | dog 0.4262 | ~270ms |
| **운동** | **0건** (tennis·golf·bicycle·chess 보유) | ~280ms |
| 여름 휴가 느낌 | 0건 | ~250ms |

읽는 법:

1. **벡터는 lexical이 실패한 구간에만 돈다.** `retrieve_catalog`는 exact-token으로 `top_k`를
   채우면 임베딩을 부르지 않고 조기 반환한다(`resolver.py:279`). 즉 지금 남은 벡터 호출은
   전부 "lexical이 못 찾은" 쿼리인데, 위 표대로 그 구간에서 벡터도 같이 실패한다.
2. **"운동"이 0건인 게 핵심 신호다.** 카테고리 수준 질의는 태그 하나로 해결되는 문제지
   임베딩이 필요한 문제가 아니다. 지금은 태그도 없고 임베딩도 못 잡는다.
3. **비용은 제거 근거가 아니다.** `text-embedding-3-large`는 $0.13/1M tokens — 쿼리당 약
   $0.000001이다. 오히려 탐색 0건이 유료 GPT Image "만들기"를 유발하는 쪽이 비싸다.
   제거 근거는 **지연 250~280ms**와 **회수되지 않는 recall**, 그리고 임베딩 클라이언트가
   네트워크 블립 이후 워커 재시작 전까지 오염되는 알려진 실패 모드다.

## 왜 grounding은 남기는가

시트와 디자인 생성 grounding은 같은 `retrieve_catalog`를 쓰지만 **miss 비용이 다르다**.

- 시트: 0건이면 사용자가 단어를 바꿔 즉시 재검색한다. 재시도 루프가 있다.
- grounding: 사용자가 "여름 느낌 넥타이"라고 쓰고 끝이다. 카탈로그에 돌고래가 있었다는 걸
  영영 모른다. 재시도 루프가 없으므로 marginal recall도 값이 있다.

따라서 `prompt_catalog_candidates`(`routes.py:474`)와 τ=0.40, 임베딩 컬럼·인덱싱 스크립트는
전부 유지한다. 이 플랜은 **시트 경로 한 곳**만 건드린다.

---

## 1단계 — 시트에서 벡터 다리 제거

**변경**: `apps/worker/src/worker/api/routes.py:970`, `present_candidates(...)` 호출의
`embedding_client=adapters.embedding` → `None`.

`embed_query`는 client가 `None`이면 `None`을 반환하고(`adapters/embedding.py:160`),
`retrieve_catalog`는 그 경우 벡터 다리를 건너뛴다. 명세 §4의 "미설정은 exact token 검색만
남기는 fail-soft" 경로를 그대로 타므로 새 분기가 필요 없다. `tau` 인자는 시그니처에 남지만
시트 경로에서는 무의미해진다 — 지우지 말 것(`present_candidates`는 테스트에서 직접 호출된다).

**검증**
- `uv run pytest apps/worker/tests/test_api_motifs.py apps/worker/tests/test_motif_resolver.py`
- 시트 경로가 임베딩 클라이언트를 **호출하지 않는다**는 어서션을 추가한다(스파이 클라이언트로
  호출 횟수 0 확인). 지금 통과하는 테스트가 우연히 lexical만 타서 초록일 수 있으므로
  "결과가 같다"가 아니라 "호출이 없다"를 검사한다.
- 위 실측 4개 쿼리를 다시 던져 지연이 한 자리 ms로 떨어지는지 확인한다.

**명세**: `worker-motifs.md` §5의 "`candidates`는 위와 같은 신뢰도 게이트의 catalog hit만
반환하고" 문장을 고친다 — 시트는 lexical exact-token만, τ 게이트는 grounding 전용.

여기까지가 최소 실행 단위다. 2단계 없이 1단계만 배포하면 "운동" 같은 쿼리의 recall이
지금과 같거나(대부분) 아주 조금 나빠진다(dolphin/dog 사례 2건). 2단계와 **같은 릴리스로**
가는 것을 권한다.

---

## 2단계 — 태그·매칭 보강 (recall 회수)

### 2-1. 카테고리 태그

`seed_motifs.py:27`의 `_KO_TAGS`는 subject → 한글 동의어만 담는다. 여기에 카테고리 축을
더한다. **스키마 변경 없음 — 카테고리는 그냥 태그 하나다.** 별도 dict를 두고 시드 조립
(`_all_seeds`, `seed_motifs.py:166·171`)에서 합친다.

고정 카테고리 어휘(영·한 둘 다 태그로 넣는다):

| 카테고리 | 한글 태그 | 예시 subject |
|---|---|---|
| animal | 동물 | cat, dog, fox, elephant, deer, … |
| bird | 새, 조류 | bird, crow, dove, duck, pelican, kiwi |
| sea | 바다, 해양 | dolphin, whale, crab, fish, squid, lobster, shrimp, narwhal, turtle |
| insect | 곤충, 벌레 | bee, butterfly, spider, mosquito, worm |
| plant | 식물 | flower, leaf, clover |
| fruit | 과일 | cherry, grape, lemon, strawberry, kiwi |
| sport | 스포츠, 운동 | tennis, golf, bicycle, chess |
| vehicle | 탈것, 교통 | plane, ship, sailboat, bicycle |
| sky | 하늘, 날씨 | cloud, moon, star, sun, snowflake |
| symbol | 상징, 문장 | anchor, crown, key, shield, paw, circle |
| music | 음악 | music |

한 모티프가 여러 카테고리에 속해도 된다(kiwi = bird + fruit, bicycle = sport + vehicle).
카테고리 목록은 위 표가 정본이며 3단계의 칩 목록과 **같은 리스트를 쓴다** — 칩을 눌렀는데
0건이 나오는 조합을 만들지 말 것.

시드는 멱등이고 시드 행 tags를 `UPDATE`로 명시 재기록하므로(`seed_motifs.py:206`) 재실행만
하면 반영된다:

```bash
uv run python apps/worker/scripts/seed_motifs.py
```

**태그가 바뀌면 grounding용 임베딩 문서도 낡는다.** `embedding_document`가 tags를 포함하므로
시드 재실행 후 해당 행의 `embedding_openai`를 NULL로 만들고 재인덱싱한다(97건 × 짧은 텍스트
= 비용 무시 가능). 무효화는 시드 스크립트에서 tags를 실제로 바꾼 행에 한해 함께 수행하고,
그 다음:

```bash
uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live   # embedded=total 확인
```

### 2-2. 부분일치 (시트에만)

`_lexical_match`(`resolver.py:251`)는 토큰 집합 교집합만 본다 — "테니"로는 tennis가 안 잡힌다.
97행을 이미 메모리에 전부 올려두므로(`store.find_catalog`) prefix 매칭을 더해도 비용은 0이다.

**단, grounding과 공유하는 함수라 무조건 완화하면 안 된다.** grounding에서 오매칭이 늘면
검증 실패·재저작(`semantic_mismatch`)으로 이어진다. `_lexical_match(..., prefix: bool = False)`
플래그를 두고 시트 경로(`present_candidates`)에서만 켠다.

가드:
- **2자 이상 쿼리 토큰**에만 적용한다. 1자 토큰의 prefix 매칭은 한글에서 오매칭이 폭발한다.
- 쿼리 토큰이 카탈로그 term의 prefix인 방향만 본다(`term.startswith(token)`). 역방향
  substring은 켜지 말 것 — "말"류 오매칭이 기존 조사 절단 deny 리스트를 우회한다.

### 2-3. 검증 — before/after 히트 표

아래 20개 쿼리를 lexical-only 경로로 던져 히트 수를 1단계 직후와 2단계 직후로 나란히 기록한다.
이 표가 이 플랜의 성패 판정이다.

```
운동 · 스포츠 · 바다 · 바다동물 · 물고기 · 동물 · 귀여운 동물 · 새 · 조류 · 곤충 ·
꽃 · 식물 · 과일 · 하늘 · 별 · 탈것 · 배 · 음악 · 테니 · 강아지
```

**판정 기준**: 20개 중 **17개 이상이 1건 이상** 반환하면 통과. 미달이면 카테고리 표를 넓히고
다시 잰다(임베딩을 되돌리지 말 것 — 위 실측대로 임베딩은 이 표에서도 대부분 0건이다).

---

## 3단계 — 검색에서 브라우징으로

97개는 "찾는" 규모가 아니라 "훑는" 규모다. 지금 시트는 첫 진입이 빈
`ContentPlaceholder`("넣을 그림을 문장으로 알려주세요")라서, 사용자가 무엇을 적어야 할지
모르는 상태에서 빈 화면을 본다.

**변경**
1. `apps/api/.../design/router.py:80`의 `MOTIF_SEARCH_LIMIT = 4` → **24**. 4는 카테고리
   브라우징에 너무 작다. 워커의 `top_k`도 같이 커지지만 97행 메모리 스캔이라 무해하다.
2. `motif-modal.tsx`의 `SearchBody`(:255)에 검색창 아래 **카테고리 칩 줄**을 추가한다.
   칩은 2-1 표의 한글 카테고리 태그를 그대로 쿼리로 보내는 프리셋이다 — 새 엔드포인트도,
   `MotifSearchRequest` 계약 변경도 필요 없다.
3. 모달을 열면 첫 칩(또는 최근 사용 칩)의 결과를 미리 채운다. 빈 그리드로 시작하지 않는다.

**하네스 준수**
- 칩은 shared `Chip`(색인표: pill 선택/토글 — 필터·태그 선택). 앱 로컬 재구현 금지.
- 칩 줄이 가로로 넘치면 **`ScrollFog`만** 사용한다(`packages/shared/AGENTS.md` 규칙 10,
  `overflowX`·`overflow-x-*` 직접 사용은 `pnpm lint`가 차단).
- 로딩은 형태를 아는 그리드이므로 `Skeleton`, 0건은 `ContentPlaceholder`.

**검증**: `pnpm --filter store test`, 그리고 `.claude/skills/aside-browser`로 실제 모달에서
칩 → 그리드 → 확정까지 눌러 확인한다. 모바일 390 폭은 Aside로 리사이즈가 안 되므로
`matchMedia` 스텁 테스트로 대신한다.

---

## 명세 갱신 (같은 커밋에서)

- `worker-motifs.md` §5 — `candidates`는 lexical exact-token(+prefix)만, τ 게이트는 grounding 전용.
- `worker-motifs.md` §9 — 시드 태그에 카테고리 축이 포함됨을 명시하고 카테고리 표를 옮긴다.
- `worker-motifs.md` §10 — `motif_similarity_tau`가 grounding 전용 설정임을 명시.
- api 스펙(`MOTIF_SEARCH_LIMIT`)이 응답 개수를 바꾸므로 `pnpm codegen` 후 `packages/api-client`
  생성물을 같은 커밋에(CI codegen-drift 검사).
- 문서·구조를 건드리므로 `pnpm architecture:check` 필수.

## 하지 않는 것

- **grounding 벡터 검색 제거** — 재시도 루프가 없어 marginal recall도 값이 있다.
- **임베딩 컬럼·인덱싱 스크립트·τ 삭제** — grounding이 계속 쓴다.
- **`category` 컬럼 추가** — 태그 하나로 충분하다. 마이그레이션 값어치가 없다.
- **pg_trgm·tsvector 도입** — 97행 메모리 스캔에 인덱스는 과하다. 카탈로그가 수천 행이 되면
  그때 다시 판단한다.

## 기록

실행 후 2-3의 before/after 히트 표와 지연 측정을
`docs/reviews/motif-search-derag-<날짜>.md`에 남기고 이 플랜을 삭제한다. 히트 표는 다음에
카탈로그가 커졌을 때 검색 품질을 재판정할 기준선이다.
