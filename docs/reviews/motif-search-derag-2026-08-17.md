# 모티프 시트 벡터 검색 제거 → 태그 검색·브라우징 (2026-08-17)

`docs/plans/motif-search-derag.md` 실행 결과. 3단계 전부 반영했다.
명세 정본은 `docs/api-spec/worker-motifs.md` §5·§9·§10에 함께 갱신했다.

## 결과 요약

| 지표 | 전 | 후 |
|---|---|---|
| 20개 상위어 쿼리 히트 | **12 / 20** | **20 / 20** |
| 20개 쿼리 총 소요 | 8.67s (쿼리당 ~430ms) | **1.07s** (쿼리당 ~50ms) |
| 시트 검색당 provider 호출 | 임베딩 1회(lexical 미달 시) | **0회** |
| 시트 1회 반환 개수 | 4 | 24 |

판정 기준(20개 중 17개 이상 히트) 통과.

## 쿼리별 히트 수

측정: 워커 `POST /motifs/candidates` 직접 호출, 카탈로그 97행. "전"은 τ=0.40 벡터 다리 포함
`top_k=4`, "후"는 lexical 전용 `top_k=24`.

| 쿼리 | 전 | 후 | 쿼리 | 전 | 후 |
|---|---|---|---|---|---|
| 운동 | 0 | **7** | 꽃 | 4 | 6 |
| 스포츠 | 0 | **7** | 식물 | 4 | 12 |
| 바다 | 0 | **13** | 과일 | 0 | **5** |
| 바다동물 | 4 | **13** | 하늘 | 0 | **7** |
| 물고기 | 1 | 1 | 별 | 3 | 3 |
| 동물 | 3 | 24 | 탈것 | 0 | **5** |
| 귀여운 동물 | 2 | 24 | 배 | 2 | 2 |
| 새 | 2 | 6 | 음악 | 1 | 1 |
| 조류 | 0 | **6** | 테니 | 0 | **1** |
| 곤충 | 2 | 6 | 강아지 | 4 | 2 |

전 상태에서 "운동"·"스포츠"·"과일"·"하늘"·"탈것"·"조류"가 전부 0건이었다 — 카탈로그에 tennis·
golf·bicycle·chess가 있는데도 그렇다. 임베딩 문서가 `"{stem} outline icon"` 템플릿 + 영·한
번역쌍 2.9개라 상위어를 잡을 의미 정보가 애초에 없었다. 벡터 다리는 lexical이 실패한
구간에서만 도는데, 바로 그 구간에서 같이 실패하고 있었다.

"강아지"가 4→2로 준 것은 회귀가 아니다. 전에는 벡터가 dog 2건 + **pig 2건**을 섞어 냈다.

## 변경 내용

### 1단계 — 시트에서 벡터 다리 제거

- `apps/worker/src/worker/api/routes.py` `motif_candidates`: `embedding_client=None`.
  `embed_query`가 client `None`이면 `None`을 반환해(`adapters/embedding.py:160`) 명세 §4의
  fail-soft 경로를 그대로 탄다 — 새 분기 없음. `tau`도 넘기지 않는다(벡터 다리 전용 값).
- grounding(`prompt_catalog_candidates`)·τ·임베딩 컬럼·인덱싱 스크립트는 **그대로**다.
  시트는 0건이면 사용자가 단어를 바꿔 재검색하지만 grounding에는 그 루프가 없다.
- 테스트 `test_motifs_candidates_never_embeds_the_query`: 임베딩 클라이언트가 호출되면
  터지는 스텁을 꽂고, **lexical이 0건인 질의**로 친다. "결과가 같다"가 아니라 "호출이 없다"를
  검사해야 회귀가 잡힌다 — lexical이 우연히 `top_k`를 채우면 결과 비교로는 못 잡는다.

### 2단계 — 카테고리 태그 + prefix 매칭

- `worker/motifs/categories.py`(정본): subject → 카테고리 11종(animal/bird/sea/insect/plant/
  fruit/sport/vehicle/sky/symbol/music, 영문 key + 한글어)을 태그로 더한다. **스키마 컬럼 없음.**
  "동물"은 육상·상상 동물만 담는다 — 새·물고기·곤충은 각자 상위어가 있고, 동물이 97개를 다
  끌어오면 칩으로서 못 쓴다. 시드와 resolver가 같은 모듈을 읽는다(후속 4 참조).
- `resolver._prefix_match`: 각 tier의 exact가 `top_k`를 못 채웠을 때만 prefix 일치를 뒤에
  붙인다. exact가 항상 앞서고 prefix는 `embedding_client=None`(시트 경로)에서만 켠다 — grounding의 정확도
  게이트는 건드리지 않는다. 양쪽 모두 짧은 쪽이 2자 이상일 때만 보고 방향은 둘 다다(후속 3).
  - 1자 제외: 한글에서 "새"→새우, "말"→말랑 식 오매칭이 폭발한다.
- 시드의 tags 재기록을 조건부로 바꿨다 — `tags IS DISTINCT FROM`일 때만 쓰고, 그 행의
  `embedding_openai`을 NULL로 만든다. 임베딩 문서가 tags를 포함하므로 태그를 고치면
  grounding 벡터가 낡는다. 스크립트가 재인덱싱 명령을 출력한다.

### 3단계 — 브라우징

- `MOTIF_SEARCH_LIMIT` 4 → **24**. 워커 `CandidatesRequest.top_k` 상한도 10 → 24로 같이
  올렸다(이걸 빼먹으면 api가 422를 받는다 — 실제로 밟았다).
- `motif-categories.ts`: 칩 목록. 라벨이 그대로 검색어이고 `worker/motifs/categories.py`의
  한글어와 **같은 문자열**이어야 한다. 어긋나면 칩을 눌렀는데 0건이 나온다(양쪽 주석에 명시).
- `SearchBody`에 `Chip` 11개(`Flex wrap`). 가로 스크롤 + `ScrollFog` 대신 줄바꿈으로 뒀다 —
  11개뿐이라 모바일에서도 서너 줄이고, 스크롤이면 뒤쪽 칩이 fog 너머에 숨어 "훑게 한다"는
  목적과 어긋난다.
- `openSlot(slot, source, initialQuery?)`: 탐색으로 열면 빈 그리드를 보여주지 않는다.
  모티프 시그널이 채워둔 문장이 있으면 그것을, 없으면 첫 카테고리를 바로 검색한다. 이미
  보고 있던 결과는 덮지 않는다. 페이지의 `openSlot` + `setQuery` 2줄 호출이 1줄이 됐다.

## 브라우저 확인 (Aside, localhost:3000/design)

탐색 시트를 열면 칩 11개 + "동물" 24장이 즉시 뜬다(`동물` aria-pressed=true). "바다" 클릭 →
13장, 칩 선택 이동, 입력창은 빈 채. "테니" 타이핑 + Enter → tennis 1건(prefix 매칭 실동작).
콘솔 오류 0건.

## 검사

`pnpm lint` · `pnpm typecheck` · `pnpm build`(CI env 주입) · `pnpm architecture:check` ·
`pnpm --filter store test`(221 passed) · `uv run ruff check .` · `ruff format --check` ·
`uv run pyright`(0 errors) · `pytest`(worker 모티프·store·resolver + api design).

측정 재현: 워커 `POST /motifs/candidates`에 20개 상위어 쿼리 + 복합어/오매칭 18개를 던지는
셸 스크립트와, `retrieve_catalog`를 카테고리 태그 유/무로 두 번 돌리는 파이썬 스크립트를 썼다.
둘 다 일회성이라 커밋하지 않았다.

`pnpm build`는 `VITE_API_BASE_URL`·`VITE_TOSS_CLIENT_KEY`가 없으면 vite config 단계에서
실패한다 — 이 변경과 무관한 기존 요구사항이고 CI는 `ci.yml` env로 넣는다.

## 후속 1 — `prune_stale_seeds`의 참조 가드 구멍 (수정함)

`store.prune_stale_seeds`가 `UserMotif`·`DesignTurnAttachment` **FK 참조만** 보호하고
`design_sessions.current_intent`/`current_plan`·`design_session_turns.payload`의 motif id는
보지 않았다. 이 셋은 JSON 안의 문자열이라 FK가 없다 — 에셋 SVG를 고쳐 content-hash가 바뀌면
살아 있는 세션이 가리키는 행이 조용히 지워진다.

이번에 로컬에서 실제로 밟았다: 로컬 DB가 prefix 개명(`d632e03`, 2026-08-12) 이전 상태라
`recraft-*` 97행이었고, 시드 재실행이 `seed-*` 97행을 넣고 옛 행 97개를 지우면서
2026-08-03자 테스트 세션 하나의 intent가 dangling이 됐다(재인덱싱 `embedded=97/97` 완료).
production은 2026-08-15 부트스트랩이라 이미 `seed-*`이고 재실행이 0 insert / 97 retag /
0 prune으로 제자리 갱신이라 영향이 없었지만, 앞으로 에셋 글리프를 한 장만 바꿔도 밟는다.

**수정**: 세 JSON 컬럼을 `::text` 부분일치로 훑는 `~exists()` 두 개를 delete 조건에 더했다.
텍스트 훑기를 고른 이유는 실패 방향이다 — 오탐은 행을 살려두는 안전한 쪽이고, id가 JSON 어느
깊이에 중첩돼 있든 놓치지 않는다. motif id는 `prefix-{hex12}`라 LIKE 메타문자가 없다. 비용은
(잔여 stale 행 수) × (세션·턴 스캔)인데 stale은 보통 0~몇 개고 수동 시드 스크립트에서만 돈다.

`test_prune_stale_seeds_keeps_ids_referenced_only_from_json`이 세 경로를 모두 중첩 위치에
심어 검사한다. 가드를 빼고 돌려 **3행 전부 삭제(`assert 3 == 0`)로 실패하는 것까지 확인**했다.

## 후속 2 — 카드 라벨의 영문 subject (수정함)

시드 subject는 에셋 파일명에서 온 영문("cat", "paw", "deer")이라 카드 4장일 땐 티가 안 났는데
24장이 되니 한국어 화면에 영문이 한 판 깔렸다.

**수정**: `_motif_label`이 `Motif.tags`에서 한글 음절이 든 첫 태그를 subject 대신 쓴다. 태그
순서가 `[subject, 파일명 토큰…, 한글 동의어, 카테고리]`(`seed_motifs.py::_tags_for`)라 첫 한글
태그는 상위어 "동물"이 아니라 "고양이"다. 한글 태그가 없는 모티프(사용자 생성·업로드)와 내
라이브러리 이름이 있는 경우는 기존 그대로다.

확인: "동물" → 고양이·발바닥·사슴·말·강아지·다람쥐·양·토끼·소·여우·용·박쥐·쥐·뱀·돼지·너구리·
거북이·유니콘·수달, "바다" → 배·오징어·새우·돌고래·일각고래·게·고래·닻·물고기·랍스터·요트,
"상징" → 방패·열쇠·원·왕관·닻.

## 후속 3 — 복합어 검색 (역방향 prefix 추가)

"바다동물"처럼 붙여 쓴 복합어는 토크나이저가 한 토큰으로 봐서 정방향 prefix로는 못 잡았다.
역방향(`token.startswith(term)`)을 **term도 2자 이상**일 때만 켜서 해결했다.

측정(2026-08-17):

| | 전 | 후 |
|---|---|---|
| 복합어 8건(바다동물·해양동물·바다생물·꽃무늬·별무늬·나뭇잎무늬·고양이상·강아지발) | 0 | **5** |
| 오매칭 유도 10건(고래고래·새록새록·별의별·말끔하게·소소하게·개운하게·배부르게·원만하게·별로·새로) | 0 | **1** (고래고래→고래) |
| 20개 상위어 쿼리 히트 | 19/20 | **20/20** |

"꽃무늬"·"별무늬"는 꽃·별이 1자라 여전히 miss다 — 1자를 허용하면 "새"→새우, "말"→말랑 식
오매칭이 폭발하므로 의도적으로 남긴다. 유일한 오매칭 "고래고래"는 시트에서 카드 한 장이
그리드에 끼는 비용이고 사용자가 눈으로 거른다. **grounding에서는 prefix를 켜지 않는다** —
거기서는 같은 오매칭이 재시도 루프 없이 플랜에 박힌다.

## 후속 4 — grounding 3단 폴백 (고유어 → 벡터 → 카테고리)

카테고리 태그를 고유어와 같은 층에 두니 상위어 프롬프트에서 벡터 다리가 아예 안 돌고, 유사도
순위 자리를 ID(content-hash) 임의 순서가 차지했다. 디자인 프롬프트 10개로 잰 결과:

| | 카테고리 태그 도입 직후 | 3단 폴백 적용 후 |
|---|---|---|
| 0건 → 관련 후보 (개선) | 3건 | **3건 유지** |
| 유사도 순서를 잃음 (후퇴) | 3건 | **0건 — 전부 복원** |
| 순수 추가 (벡터 결과 + 폴백으로 자리 채움) | — | 1건 |

구체적으로 "바다 느낌의 패턴"은 ship 2척이 끼던 것이 anchor·shrimp·crab·fish·whale
(0.40~0.44)로 돌아왔고, "귀여운 동물 패턴"·"새가 날아가는 패턴"도 변경 전과 동일해졌다.
반대로 "동물이 반복되는 넥타이"·"스포츠 테마 넥타이"·"과일이 흩어진 무늬"는 계속 0건 → 5건이고,
"하늘 느낌의 잔잔한 패턴"은 벡터 3건(star·cloud·moon) 순서를 지킨 채 폴백으로 2건을 더 채운다.

구현: 카테고리 어휘를 `worker/motifs/categories.py`로 옮겨 시드와 resolver가 공유한다.
`_lexical_terms`가 태그를 고유어/카테고리로 가르고, `retrieve_catalog`가 tier 순으로 채운다.
시드 스크립트에만 두면 resolver가 상위어와 고유어를 구분할 방법이 없다.

측정 스크립트는 일회성이라 커밋하지 않았다(같은 `retrieve_catalog`를 카테고리 태그 유/무로
두 번 돌리는 40줄). 재현하려면 `store.find_catalog`를 카테고리 태그만 벗긴 메타로 감싸면 된다.

## 남은 것 / 알려진 한계

- **"동물"은 36행 중 24행만 보인다.** 상한 truncation이고 ID(content-hash) 순이라 어느 24개인지
  임의다. 브라우징 시작점으로는 충분하고, 좁히려면 검색창을 쓴다.