# 실행 체크리스트

기준 문서: [ARCHITECTURE.md](../ARCHITECTURE.md). 실행 순서와 판정은 [OPERATOR-CHECKLIST.md](./OPERATOR-CHECKLIST.md).
완료 기록은 Git 이력에 남기고, 이 문서에는 **미완료 항목만** 유지한다.

## 1. 인프라 개통

- [ ] `production.tfvars` 소재 확인·백업 — gitignore라 레포에 없고 작업 머신에도 없다. 인프라 설정의 정본(origin·CORS·OAuth client id·Solapi)이라 분실하면 다음 apply 때 전체를 다시 만들어야 한다
- [ ] Solapi 템플릿 2종 IaC 반영 — `SOLAPI_TEMPLATE_PHONE_CODE`·`SOLAPI_TEMPLATE_PAYMENT_DONE`는 `gcloud run services update`로 직접 넣은 드리프트 상태다. tfvars 복구 시 `api_extra_env`에 함께 넣지 않으면 apply가 지운다 *([기록](./reviews/production-bootstrap-2026-08-15.md))*
- [ ] 네이버·Apple 자리표시자 교체 — `naver-client-secret`과 `NAVER_CLIENT_ID`, Apple `.p8`는 콘솔 등록 후 실제 값으로. 비우면 `/readyz`가 503이라 자리표시자로 채워둔 상태다

## 2. Production 외부 연동·운영 검증

- [ ] 상품 등록 — production `products`가 0행이라 store 목록이 비어 있다. admin `/products`에서 직접 등록한다(시드 상품은 로컬 전용)
- [ ] admin Motif 상세에서 symbol의 concrete paint 표본 확인 — 시드 자체는 완료(motif 97/97, example 25/25, 갤러리 6건 게시)
- [ ] authoring expected family recall 회귀 확인 — production eval에서 **0.667**(20/30), 2026-08-03 기준선은 0.83(25/30). compile·retrieval은 30/30이고 시도·p95는 오히려 개선(1.27→1.07, 19.7s→11.2s), 모델·코퍼스도 동일하다. 표본 변동인지 실제 회귀인지 1회 재실행으로 가른다 *([기록](./reviews/production-bootstrap-2026-08-15.md))*
- [ ] 모티프 모달 GPT Image 2 low + VTracer medium production 스모크 — 한국어 원문 subject만 전달, 사방 10% 여백·원본 캔버스 비율·플랫 색면·가변 색상·SVG 복잡도 예산. 사진 업로드도 같은 경로로 다색 모티프를 보존하는지, 디자인 생성의 catalog miss에서 GPT Image 호출·예산 변화가 없는지 확인
- [ ] GPT Image 모티프 승인 게이트 검증 — 신규 행이 `source=gpt_image`·`pending`이고 요청 세션의 ID 직접 렌더만 유지, 타 사용자 검색·grounding·registry fingerprint에서 제외. 승인 시 즉시 노출·fingerprint 변경, 거절/회수 시 즉시 제외, manager mutation 403
- [ ] 이전 모티프 생성 provider credential 폐기 — apply에서 Secret Manager 리소스·worker env·IAM 제거 확인 후 외부 API key 폐기
- [ ] E2E — 소셜 로그인(Google·Kakao·Apple / 네이버는 store에서 "준비 중" 게이팅, 이후 일정) / 주문·결제·클레임 / 생성 전체 플로우. *로컬 전체 점검은 [pre-deploy-e2e-followups](./reviews/pre-deploy-e2e-followups-2026-08-14.md)에서 PASS. 남은 것: 유료 authoring과 그 종속 디자인 lane · 실제 모바일 viewport · production Cloud Tasks · 소셜 로그인 · 실 Toss*
- [ ] 디자인 첫 진입 예시 큐레이션 — 기본 6종은 `seed_design_examples.py`가 게시 상태로 시드. 그 위에 실제 run을 admin `/design-examples`에서 run ID로 등록·게시해 보강한다. 게시 예시가 0건이면 store `/design` 첫 진입이 빈 상태로 폴백한다
- [ ] finalize 메모리·지연 실측 → 리소스·dpi 상한 조정
- [ ] **컷오버 차단** — OpenAI 국외 처리 문구와 실제 전송 항목을 privacy owner·법률 검토자가 승인
- [ ] **컷오버 차단** — 회원 탈퇴 후 역사성 개인정보의 보존 목적·기간·접근 통제·분리 저장·익명화/삭제 정책 승인
- [ ] **컷오버 차단** — 샘플 데이터로 purge·익명화 배치와 복구 불가성 검증

## 3. 컷오버

- [ ] provider redirect URI·Toss webhook **재확인** — 등록 자체는 컷오버가 아니라 [OPERATOR-CHECKLIST B-5](./OPERATOR-CHECKLIST.md)에서 끝낸다. 소셜 로그인이 유일한 가입 경로라 redirect URI가 없으면 새 store에 아무도 로그인하지 못하므로 배포 직후가 맞다. 여기서는 값이 `api.essesion.shop`인지만 본다(run.app 직통 금지)
- [ ] DNS 전환 + 전원 재로그인 공지
- [ ] 롤백 runbook 승인 (DNS 원복 — 동결 해제 전까지 데이터 무손실). 외부 콘솔 설정은 DNS 원복으로 되돌아가지 않으니 웹훅 URL 원복 절차를 runbook에 포함한다
- [ ] 안정화 확인 후 Supabase 프로젝트 해지
