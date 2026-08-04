# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md) (§8 마이그레이션 순서). 완료 기록은 Git 이력에 남기고, 이 문서에는 미완료 항목만 유지한다.

## 1. 골격

- [ ] OpenTofu — **스테이징 별도 GCP 프로젝트**: Cloud Run×3, Cloud Tasks, Cloud SQL(**PITR 활성화**), GCS, Artifact Registry, IAM, WIF — *IaC 작성 완료. `infra/README.md` 부트스트랩 후 `tofu apply`*
- [ ] Cloudflare: 서브도메인(app/admin/api) + API 프록시(WAF·레이트리밋) 개통 — *첫 API 배포 전에 `api.essesion.shop` secret·WAF와 `/design/ideas` IP 기반 edge rate limit을 적용 (`infra/cloudflare/README.md`, `docs/OPERATOR-CHECKLIST.md` §A4·C).*
- [ ] GCP 예산 알림 1개 + uptime check 1개 — *tofu apply 시 생성*
- [ ] Sentry 프로젝트(api·worker·store) 생성 및 DSN 주입
- [ ] Secret Manager에 OpenAI·Recraft·결제·알림·OAuth·Sentry provider 값과 환경별 jwt/session/edge secret 주입

## 2. 스키마 재설계

- [ ] Alembic 스테이징 적용 — *첫 배포의 migrate Cloud Run job 성공과 현재 head(`6dbb8bb66939`) 확인. 빈 DB에는 베이스라인 `f8c3b2a19d47` 뒤 OpenAI 전환 리비전이 순서대로 적용되며, 적용 뒤 OpenAI 임베딩을 다시 만든다.*
- [ ] `admin_settings.design_edit_cost` 행 확인 — *구성 수정 단가(신규 필수 키). 없으면 `/admin/settings`가 503, 구성 수정이 `token_cost_not_configured`. `apps/api/scripts/seed.py`가 기본 2로 시드한다.*

## 4. worker

- [ ] worker-generate + worker-finalize 스테이징 배포 — *tofu와 deploy workflow 작성 완료, 실제 개통만 남음*

## 5. 프론트

- [ ] Cloudflare Workers 배포(Vite build + Wrangler Static Assets) 및 DNS 확인

## 6. 리허설 (스테이징)

- [ ] 빈 스테이징 DB를 현재 Alembic head `6dbb8bb66939`까지 적용 → 관리자·고정 색상 motif 초기 입력 → `index_motif_embeddings.py --confirm-live` → `seed_authoring_examples.py --confirm-live` 순서로 실행, motif/example `embedded=total` 및 admin 표본의 SVG 색상 보존 결과 검증
- [ ] 수치·배열 바운드를 포함한 OpenAI strict schema로 `eval_authoring.py --confirm-live` 30건 재평가 → compile 30/30, retrieval 30/30 및 재시도·p95를 2026-08-03 기준선과 비교
- [ ] 모티프 모달의 Recraft V4.1 vector 스테이징 스모크 → 한국어 원문 subject와 `random_seed` 수용, 별도 style/design context 미주입, gradient·텍스트·복잡도 게이트 거부율 기록. V4.1에서 지원하지 않는 `negative_prompt`·`controls.no_text`가 전송되지 않는지 함께 확인한다(V2/V3 호환 경로만 조건부 전송). 생성 SVG의 원본 색상이 저장·검색·디자인 배치까지 유지되는지, 디자인 생성의 catalog miss에서는 Recraft 호출·예산 변화가 없는지도 확인
- [ ] Recraft 모티프 승인 게이트 스테이징 리허설 → 신규 행이 `pending`이고 요청 세션의 ID 직접 렌더는 유지되는지, 다른 사용자 검색·grounding·variant 풀과 registry fingerprint에서는 빠지는지 확인. admin 승인 시 즉시 노출·fingerprint 변경, 거절/승인 회수 시 즉시 제외, manager mutation 403을 함께 검증
- [ ] E2E: 소셜 로그인 4종 / 주문·결제·클레임 / 생성(첫 생성 → 구성 수정 → 모티프 검색·명시적 생성·교체 → 이력 되돌리기 → finalize 큐 → 결과 수신) — *로컬 fake-gcs + inline finalize의 예시→실사화→완성본 조회는 2026-08-04 통과. 스테이징 Cloud Tasks 경로와 전체 시나리오는 남음.*
- [ ] 디자인 첫 진입 예시 큐레이션 — *기본 6종은 `apps/worker/scripts/seed_design_examples.py`(외부 API 없이 gallery-v1 플랜을 결정론 컴파일)가 게시 상태로 시드한다. 그 위에 실제 run을 `/admin/design-examples`에서 run ID로 등록·게시해 큐레이션을 보강한다. 게시 예시가 0건이면 store `/design` 첫 진입이 기존 빈 상태 문구로 폴백한다(비로그인 포함).*
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정
- [ ] OpenAI·Recraft 국외 처리 문구와 실제 전송 항목 검토 → Recraft 계정의 모델 학습 opt-out 또는 별도 DPA, provider별 보존기간·예외를 privacy owner와 법률 검토자가 확인
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
