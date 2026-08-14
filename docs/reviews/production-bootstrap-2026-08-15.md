# Production 초기 데이터 부트스트랩 (2026-08-15)

OPERATOR-CHECKLIST B-4 실행 기록. 엣지 챌린지 해소와 deploy 통과는
[cloudflare-bot-challenge-2026-08-14](./cloudflare-bot-challenge-2026-08-14.md)에 따로 있다.

## 접속

`database-url` 시크릿은 Cloud Run 전용 소켓 DSN이라 단말에서 못 쓴다. Cloud SQL 프록시를
**5433**으로 띄웠다 — 기본 5432는 로컬 docker Postgres 자리라, production을 잘못 겨냥할
여지를 없애려고 일부러 비켰다.

```bash
cloud-sql-proxy ysindustry:asia-northeast3:essesion-pg --port 5433 &
```

## 스키마 (E-1)

`alembic_version = c7a8d2f1b604` — 현재 head 그대로이고 알 수 없는 개발 revision은 없다.
public 스키마 테이블 43개. 시드 직전 상태는 `motifs=0`, `users=0`, `admin_settings=0행`.

## 시드 결과

순서대로 실행했고 전부 멱등이다. `backfill_motif_tags.py`는 계획대로 **실행하지 않았다**
(백필 대상 없음 + 유료 호출).

| 스크립트 | 결과 |
|---|---|
| `seed_motifs.py` | `seeded 97 motifs, pruned 0 stale` → `source=seed` 97건 |
| `seed_design_examples.py` | 갤러리 6건, `published=t` (ordinal 0–5) |
| `index_motif_embeddings.py --confirm-live` | **`embedded=97/97`** |
| `seed_authoring_examples.py --confirm-live` | **`embedded=25/25 source=bootstrap`** |

## 캡스톤 eval — family recall만 회귀

`eval_authoring.py --confirm-live` (corpus 30, `gpt-5.6-luna`, plan contract v3):

| 지표 | 2026-08-03 기준선(로컬) | production | |
|---|---|---|---|
| schema compile 성공률 | 30/30 | 30/30 | 유지 |
| retrieval ok | 30/30 | 30/30 | 유지 |
| 평균 저작 시도 | 1.27 | 1.07 | 개선 |
| p95 지연 | 19.7s | 11.2s | 개선 |
| expected family recall | 0.83 | **0.667** | **회귀** |

통과 기준(compile·retrieval 30/30)은 충족했으므로 배포를 막지 않는다. 다만 25/30 → 20/30은
표본 5건 차이라 무시할 크기가 아니다.

교란 요인은 대부분 배제된다 — 모델(`gpt-5.6-luna`)·plan contract(v3)·코퍼스(motif 97/97,
example 25/25 `bootstrap`) 모두 기준선과 같다. 시도 횟수와 p95가 오히려 좋아진 것도
"환경이 나빠져서"라는 설명과 어긋난다. 남는 후보는 **LLM 샘플링 변동**이거나 실제 회귀다.

가르는 법은 재실행 1회다. `docs/CHECKLIST.md`에 미완료 항목으로 남겼다.

## 막힌 지점 — production에 설정·가격을 넣을 경로가 없었다

관리자 계정을 만든 뒤 `admin_settings`·`pricing_constants`가 **둘 다 0행**인 것을 확인하고,
CHECKLIST가 지시하던 "admin 화면에서 직접 넣는다"를 따라가 보니 실행이 불가능했다.

| 사실 | 근거 |
|---|---|
| 설정 PUT이 신규 행을 못 만든다 | `domains/admin/configuration.py:311` `row = by_key[key]` → 없는 key면 KeyError |
| 가격 PUT도 동일 | 같은 파일 `:196` |
| `seed.py`는 production에서 차단 | `seed.py:523` `env not in ("local","test")` → `RuntimeError` |
| 마이그레이션에 초기행 삽입 없음 | `db/versions/`에 해당 INSERT 없음 |

두 화면 모두 **DB 행을 나열해 수정**하는 구조인데 나열할 행이 없었다. 즉 빈 production DB는
설정·가격을 채울 수단이 아예 없는 상태였다. 영향은 토큰만이 아니라 수선(`REFORM_*`)·맞춤
(`START_COST` 등)·원단·샘플 할인까지 40개 키 전부이고, 누락 시 `pricing.py:17`이
`pricing_not_configured`를 던진다.

문서에도 같은 함정이 있었다 — CHECKLIST의 "토큰 플랜 2,500/7,500/25,000"은 **토큰 수량**이고
가격은 2,500/**6,500**/**18,000**원이다(money.md §6). 그대로 읽고 입력하면 popular·pro가
과소 청구된다.

### 고친 방식

`bootstrap_admin.py`에 `seed-config` 서브커맨드를 추가했다. 이미 production 운영용으로 쓰는
스크립트라 새 진입점을 늘리지 않는다. 값은 `api/config_defaults.py`로 빼서 로컬 `seed.py`와
**단일 출처**를 공유한다(기존에는 seed.py 안에만 있었다).

overwrite 동작을 호출자별로 갈랐다:

- 로컬 `seed.py` → `overwrite=True`. 단가만 옛 값에 남으면 플랜 수량과 어긋난다.
- production `seed-config` → `overwrite=False`. 빠진 행만 채우고, 운영자가 화면에서 조정한
  값은 재실행해도 되돌리지 않는다.

검증은 `apps/api/tests/test_admin_bootstrap.py`에 2건 추가했다 — 조정값 보존/덮어쓰기 양방향과,
관리자 화면이 요구하는 `SETTING_KEYS`·`PRICE_CATEGORIES`가 기본값에 전부 포함되는지(category
일치까지). 화면이 요구하는 키가 하나라도 빠지면 그 행은 영영 만들 수 없기 때문이다.

### 적용 결과

```
설정 기본값 적용 완료: admin_settings 6키, pricing_constants 40키 (빠진 행만 채움)
```

토큰 플랜은 가격 2,500/6,500/18,000 · 수량 2,500/7,500/25,000으로 money.md §6과 일치한다.
단가는 25/12/100, 초기 지급 750, finalize 일 상한 10.

## 함께 고친 문서 결함

B-5(외부 콘솔 등록)를 앞두고 문서를 대조하다 2건을 찾았다.

**① 등록 시점이 두 문서에서 어긋났다.** `OPERATOR-CHECKLIST`는 B-5(배포 직후), `CHECKLIST`는
컷오버 섹션에 배치했다. 정답은 B-5다 — 공개 회원가입이 없어 소셜 로그인이 유일한 가입 경로라
(`auth/router.py`), redirect URI 등록 전에는 새 store에 아무도 로그인할 수 없다. `CHECKLIST`의
컷오버 항목을 "재확인"으로 고쳐 `OPERATOR-CHECKLIST` F-2와 맞췄다.

같은 자리에 **OAuth와 Toss 웹훅의 비대칭**도 명시했다. 네 문서가 둘을 늘 한 문장에 묶어 다뤘는데
성격이 반대다 — redirect URI는 콘솔에 **추가**되어 기존 등록과 병행되지만, 웹훅은 보통 상점당
단일 값이라 **교체**이고 같은 상점을 쓰는 다른 서비스의 통지를 끊는다. 이번 건은 기존 YeongSeon에
실사용이 없음을 확인해 위험이 없었다. 롤백 runbook 항목에도 "외부 콘솔 설정은 DNS 원복으로
되돌아가지 않는다"를 덧붙였다.

**② Solapi `/readyz` 사각지대.** capability가 보는 required는 7개인데
(`integrations/solapi.py`) `SOLAPI_TEMPLATE_PHONE_CODE`·`SOLAPI_TEMPLATE_PAYMENT_DONE`가
거기 없다. 두 값이 비어도 `real`로 초록불이면서 인증번호는 평문 SMS로 폴백하고, 결제완료
알림톡은 로그도 없이 early return한다(`payments/service.py`). `production.tfvars.example`에
두 키를 경고와 함께 추가하고 OPERATOR-CHECKLIST B-5 문구에 "7개만 본다"를 명시했다.

참고로 이관 원본(YeongSeon/Supabase) 접속 정보는 레포에 **한 건도 남아 있지 않다** —
supabase DSN이 있던 `db/scripts/migrate_data.py`는 `aad48ea`에서 삭제됐고 그마저
플레이스홀더였다. 컷오버 시 필요한 정보가 외부 콘솔과 사람 머릿속에만 있다는 뜻이다.

## 남은 것

- **상품 0행** — store 목록이 비어 있다. 상품은 실제 판매 데이터라 admin `/products`에서 직접 등록한다.
- admin Motif 상세에서 symbol의 concrete paint 표본 확인.
- B-5 외부 콘솔 등록(Toss 웹훅·OAuth redirect·Solapi). 기존 서비스 실사용이 없어 웹훅 교체는 안전하다.
