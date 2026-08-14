# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md). 실행 순서와 판정은 [OPERATOR-CHECKLIST.md](./OPERATOR-CHECKLIST.md).
완료 기록은 Git 이력에 남기고, 이 문서에는 **미완료 항목만** 유지한다.

## 1. 인프라 개통

- [ ] 네이버·Apple 자리표시자 교체 — `naver-client-secret`과 `NAVER_CLIENT_ID`, Apple `.p8`는 콘솔 등록 후 실제 값으로. 비우면 `/readyz`가 503이라 자리표시자로 채워둔 상태다

## 2. 스키마

- [ ] Alembic production 적용 — migrate Cloud Run job 성공과 현재 head `c7a8d2f1b604` 확인. 빈 DB에는 베이스라인 `f8c3b2a19d47` 뒤 리비전 4종(OpenAI 임베딩 전환 → claim status cancel → motif variant group 드롭 → motif view expression 드롭 → 생성 예산 컬럼 rename)이 순서대로 적용된다
- [ ] `admin_settings.design_edit_cost` 행 확인 — 없으면 `/admin/settings`가 503, 구성 수정이 `token_cost_not_configured`

## 3. 배포

- [ ] worker-generate + worker-finalize production 배포
- [ ] Cloudflare Workers 프론트 배포(Vite build + Wrangler Static Assets) 및 DNS 확인

## 4. Production 외부 연동·운영 검증

- [ ] 초기 데이터 입력 — 관리자 → `seed_motifs.py` → `seed_design_examples.py` → `index_motif_embeddings.py --confirm-live` → `seed_authoring_examples.py --confirm-live`. motif/example `embedded=total`과 admin 표본의 SVG 색상 검증. `backfill_motif_tags.py`는 production 미실행(백필할 기존 데이터 없음)
- [ ] `eval_authoring.py --confirm-live` 30건 재평가 → compile 30/30, retrieval 30/30 및 재시도·p95를 2026-08-03 기준선과 비교 *(로컬 역재현 25건은 통과: [design-family-reverse-eval](./reviews/design-family-reverse-eval-2026-08-04.md))*
- [ ] 모티프 모달 GPT Image 2 low + VTracer medium production 스모크 — 한국어 원문 subject만 전달, 사방 10% 여백·원본 캔버스 비율·플랫 색면·가변 색상·SVG 복잡도 예산. 사진 업로드도 같은 경로로 다색 모티프를 보존하는지, 디자인 생성의 catalog miss에서 GPT Image 호출·예산 변화가 없는지 확인
- [ ] GPT Image 모티프 승인 게이트 검증 — 신규 행이 `source=gpt_image`·`pending`이고 요청 세션의 ID 직접 렌더만 유지, 타 사용자 검색·grounding·registry fingerprint에서 제외. 승인 시 즉시 노출·fingerprint 변경, 거절/회수 시 즉시 제외, manager mutation 403
- [ ] 이전 모티프 생성 provider credential 폐기 — apply에서 Secret Manager 리소스·worker env·IAM 제거 확인 후 외부 API key 폐기
- [ ] E2E — 소셜 로그인(Google·Kakao·Apple / 네이버는 store에서 "준비 중" 게이팅, 이후 일정) / 주문·결제·클레임 / 생성 전체 플로우. *로컬 전체 점검은 [pre-deploy-e2e-followups](./reviews/pre-deploy-e2e-followups-2026-08-14.md)에서 PASS. 남은 것: 유료 authoring과 그 종속 디자인 lane · 실제 모바일 viewport · production Cloud Tasks · 소셜 로그인 · 실 Toss*
- [ ] 디자인 첫 진입 예시 큐레이션 — 기본 6종은 `seed_design_examples.py`가 게시 상태로 시드. 그 위에 실제 run을 admin `/design-examples`에서 run ID로 등록·게시해 보강한다. 게시 예시가 0건이면 store `/design` 첫 진입이 빈 상태로 폴백한다
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정
- [ ] **컷오버 차단** — OpenAI 국외 처리 문구와 실제 전송 항목을 privacy owner·법률 검토자가 승인
- [ ] **컷오버 차단** — 회원 탈퇴 후 역사성 개인정보의 보존 목적·기간·접근 통제·분리 저장·익명화/삭제 정책 승인
- [ ] **컷오버 차단** — 샘플 데이터로 purge·익명화 배치와 복구 불가성 검증

## 5. 컷오버

- [ ] provider redirect URI·Toss webhook을 `api.essesion.shop`에 등록 (run.app 직통 금지)
- [ ] DNS 전환 + 전원 재로그인 공지
- [ ] 롤백 runbook 승인 (DNS 원복 — 동결 해제 전까지 데이터 무손실)
- [ ] 안정화 확인 후 Supabase 프로젝트 해지
