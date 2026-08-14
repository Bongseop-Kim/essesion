# 기존 → 새 스키마 매핑

기존 도메인 의미를 검토하고 "재설계가 기능 개편으로 번지는 것"을 막기 위한 **설계 기록**이다.
실행 가능한 데이터 이관 계약이 아니다.

기존 = YeongSeon Supabase(`supabase/schemas` + migrations) · 새 = `db/src/db/models` (42개 테이블,
베이스라인 `f8c3b2a19d47` → 현재 head `c7a8d2f1b604`).

## 1. 승계 테이블

| 기존 | 새 | 변환·비고 |
|---|---|---|
| auth.users + profiles | **users** (병합) | id·email·created_at 승계 + profiles 전 컬럼 병합. 비밀번호 해시 이관 없음, 기존 유저 연결은 재로그인 시 best-effort. email nullable + 부분 unique(카카오 이메일 미동의 대비). password_hash는 id/pw 테스트 로그인 전용. soft-delete 보존 기준은 `deleted_at` |
| auth.identities | **user_identities** (신규) | provider(google/kakao/apple/naver) + provider_user_id 복합 unique |
| (Supabase 세션) | **refresh_tokens** (신규) | JWT refresh 회전. 컷오버 시 전원 재로그인이므로 이관 없음 |
| phone_verifications | 동일 | expires_at DB default 제거 — api가 설정. 재전송 제한·시도 횟수 락아웃도 api |
| shipping_addresses | 동일 | FK auth.users→users(CASCADE) |
| products / product_options / product_likes | 동일 | serial→identity. 상품코드 채번 트리거 → api |
| coupons / user_coupons | 동일 | user_coupons unique(user_id, coupon_id) 유지 |
| cart_items | 동일 | item_id = 클라이언트 합성 키, unique(user_id, item_id) |
| orders | 동일 | 한국어 상태 17종·주문타입 5종 CHECK, 부분 인덱스 3종(스케줄러용) 유지. payment_group_id 인덱스 추가 |
| order_items | 동일 | line_discount_amount 포함 |
| order_status_logs / claim_status_logs / claim_notification_logs / quote_request_status_logs | 동일 | changed_by는 SET NULL |
| claims | 동일 | 부분 unique 2종(아이템·타입당 활성 1 / 주문당 진행중 1) 유지 |
| inquiries / quote_requests | 동일 | quote_requests의 updated_at NOT NULL화 |
| repair_pickup_requests / repair_shipping_receipts | 동일 | — |
| admin_settings / pricing_constants | 동일 | updated_by → SET NULL. 수선 단가는 자동/폭/복원/자동복합/폭+복원 5키 |
| notification_preference_logs | 동일 | — |
| design_tokens | 동일 | 원장 의미(amount±, type, token_class, 만료) 보존. work_id = 생성 작업 멱등 키(FK 없는 text) |
| token_purchases | 동일 | — |
| images | **재설계** | url·file_id·folder(ImageKit) → object_key(GCS). 2단계 삭제·expires_at·부분 unique 유지. 비회원 수선 업로드용 claim_token_hash/content_type/size_bytes/upload_completed_at 추가, 미귀속 이미지는 24시간 후 정리 |
| motifs | 동일 | 도메인 의미 유지. OpenAI `vector(1536)` 한 컬럼 + HNSW(vector_cosine_ops) 인덱스 |
| seamless_generation_logs | 동일 | admin 로그 뷰어 + SVG 재-export system of record |
| seamless_sessions | **design_sessions** (재설계) | thread_id(text PK)→id(uuid). status/seed/colorway/registry_version/current_intent 승계, user_id NOT NULL화. 예산 카운터 `motif_generation_used` 추가 — 프로세스-로컬 budget을 Postgres 공유 카운터로 대체 |

## 2. 신규 테이블 (기존 없음)

| 새 테이블 | 역할 |
|---|---|
| design_session_turns / design_turn_attachments | API 소유 대화 이력. 첨부는 사용한 concrete motif ID·이름·순서만 저장 |
| generation_jobs | finalize/export 비동기 잡 상태 폴링: kind/status/params/result/request_id/attempts |
| user_motifs | 사용자 소유 private motif 링크 (계정당 100개 상한) |
| design_examples | store `/design` 첫 진입 갤러리 큐레이션 — run 포인터만 들고 published·ordinal로 노출 |
| authoring_examples | Plan v3 RAG 시범 — bootstrap / authored / promoted 통합 보관, active 행만 런타임이 읽음 |
| authoring_promotion_candidates | 매일 배치가 만든 승격 후보와 관리자 판정 상태 |
| payment_incidents | Toss 대사 불일치(amount_mismatch / mixed_state / partial_cancel) 기록 |
| manual_orders | 관리자 수기 주문 — 접수·결제·확인 3플래그와 items JSONB |
| reviews | 구매확정 후 작성하는 주문·주문항목 단위 후기 |
| admin_operation_logs | 관리자 mutation 감사 — operation_id 멱등, before/after 스냅샷, request_id |

## 3. 드롭 (신규 DB에 만들지 않음)

`product_like_counts`(집계 트리거 → COUNT 쿼리) · `checkpoints` 4종(LangGraph 미승계 →
`design_session_turns`) · `ai_generation_logs` · `design_chat_*` · `design_generations*` ·
`quote_request_contact_migration_audit` · 뷰 19종(전부 api 조회 쿼리로).

공통 변환: `auth.users(id)` FK → `users(id)`. updated_at 트리거 → SQLAlchemy onupdate(모든 쓰기
api 경유 전제). enum은 `user_role`만 유지, 나머지 상태값은 text + named CHECK.

## 4. DB 함수·트리거 → api 모듈

DB 함수·트리거·뷰·RLS를 신규 DB에 두지 않는다. 기존 60여 개의 새 소유자는 다음과 같다.

| 기존 그룹 | 새 소유자 | 보존한 의미 |
|---|---|---|
| 채번 4종(order/token/claim/quote) + 상품코드 트리거 | api 각 도메인 | `{ORD\|TKN\|CLM\|QUO}-YYYYMMDD-NNN`, `pg_advisory_xact_lock` 직렬화 |
| updated_at 트리거 17종 | SQLAlchemy onupdate | — |
| 토큰 원장 RPC 10종(balance/use/refund/plans/order/refund 승인) | api tokens | 만료 필터, paid 우선 차감, advisory lock |
| 가입 트리거(초기 토큰·프로필) | api auth | `admin_settings.design_token_initial_grant` |
| `is_admin` + RLS 전체 | api 인가 3규칙 | 상품·찜 공개 조회 / owner-only / admin 역할 |
| 주문 트랜잭션 6종(create 3종·구매확정·금액 계산) | api orders | 서버 가격 계산과 row/advisory lock 순서 |
| 결제 RPC 3종(confirm/lock/unlock) | api payments | Toss 재조회 재검증 + 이벤트 멱등 |
| claim·quote·cart·배송지·상품옵션 RPC | api 각 도메인 | — |
| 이미지 등록·만료 트리거·수선 접수 | api images·repairs | ImageKit → GCS 서명 URL |
| admin 통계·로그 RPC, 뷰 19종 | api admin | 쿼리로 대체 |
| 정리 배치 4종 + `cleanup-expired-images` 엣지펑션 | Cloud Scheduler → api `/batch/*` | 부분 인덱스 3종이 스캔 대상 |

## 5. Supabase Edge Function → 새 소유자

| 기존 Edge Function | 새 소유자 |
|---|---|
| `create-order` · `create-custom-order` · `create-sample-order` | api orders |
| `confirm-payment` | api payments (provider 재조회와 멱등 대사 포함) |
| `cancel-token-payment` | api tokens (관리자 승인 시 Toss cancel + 원장 반영) |
| `create-quote-request` · `notify-claim` | api quotes · claims |
| `send-phone-verification` · `verify-phone` | api auth + Solapi |
| `delete-account` | api users |
| `cleanup-expired-images` | Cloud Scheduler → api batch |
| `imagekit-auth` | 제거 — GCS signed URL |
| `generate-tile` 계열 | 제거 — 생성은 seamless worker, 과금·잔액은 api |

## 6. 초기화 정책

외부 환경에 배포된 적이 없으므로 기존 Supabase 데이터나 중간 개발 스키마를 새 DB로 변환하지
않는다. 이전 개발 DB는 drop/recreate하고 베이스라인부터 head까지 적용한다. production도 빈 DB를
head까지 올린 뒤 관리자·설정·공개 motif·authoring example을 초기 입력한다.
