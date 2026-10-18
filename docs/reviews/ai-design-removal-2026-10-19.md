# AI 디자인 전면 제거 — 실행 기록 (2026-10-18 ~ 2026-10-19)

`docs/plans/ai-design-removal.md`를 Phase 1–6까지 코드로 실행했다(플랜은 이 기록과 함께 삭제).
2026-10-18 "바로 주문하기" 전환으로 고객 흐름이 `템플릿(/design) → 색·로고(/customize) → 맞춤 주문(/custom-order)`만
남아, 실사화(finalize)·디자인 토큰·LLM 저작·모티프 검색/생성·임베딩·few-shot/RAG·아이디어 제안을 전부 지웠다.

## 커밋

| 커밋 | Phase | 내용 |
|---|---|---|
| `a6e517e` | 플랜 | 호출부 전수 grep 검토로 플랜을 바로잡음 |
| `b91f037` | 1 | store 토큰 구매·환불·AI 문구, 약관·환불정책·개인정보처리방침(시행일 2026-10-19), shared `ai` variant, admin 생성 작업·few-shot·템플릿 등록 삭제와 메뉴 이름 변경(디자인 렌더 로그·무늬·로고·템플릿) |
| `0de391f` | 2 | api tokens 도메인·결제/주문/클레임 토큰 분기·디자인 생성 엔드포인트·worker finalize 연동 삭제, 명세(money·domains)·api-client 재생성, 스케줄러 배치 2종 삭제 |
| `a9c2c9f` | 3 | worker adapters·저작 RAG·photoreal/fabric/weave·resolver/tagging/text_svg·유료 스크립트·deploy.yml worker-finalize 단계 삭제 |
| `8441df6` | 3 | `worker.authoring` → `worker.design_plan`(템플릿 플랜 스키마·컴파일러만 남음) |
| `4da75ad` | 4 | 마이그레이션 `1edfb81ae618` — 7개 테이블 DROP, motifs 임베딩·설명·태그·검토 컬럼과 렌더 로그 `prompt` DROP, 토큰 CHECK 축소, `vector` 확장 해제 |
| `5ada7b1` | 5 | worker-finalize 서비스·SA·바인딩, `openai-api-key` 시크릿을 tf에서 삭제, infra README에 운영 정리 순서 |
| (이 커밋) | 6 | README·ARCHITECTURE·AGENTS·analytics·하네스 문서, 전제가 사라진 플랜 2개 삭제 |

## 남은 기능 (e2e로 확인)

- 템플릿 제작: tie-template 스킬 `render.py`(warnings `[]`) → `seed_motifs.py` → `seed_design_examples.py` → `check_emblems.py`.
- 고객: 템플릿 → 로고(SVG·사진→SVG) 재렌더 → 바로 주문하기 → `/custom-order` 참고 이미지 첨부 → 맞춤 결제 화면.
  로컬은 Toss 클라이언트 키가 없어 결제위젯이 뜨지 않으므로 결제 완료는 기존 주문(`ORD-20261018-001`)의 admin 주문 상세 참고 이미지로 대신 확인했다.
- admin: 디자인 렌더 로그에 로고 교체 run(`intent`·`motif_slot`)이 고객·세션과 함께 남는다. 무늬·로고·템플릿·고객·클레임·설정·대시보드 정상.
- 검사: api·worker·libs·root Python 테스트 940개, admin 235·shared 70·store 186(아래 무관 실패 7 제외), ruff·lint·architecture·codegen drift·`alembic check`, 마이그레이션 왕복(upgrade → downgrade → upgrade), `tofu validate`.

## 플랜과 달라진 점

- `_resolve_design_run`·`DesignStepActivateTurnPayload`·`DesignGenerateOut`·`job-status.ts`(라벨)·`approved_motif_ids`·`categories.py`(시드 고친 뒤 삭제)는 남는 경로가 써서 남기거나 순서를 바꿨다. 반대로 `_start_generation`·`render/segment.py`는 지웠다.
- `motifs.status`는 남겼다 — `registry_version` 지문 풀이 쓴다. 검토 API·컬럼(`reviewed_*`)만 지웠다.
- 컴파일러 골든 입력(옛 `authoring/data/gallery-v1.json`)은 `apps/worker/tests/golden/plans.json`으로 옮겼고, `tests/golden/candidates*`는 엔진 골든이라 남겼다.
- `money.md`·`worker-motifs.md`·`worker-pipeline.md`는 코드 주석이 절 번호를 참조해 지운 절을 "(삭제)"로 비워 두고 번호를 유지했다.
- `authoring-plan-v3.md`·`design-evaluation.md`는 삭제하고, 템플릿 플랜 계약만 `worker-engine.md` §10으로 옮겼다.
- 토큰 주문이 0건이라(사용자 확인) 주문·클레임 행 삭제 대신 CHECK 축소만 한다 — token 행이 있으면 마이그레이션이 멈춘다.
- tie-template 스킬의 photoreal 실사 목업 단계는 store 화면(평면·사진 실루엣) 확인으로 바꿨다.

## 진행 중 고친 버그

- 로고 렌더 도중 프로세스가 죽은 세션은 로고 넣기 사전 검사가 stale 회수보다 먼저 409를 내 영구히 막혔다 → 사전 검사 전에 회수(`place_design_logo`).
- 로고 교체 재렌더가 worker에 `session_id`·`user_id`를 보내지 않아 렌더 로그의 고객·세션 링크가 비었다 → 함께 보낸다.
- 고객이 올린 로고 모티프에 업로더(`ingested_user_id`)가 기록되지 않아 admin 무늬·로고 상세의 "최초 요청자"가 항상 비었다 → 기록한다.
- tie-template `check_emblems.py`가 옛 응답 필드 `logo_slot`을 읽어 KeyError → `logo_slots`. 스킬 문서도 `logo_slots`로.
- admin 설정 저장 요청이 api `max_length`(키 1개) 때문에 1-튜플 타입이 되어 타입 오류 → 생성 타입으로 캐스트.

## 무관한 기존 실패

- store `features/my-page`의 pending-verification·phone-verify-modal 7건 — Node v26 내장 `localStorage`가 jsdom을 가린다(변경 전 HEAD에서도 동일).
- pyright `apps/worker/scripts/extract_tie_flat_assets.py:68` 1건.
- admin을 전체 새로고침으로 연달아 열면 가끔 "세션을 확인하지 못했습니다"가 뜬다(refresh 회전 경합 추정, api는 200) — 앱 내 이동에서는 재현되지 않았다.

## 사람이 할 일 (운영)

1. main 머지 전: 운영 Cloud SQL에서 `design_examples` ⨝ `seamless_generation_logs`(run_id)가 AI run을 가리키는지, 진행 중 생성(`active_generation_started_at` 75분 이내)이 없는지 확인.
2. Phase 4 커밋이 배포되기 전: Cloud SQL 온디맨드 백업(`gcloud sql backups create`) — migrate는 main 푸시 시 자동 실행된다.
3. 배포 직후: `tofu -chdir=infra apply`(스케줄러 2종·worker-finalize·SA·시크릿 파괴). 순서와 GCS `fabric/`·`tile/` 삭제는 `infra/README.md` "AI 디자인 제거 정리".
4. OpenAI 대시보드에서 키 폐기.
5. 운영 확인: 템플릿 → 색 → 로고(SVG·사진) → 바로 주문하기 → 결제 → admin 주문 상세 참고 이미지.
