# 운영자 직접 작업 목록

코드·IaC·CI로 자동화할 수 없는 계정·콘솔 작업과, 운영자가 직접 판정해야 하는 게이트.
**이 문서는 순서와 통과 판정만 담는다. 실행 명령은 [infra/README.md](../infra/README.md)가 정본이다.**
진행 상태는 [CHECKLIST.md](./CHECKLIST.md)에서 추적한다.

## A. Production 인프라 개통 (순서 고정)

| # | 작업 | 주체 | 통과 판정 |
|---|---|---|---|
| A1 | GCP 프로젝트 생성·청구 연결·tfstate 버킷 ([명령](../infra/README.md#부트스트랩)) | 사용자(gcloud) | 버킷 생성 성공. 예산 알림을 위해 실행 계정에 **Billing Account Administrator/Costs Manager** 필요 |
| A2 | `production.tfvars` 작성 → 1차 target apply | 사용자(tofu) | 시크릿 컨테이너·Cloud SQL 사용자 생성 |
| A3 | Sentry 프로젝트 3개 생성 → **전 시크릿 값 주입** ([명령](../infra/README.md#시크릿-값-주입)) | 사용자 | `gcloud secrets versions list`로 **13개 전부** 버전 ≥1. 하나라도 비면 A4의 서비스 리비전이 기동 실패 |
| A4 | 전체 apply | 사용자(tofu) | Cloud Run 3서비스 + migrate job, Cloud SQL(PITR), Cloud Tasks, **Scheduler 배치 5종**, GCS, IAM/WIF, 예산 알림 + uptime check 생성. GCP가 보낸 알림 채널 **인증 메일을 클릭**해야 예산·uptime 알림이 실제로 도착한다 |
| A5 | Cloudflare zone·api 프록시 **선개통** ([순서](../infra/README.md#cloudflare--api-프록시-선개통)) | 사용자(wrangler `login` 또는 `CLOUDFLARE_API_TOKEN`) | 프록시 배포 완료 + WAF·레이트리밋 설정. **이 단계를 건너뛰고 API를 배포하지 않는다** — deploy 워크플로우 마지막 스텝이 공개 `/readyz` 200을 요구하므로, 프록시 없이 main에 머지하면 migrate와 Cloud Run 3서비스 배포가 **이미 끝난 뒤** 워크플로우만 실패한다 |
| A6 | GitHub vars/secrets 설정 ([명령](../infra/README.md#github-actions-연결-apply-후-1회)) | 사용자(gh) | `VITE_*` **5개** 전부 설정. Renovate GitHub App 설치가 아직이면 이때 함께 |

**A2 주의** — `public_api_origin`은 `https://api.essesion.shop`으로 유지한다. `api_extra_env`에는
첫 apply부터 `FRONTEND_ORIGIN`·`ADMIN_FRONTEND_ORIGIN`·두 origin의 `CORS_ORIGINS`·OAuth client id를
넣는다. 비로컬 API가 localhost로 redirect하거나 관리자 origin을 잘못 판정하는 중간 리비전을 만들지 않는다.

## B. 배포 실행·확인 (A 완료 후)

1. **main에 머지/푸시** → 해당 SHA의 push CI 성공 → deploy 워크플로우가 단일 큐에서
   이미지 빌드 → migrate job → api·worker-generate·worker-finalize 배포 → Cloudflare workers 재배포.
   migration 시작이 point-of-no-return이다. 수동 dispatch는 없고, 필요하면 성공한 CI run의 deploy를 rerun한다.
2. **Readiness** ([명령](../infra/README.md#readiness-확인)) — api `/readyz` 200 + 전 capability `ready/real/oidc`,
   두 worker 비공개 `/readyz`가 `database=ready`, 공개 `/products` 200 · `run.app` 직통 403.
   GCS 버킷·Cloud Tasks 값 누락은 capability가 아니라 **revision 기동 실패**로 드러나므로 Cloud Run 로그를 먼저 본다.
3. **배치** — `batch-cancel-stale-orders` 수동 실행 → api 로그 200. 401이면 배치 5종이 전원 조용히 실패하는 상태다.
   audience는 scheduler와 api env가 같은 `local.batch_audience`를 쓰므로 **실제 run.app URL과 달라도 정상**이다
   (api는 자기 URL이 아니라 설정 문자열로 검증 — `deps.verify_batch_token`). URL 대조는 필요 없다.
4. **초기 데이터** — 먼저 [운영자 단말 DB 접속](../infra/README.md#운영자-단말에서-db-접속)을
   연결한다(`database-url` 시크릿은 Cloud Run 전용 소켓 DSN이라 단말에서 그대로 못 쓴다).
   [관리자 생성](../infra/README.md#초기-관리자-bootstrap세션-복구) → [시드](../infra/README.md#production-데이터-시드):
   motif → design examples(첫 진입 갤러리) → 임베딩 → authoring starter → eval.
   `backfill_motif_tags.py`는 production에서 돌리지 않는다(백필할 기존 데이터 없음, 유료 호출).
   임베딩 출력이 `embedded=<total>/<total>`인지 배포 기록에 남기고, admin Motif 상세에서
   symbol의 concrete paint 표본을 확인한다.
5. **외부 콘솔 등록** — 프록시 검증 후 공개 API 도메인만 등록한다. Cloud Run URL은 등록하지 않는다.
   - Toss: 웹훅 `https://api.essesion.shop/payments/webhook`, successUrl 콜백 경로
   - Google·Kakao·Apple: redirect URI `https://api.essesion.shop/auth/{provider}/callback`. Apple은 Services ID + `.p8` 키 등록이 선행이며 Return URL이 POST 콜백이다. **네이버는 이후 일정** — 등록 전까지 store가 "준비 중"으로 게이팅한다(`AUTH_PROVIDERS[].comingSoon`)
   - Solapi 발신번호·PF ID·템플릿 3종은 `production.tfvars`의 `api_extra_env`로

## C. 프론트 route 확인

- `app.`·`admin.` custom-domain route는 각 `wrangler.jsonc`에 고정 — 배포 결과에서 연결을 확인한다.
  도메인을 바꿀 때는 대시보드에서 임시 수정하지 말고 설정 파일과 origin/CORS를 같은 변경으로 갱신한다.
- `curl -I https://admin.essesion.shop/login` → `frame-ancestors 'none'`, `Referrer-Policy: no-referrer`,
  `X-Frame-Options: DENY` 확인.
- api는 비용을 위해 `api_min_instances=0`으로 시작하고, cold start가 실제 운영 지표를 훼손할 때만 1로 올린다.

## D. Admin production 운영 확인

1. 공개 `/readyz`와 admin 대시보드에서 `finalize_tasks=real`, `batch_auth=oidc`, `edge_proxy=ready` 확인.
   다른 capability가 `unavailable`이면 관련 mutation을 진행하지 않는다.
2. 관리자 role 변경·비활성화·비밀번호 유출 대응은 `bootstrap_admin.py revoke-sessions` / `reset-password`.
   access token은 발급 시 role 일치를, admin token은 `session_kind=admin`도 요구하므로 역할 변경 직후
   기존 access 요청은 401이며 refresh session은 별도로 폐기한다.
3. **Toss confirm/refund가 timeout·5xx로 끝나면 같은 요청을 수동 재시도하지 않는다.**
   `/incidents`에서 open incident를 확인하고 서버가 보관한 정확한 lookup key로 Toss를 재조회한다
   (API 응답의 key는 redacted).
   - `amount_mismatch` — 같은 payment/group의 provider 상태가 `CANCELED`일 때만 내부 주문 취소·쿠폰 복원·토큰 회수로 종결. 과거 key와 현재 주문 key가 다르면 open으로 남긴다
   - `mixed_state` — 내부 상태와 provider 상태가 이미 일치한 뒤 재대사해야 닫힌다. 메모만으로는 불가
   - `partial_cancel` — 최신 provider 증거·금액 검증·관리자 메모를 모두 갖춘 예외적 수동 해결 대상
4. 이미지 업로드는 API가 돌려준 `x-goog-if-generation-match: 0` 헤더를 포함해 한 번만 PUT하고,
   custom/sample 주문 참고 이미지는 완료된 `upload_id`만 주문 body에 전달한다.

## E. Production 외부 연동·데이터 검증

1. 빈 production DB에 migrate job이 베이스라인 `f8c3b2a19d47`부터 현재 head `c7a8d2f1b604`까지
   순차 적용했는지 [DB 접속](../infra/README.md#운영자-단말에서-db-접속) 후 확인한다. 알 수 없는 개발 revision이 발견되면 변환을 시도하지 말고 DB를 재생성한다.
2. 실제 Toss sandbox, 소셜 로그인, Solapi, generate → finalize Cloud Tasks 흐름과 주문·클레임 E2E.
   Apple은 코드가 이미 있으므로 **콘솔 등록 완료 + 실제 로그인 성공**으로 판정한다.
   네이버를 열 때는 콘솔 등록 + `naver-client-*` 시크릿 주입 후 `providers.ts`의 `comingSoon`을 지운다.
3. 상품 이미지 업로드와 finalize 메모리·지연을 실측해 dpi·인스턴스 상한을 확정한다.
4. **컷오버 차단 게이트 — 개인정보**: 회원 탈퇴 뒤에도 주문 snapshot, 주문 item/claim/refund JSON,
   견적·문의·수선 배송 정보, 이미지·디자인 prompt/job payload, 관리자 로그에 역사성 개인정보가 남는다.
   seamless 생성 로그에는 사용자 FK가 없고, 공개 GPT Image motif의 최초 유입 사용자·세션 provenance는
   nullable이며 회원·세션 삭제 시 `SET NULL`되므로 소유권이나 영구 회수 수단이 아니다. 공개 preview도 같다.
   필드별 보존 목적·기간·접근 통제·분리 저장·만료 시 익명화/삭제 배치를 privacy owner와 법률 검토자가
   승인하고, 샘플 데이터로 purge/anonymization과 복구 불가성을 검증하기 전에는 컷오버하지 않는다.
5. **컷오버 차단 게이트 — OpenAI 국외 처리**: 디자인 저작·임베딩·명시적 모티프 생성으로 전달하는 데이터가
   현재 개인정보처리방침과 일치하는지 확인하고, OpenAI 계정의 모델 학습 정책 또는 별도 DPA와 provider
   보존기간·예외를 privacy owner와 법률 검토자가 승인하기 전에는 컷오버하지 않는다.

## F. 프로덕션 컷오버

1. 단일 production project/tfstate/tfvars와 Secret Manager 값이 정본인지 `tofu plan`과 함께 재확인.
2. provider redirect URI와 Toss webhook이 공개 production API 도메인인지 확인하고 E의 게이트를 다시 통과.
3. 쓰기 동결 → 최종 데이터 이관·매핑 검증 → DNS 전환 → 전원 재로그인 공지.
   DNS 원복과 동결 유지 조건을 포함한 rollback runbook을 **먼저** 승인한다.
4. 안정화 지표와 데이터 대조가 끝난 뒤에만 Supabase 프로젝트를 해지한다.

## 완료 시

A~B가 끝나면 CHECKLIST의 OpenTofu·예산/uptime·Sentry·Secret Manager·worker 배포·Alembic production
적용 항목을, C가 끝나면 Cloudflare Workers 배포를 갱신한다. D·E·F는 증거를 첨부한 뒤에만 체크한다.
