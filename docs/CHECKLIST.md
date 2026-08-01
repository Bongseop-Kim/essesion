# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md) (§8 마이그레이션 순서). 완료 기록은 Git 이력에 남기고, 이 문서에는 미완료 항목만 유지한다.

## 1. 골격

- [ ] OpenTofu — **스테이징 별도 GCP 프로젝트**: Cloud Run×3, Cloud Tasks, Cloud SQL(**PITR 활성화**), GCS, Artifact Registry, IAM, WIF — *IaC 작성 완료. `infra/README.md` 부트스트랩 후 `tofu apply`*
- [ ] Cloudflare: 서브도메인(app/admin/api) + API 프록시(WAF·레이트리밋) 개통 — *첫 API 배포 전에 `api.essesion.shop` secret·WAF와 `/design/ideas` IP 기반 edge rate limit을 적용 (`infra/cloudflare/README.md`, `docs/OPERATOR-CHECKLIST.md` §A4·C).*
- [ ] GCP 예산 알림 1개 + uptime check 1개 — *tofu apply 시 생성*
- [ ] Sentry 프로젝트(api·worker·store) 생성 및 DSN 주입
- [ ] Secret Manager에 provider 값과 환경별 jwt/session/edge secret 주입

## 2. 스키마 재설계

- [ ] Alembic 스테이징 적용 — *첫 배포의 migrate Cloud Run job 성공과 단일 head 확인*
- [ ] 로컬·스테이징 DB 재생성 — *디자인 재설계가 미배포 베이스라인(`dadd999bf858`)을 직접 고쳤다: `seamless_generation_logs`의 후보 관측 컬럼 4개 삭제 + `candidates`→`design`(단일 객체), `authoring_promotion_candidates.plan_index` 삭제 + `selected_candidate_id`→`design_id`. 기존 볼륨은 새 스키마로 읽히지 않으므로 `docker compose down -v && docker compose up -d` 후 마이그레이션·시드를 다시 돌린다(모티프 카탈로그·저작 예시·임베딩 인덱스 포함).*
- [ ] `admin_settings.design_edit_cost` 행 확인 — *구성 수정 단가(신규 필수 키). 없으면 `/admin/settings`가 503, 구성 수정이 `token_cost_not_configured`. `apps/api/scripts/seed.py`가 기본 2로 시드한다.*

## 4. worker

- [ ] worker-generate + worker-finalize 스테이징 배포 — *tofu와 deploy workflow 작성 완료, 실제 개통만 남음*

## 5. 프론트

- [ ] Cloudflare Workers 배포(Vite build + Wrangler Static Assets) 및 DNS 확인

## 6. 리허설 (스테이징)

- [ ] 빈 스테이징 DB에 단일 베이스라인 적용 → 관리자·motif 초기 입력과 `seed_authoring_examples.py --confirm-live` 실행, motif/example `embedded=total`, 공개 멀티슬롯 `slot_labels`·`slot_parts` 백필의 `eligible/updated` 및 admin 표본 결과 검증
- [ ] Recraft V4.1 vector 스테이징 스모크 → `controls.colors`·`random_seed` 수용, 팔레트 겹침률·gradient 게이트 거부율 기록, 부위 지정 채팅 리컬러의 `color_indices` 길이·슬롯 매핑 표본 검증
- [ ] E2E: 소셜 로그인 4종 / 주문·결제·클레임 / 생성(첫 생성 → 구성 수정 → 이력 되돌리기 → finalize 큐 → 결과 수신)
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정
- [ ] Gemini 참고 사진 처리 지역·학습 사용·로그/abuse monitoring 보존·삭제 제어·DPA·사용자 고지를 실제 계약·프로젝트 설정 기준으로 승인
- [ ] 회원 탈퇴 후 역사성 개인정보 필드별 보존 목적·기간·접근 통제·분리 저장·만료 시 익명화/삭제 정책 승인
- [ ] 주문/클레임/견적/문의/수선/이미지/디자인 job·관리자 로그 샘플로 purge·익명화 배치와 복구 불가성 검증

## 7. 컷오버

- [ ] 프로덕션 GCP 프로젝트 프로비저닝(OpenTofu 재사용)
- [ ] provider redirect URI·Toss webhook URL을 프로덕션 `api.<domain>`에 등록(run.app 직통 금지)
- [ ] 빈 프로덕션 DB에 단일 베이스라인 적용 → 환경별 초기 데이터 입력 검증
- [ ] DNS 전환 + 전원 재로그인 공지
- [ ] 롤백 절차 문서화(DNS 원복 — 동결 해제 전까지 데이터 무손실)
- [ ] 역사성 개인정보 보존·익명화 정책과 자동 배치 승인·검증을 production gate에서 재확인
- [ ] 안정화 확인 후 Supabase 프로젝트 해지
