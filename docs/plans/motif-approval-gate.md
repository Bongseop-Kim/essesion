# 플랜 — Recraft 모티프 관리자 승인 게이트

> 상태: **미실행 제안** (2026-08-03).
>
> Few-shot(저작 예시)은 `AuthoringPromotionCandidate` → 관리자 승인 → `AuthoringExample.active`
> 흐름으로 RAG 반영 전 검토를 거치지만, 모티프는 `resolve_spec`이 Recraft 생성 직후
> `upsert_motif`를 즉시 커밋하고 공개 카탈로그 조회가 `source != 'user_upload'`만 거르므로
> **생성 즉시** 전체 사용자의 검색·Gemini grounding·variant 재사용 풀에 노출된다.
> 현행 유일 방어선은 인젝션 휴리스틱(`_screen_facets`, C-10)뿐이다. 이를 few-shot과 같은
> "관리자 승인 후 공개" 모델로 맞춘다.

## 설계 결정

- **별도 candidate 테이블을 만들지 않는다.** 모티프 행은 content-hash id로 생성 즉시 존재해야
  하고(생성 세션의 intent가 바로 참조), 임베딩도 이미 행에 저장된다. `motifs.status` 컬럼
  하나로 노출만 게이트하는 것이 최단 경로다.
- **임베딩은 생성 시 그대로 저장한다** (resolver가 query_vec을 재사용하므로 비용 0).
  승인은 벡터를 다시 만드는 게 아니라 검색 노출 플래그만 바꾼다 — "승인 후 벡터 DB 등록"의
  기능적 등가이며 재임베딩 비용이 없다.
- **rejected 행도 삭제하지 않는다.** 과거 세션 intent가 참조하는 모티프는 불변이어야 한다
  (`prune_stale_seeds`와 같은 원칙). rejected는 공개 카탈로그에서만 영구 제외.
- **ID 직접 조회(`get_motifs`)는 필터하지 않는다.** 생성을 요청한 세션은 pending 상태에서도
  자기 모티프를 계속 사용·렌더할 수 있다 — 승인은 "타인에게 전파"만 막는다.

## 동작 개요

1. **스키마(Alembic, `db/`)** — `motifs`에 추가:
   - `status` text NOT NULL DEFAULT `'pending'`, CHECK `('pending','approved','rejected')`
   - `reviewed_at` timestamptz NULL, `reviewed_by` uuid FK users ON DELETE SET NULL
     (AuthoringExample의 `approved_at/approved_by`와 대칭)
   - 백필: 기존 행 전부 `'approved'` (현행 카탈로그 동작 보존).
2. **worker `motifs/store.py`** —
   - `upsert_motif(..., status="pending")` 파라미터 추가. `seed_motifs.py`는 `"approved"`를
     명시, resolver의 recraft 경로는 기본값(pending).
   - 공개 카탈로그 조회 전부에 `Motif.status == "approved"` 필터 추가:
     `find_catalog`, `nearest_by_embedding`, `find_variant_pool`,
     `missing_embedding_documents`, `public_embedding_counts`, `all_motif_ids`.
     `all_motif_ids`가 fingerprint 입력이므로 승인/거절이 registry_version을 바꿔
     캐시가 올바르게 무효화된다. `get_motifs`(ID 조회)는 무필터 유지.
   - user_upload은 기존 source 필터로 이미 카탈로그 밖 — status는 공개 카탈로그 노출만
     지배하고 user_upload 소유권 로직(api design 라우터)은 건드리지 않는다.
3. **api `admin/generation.py`** —
   - `GET /admin/motifs`에 `status` 필터 추가, `MotifSummaryOut`/`MotifDetailOut`에
     `status`, `reviewed_at` 노출.
   - `POST /admin/motifs/{id}/review` (body: `{"status": "approved" | "rejected"}`) —
     저작 후보의 transition 검증 스타일을 따르되 상태 기계는 단순하게: no-op 금지 외
     모든 전이 허용(오승인 회수 = approved→rejected 포함). `reviewed_at/by` 기록.
   - api 스펙 변경이므로 `pnpm codegen` 동반 커밋.
4. **admin UI `pages/motifs`** — 신규 화면 없이 기존 목록·상세 재사용:
   - 목록에 status 필터(기본 pending 우선 노출)와 status 뱃지.
   - 상세에 프리뷰 + 승인/거절 버튼.
5. **문서** — `worker-motifs.md` §5 래더(카탈로그 히트 조건에 approved 명시)·C-10 방어선
   서술 갱신, `docs/CHECKLIST.md` 체크 항목 추가.

## 결과적 트레이드오프 (수용)

- **승인 전 동일 spec 재요청은 카탈로그 miss → Recraft 재호출(과금).** content-hash upsert라
  행 중복은 없지만 호출 비용은 든다. 1차에서는 수용하고(관리자가 pending을 주기적으로 비우는
  전제), 과금이 눈에 띄면 "pending이면서 `ingested_user_id == 요청자`인 행은 본인 래더에 포함"
  완화를 후속으로 검토한다.
- 승인 전까지 신규 모티프는 다른 사용자 검색·grounding에 안 잡힌다 — 의도된 동작.

## 열린 설계 포인트 (실행 전 확정)

- 거절된 모티프를 이미 사용 중인 세션 처리: 그대로 둔다(참조 불변) vs store에 안내 시그널.
  1차는 그대로 두는 쪽을 기본으로.
- pending 대기열 알림: admin 대시보드 카운트만으로 충분한지, 별도 알림이 필요한지.
- 저작 예시 승인 화면(`authoring/candidates-list`)과 모티프 승인 목록을 묶은 "검토함" 통합
  네비게이션이 필요한지 — UI만의 문제이므로 후속.

## 작업 항목 (실행 시 상세화)

- db: Alembic 마이그레이션(status/reviewed_at/reviewed_by + 백필 + CHECK), `Motif` 모델 갱신.
- worker: `upsert_motif` status 파라미터, 공개 조회 6곳 필터, `seed_motifs.py` approved 명시,
  resolver miss→pending 저장 테스트, 카탈로그 필터 테스트(pending/rejected 미노출,
  ID 조회는 노출).
- api: status 필터·review 엔드포인트, 인가 테스트는 testcontainers(관리자만 전이 가능,
  mock 금지), `pnpm codegen`.
- admin: motifs 목록 status 필터·뱃지, 상세 승인/거절 액션, 목록 테스트 갱신.
- 문서: worker-motifs.md, docs/CHECKLIST.md.
