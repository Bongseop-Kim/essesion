# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md) (§8 마이그레이션 순서). 완료 기록은 Git 이력에 남기고, 이 문서에는 미완료 항목만 유지한다.

## 1. 골격

- [ ] OpenTofu — **스테이징 별도 GCP 프로젝트**: Cloud Run×3, Cloud Tasks, Cloud SQL(**PITR 활성화**), GCS, Artifact Registry, IAM, WIF — *IaC 작성 완료. `infra/README.md` 부트스트랩 후 `tofu apply`*
- [ ] Cloudflare: 서브도메인(app/admin/api) + API 프록시(WAF·레이트리밋) 개통 — *첫 API 배포 전에 `api.essesion.shop` secret·WAF와 `/design/ideas` IP 기반 edge rate limit을 적용 (`infra/cloudflare/README.md`, `docs/OPERATOR-CHECKLIST.md` §A4·C).*
- [ ] GCP 예산 알림 1개 + uptime check 1개 — *tofu apply 시 생성*
- [ ] Sentry 프로젝트(api·worker·store) 생성 및 DSN 주입
- [ ] Secret Manager에 OpenAI·결제·알림·OAuth·Sentry provider 값과 환경별 jwt/session/edge secret 주입

## 2. 스키마 재설계

- [ ] Alembic 스테이징 적용 — *첫 배포의 migrate Cloud Run job 성공과 현재 head(`b9e4f61a2c73`) 확인. 빈 DB에는 베이스라인 `f8c3b2a19d47` 뒤 OpenAI 전환·모티프 정리 리비전이 순서대로 적용되며, 적용 뒤 OpenAI 임베딩을 다시 만든다.*
- [ ] `admin_settings.design_edit_cost` 행 확인 — *구성 수정 단가(신규 필수 키). 없으면 `/admin/settings`가 503, 구성 수정이 `token_cost_not_configured`. `apps/api/scripts/seed.py`가 기본 2로 시드한다.*

## 4. worker

- [ ] worker-generate + worker-finalize 스테이징 배포 — *tofu와 deploy workflow 작성 완료, 실제 개통만 남음*

## 5. 프론트

- [ ] Cloudflare Workers 배포(Vite build + Wrangler Static Assets) 및 DNS 확인 — *2026-08-13 네이티브 입력·Popover·단일 Modal 전환과 잔여 과설계 제거, 원화 입력 천 단위 표기와 휴대폰 입력·조회 표준화, 관리자 생성·에셋 목록의 기본 전체 조회와 검색·사이드 필터 정렬, 디자인 예시 등록 전용 페이지 분리를 로컬 검증 완료. 실제 배포와 DNS 확인만 남음.*

## 6. 리허설 (스테이징)

- [ ] 빈 스테이징 DB를 현재 Alembic head `b9e4f61a2c73`까지 적용 → 관리자·고정 색상 motif 초기 입력 → `backfill_motif_tags.py --confirm-live` → `index_motif_embeddings.py --confirm-live` → `seed_authoring_examples.py --confirm-live` 순서로 실행, motif/example `embedded=total` 및 admin 표본의 SVG 색상·자동 태그·편집 결과 검증
- [ ] 수치·배열 바운드를 포함한 OpenAI strict schema로 `eval_authoring.py --confirm-live` 30건 재평가 → compile 30/30, retrieval 30/30 및 재시도·p95를 2026-08-03 기준선과 비교 — *로컬 few-shot 역재현 25건은 예시 코퍼스를 골든 정답지로 복구한 뒤 P1 A+B 24/25, P2 B 이상 24/25, grounding 20/20으로 기준을 통과했다(`docs/reviews/design-family-reverse-eval-2026-08-04.md`). 스테이징 30건 기준선 비교는 남음.*
- [ ] 모티프 모달의 GPT Image 2 low + VTracer medium 스테이징 스모크 → 한국어 원문 subject만 전달, 사방 10% 여백·원본 캔버스 비율·그라데이션/음영 없는 플랫 색면·모티프별 가변 색상·SVG 복잡도 예산을 확인한다. 사진 업로드도 색상 수 옵션 없이 같은 중간색 정리+VTracer medium 경로를 사용하고 다색 모티프를 보존하는지 확인한다. 생성 SVG의 색상이 저장·검색·디자인 배치까지 유지되는지, 디자인 생성의 catalog miss에서는 GPT Image 호출·예산 변화가 없는지도 확인
- [ ] GPT Image 모티프 승인 게이트 스테이징 리허설 → 신규 행이 `source=gpt_image`, `pending`이고 요청 세션의 ID 직접 렌더는 유지되는지, 다른 사용자 검색·grounding과 registry fingerprint에서는 빠지는지 확인. admin 승인 시 즉시 노출·fingerprint 변경, 거절/승인 회수 시 즉시 제외, manager mutation 403을 함께 검증
- [ ] 이전 모티프 생성 provider credential 폐기 확인 → OpenTofu apply에서 기존 Secret Manager 리소스·worker env·IAM 제거를 확인하고 외부 provider API key를 폐기한다
- [ ] E2E: 소셜 로그인 4종 / 주문·결제·클레임 / 생성(첫 생성 → 구성 수정 → 모티프 검색·명시적 생성·교체 → 이력 되돌리기 → finalize 큐 → 결과 수신) — *로컬 전체 디자인 플로우를 2026-08-04 Aside로 실행했다(`docs/reviews/design-flow-e2e-2026-08-04.md`). 외부 모티프 생성 1회·inline finalize는 성공했고, 발견 7건은 2026-08-04에 후속 조치했다(`docs/reviews/design-flow-e2e-followup-2026-08.md`). 로컬 스토어 주문·mock 결제·클레임·구매확정·후기·마이페이지와 admin 교차 확인을 2026-08-11 Aside로 실행했으며(`docs/reviews/e2e-01-store-2026-08.md`), 상품 이미지 연결·시드 수·구매확정 후기 게이트 후속 수정도 같은 날 검증했다(`docs/reviews/e2e-01-store-fixes-2026-08.md`). 알림 결합·Solapi·클레임 차단·품절·후기 게이트를 재실행했으며 시드 상품의 `option_label` 누락 1건이 남았다(`docs/reviews/e2e-01-store-rerun-2026-08.md`). 같은 날 디자인·토큰 구매/환불·admin 교차 확인도 외부 모티프 생성 0회로 실행했으며 예시·수정 단가의 열린 store 즉시 반영 2건이 후속으로 남았다(`docs/reviews/e2e-02-design-2026-08.md`). 주문제작·샘플·견적·수기 주문과 admin 교차 확인도 mock Toss/외부 모티프 생성 0회로 실행했으며 비로그인 주문제작 초안의 로그인 이관 실패 1건이 후속으로 남았다(`docs/reviews/e2e-03-custom-sample-2026-08.md`). 수선 주문·방문 수거·발송 등록 3경로·admin 상태 머신·구매확정·후기·취소도 mock Toss 4건/외부 모티프 생성 0회로 실행했으며 success 새로고침과 사진 업로드 중 메모 소실 2건이 후속으로 남았다(`docs/reviews/e2e-04-repair-2026-08.md`). e2e-02·03·04와 모티프 의미 보존 후속을 2026-08-11 일괄 수정·재판정 완료했다 — D3b 브라우저 재확인은 2026-08-12 worker 재시작 후 완료, 카탈로그 보강도 2026-08-12 완료 — 동백꽃·페이즐리 exact 매치 확인, 고래는 기존 시드로 충분 판명(`docs/reviews/e2e-fixes-batch-2026-08-11.md`, `docs/reviews/motif-catalog-%72ecraft-boost-2026-08-12.md`). 스테이징 Cloud Tasks 경로와 소셜 로그인 4종·실 Toss 검증은 남음.*
- [ ] 디자인 첫 진입 예시 큐레이션 — *기본 6종은 `apps/worker/scripts/seed_design_examples.py`(외부 API 없이 gallery-v1 플랜을 결정론 컴파일)가 게시 상태로 시드한다. 그 위에 실제 run을 `/admin/design-examples`에서 run ID로 등록·게시해 큐레이션을 보강한다. 게시 예시가 0건이면 store `/design` 첫 진입이 기존 빈 상태 문구로 폴백한다(비로그인 포함).*
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정
- [ ] OpenAI 국외 처리 문구와 실제 전송 항목 검토 → 디자인 저작·임베딩·명시적 GPT Image 모티프 생성의 입력과 provider 보존기간·예외를 privacy owner와 법률 검토자가 확인
- [ ] 회원 탈퇴 후 역사성 개인정보 필드별 보존 목적·기간·접근 통제·분리 저장·만료 시 익명화/삭제 정책 승인
- [ ] 주문/클레임/견적/문의/수선/이미지/디자인 job·관리자 로그 샘플로 purge·익명화 배치와 복구 불가성 검증

## 7. 컷오버

- [ ] 프로덕션 GCP 프로젝트 프로비저닝(OpenTofu 재사용)
- [ ] provider redirect URI·Toss webhook URL을 프로덕션 `api.<domain>`에 등록(run.app 직통 금지)
- [ ] 빈 프로덕션 DB를 현재 Alembic head까지 적용 → 환경별 초기 데이터 입력 검증
- [ ] DNS 전환 + 전원 재로그인 공지
- [ ] 롤백 절차 문서화(DNS 원복 — 동결 해제 전까지 데이터 무손실)
- [ ] 역사성 개인정보 보존·익명화 정책과 자동 배치 승인·검증을 production gate에서 재확인
- [ ] 안정화 확인 후 Supabase 프로젝트 해지
