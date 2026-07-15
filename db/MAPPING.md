# 기존 → 새 스키마 매핑 표

변환 스크립트(`db/scripts/migrate_data.py`)·동작 검증·"재설계가 기능 개편으로 번지는 것"을 막는 기준 문서 (CHECKLIST 2단계). 기존 = YeongSeon Supabase(`supabase/schemas` + migrations), 새 = `db/src/db/models` (베이스라인 리비전 `a658f96021f4`).

## 1. 테이블 매핑

| 기존 | 새 | 변환·비고 |
|---|---|---|
| auth.users + profiles | **users** (병합) | id·email·created_at 승계 + profiles 전 컬럼 병합. 비밀번호 해시 이관 없음(전원 소셜 — ARCHITECTURE §5), 기존 유저 연결은 재로그인 시 best-effort. email nullable+부분 unique(카카오 이메일 미동의 대비). password_hash는 id/pw 테스트 로그인 전용. soft-delete의 보존 기간 기준은 `deleted_at`에 별도 기록 |
| auth.identities | **user_identities** (신규) | provider(google/kakao/apple/naver) + provider_user_id 복합 unique |
| (Supabase 세션) | **refresh_tokens** (신규) | JWT refresh 회전. 컷오버 시 전원 재로그인이므로 이관 없음 |
| phone_verifications | phone_verifications | 동일. expires_at DB default(now+5분) 제거 — api가 설정. 재전송 60초/일 5회 제한도 api |
| shipping_addresses | shipping_addresses | 동일. FK auth.users→users(CASCADE) |
| products | products | 동일. serial→identity. 상품코드 채번 트리거(auto_generate_product_code)→api |
| product_options | product_options | 동일 |
| product_likes | product_likes | 동일. unique(user_id, product_id) 유지 |
| **product_like_counts** | — (드롭) | 집계 테이블+트리거 제거 → 상품 목록 쿼리에서 COUNT. 유저 극소 규모 |
| coupons / user_coupons | 동일 | user_coupons unique(user_id, coupon_id) 유지 |
| cart_items | cart_items | 동일. item_id = 클라이언트 합성 키 유지, unique(user_id, item_id) |
| orders | orders | 동일 — 한국어 상태 17종·주문타입 5종 CHECK, 부분 인덱스 3종(스케줄러용) 유지. payment_group_id 일반 인덱스 추가 |
| order_items | order_items | 동일 (line_discount_amount 포함) |
| order_status_logs / claim_status_logs / claim_notification_logs / quote_request_status_logs | 동일 | changed_by는 SET NULL |
| claims | claims | 동일. 부분 unique 2종(아이템·타입당 활성 1 / 주문당 진행중 1) 유지 |
| inquiries | inquiries | 동일 (제목·본문 길이 CHECK 포함) |
| quote_requests | quote_requests | 동일. updated_at NOT NULL화 |
| **quote_request_contact_migration_audit** | — (드롭) | 일회성 마이그레이션 감사 잔재 |
| repair_pickup_requests / repair_shipping_receipts | 동일 | — |
| admin_settings / pricing_constants | 동일 | updated_by → SET NULL. 수선 단가는 자동/폭/복원/자동복합/폭+복원 5키로 재구성 |
| notification_preference_logs | 동일 | — |
| design_tokens | design_tokens | 동일 — 원장 의미(amount±, type, token_class, 만료) 보존. work_id = 생성 작업 멱등 키(구 ai_generation_logs.work_id FK였으나 대상 드롭 → FK 없는 text 유지) |
| token_purchases | token_purchases | 동일 |
| images | **images** (재설계) | url·file_id·folder(ImageKit) → object_key(GCS 업로드 버킷). 2단계 삭제·expires_at·부분 unique 유지. 비회원 수선 업로드를 위해 claim_token_hash/content_type/size_bytes/upload_completed_at 추가, 미귀속·장바구니 제거 이미지는 24시간 후 정리. 견적 종료 시 90일 만료 트리거 → api 로직 |
| motifs | motifs | 동일. embedding을 vector(1536) 고정(text-embedding-3-small) — 기존 런타임 vector_dims 가드 대체. extensions.vector → public vector. HNSW 인덱스 없음(결정론 위해 seq scan — 규모 커지면 후속 리비전) |
| seamless_generation_logs | seamless_generation_logs | 동일 — admin 로그 뷰어 + SVG 재-export system of record |
| seamless_sessions | **design_sessions** (재설계) | thread_id(text PK)→id(uuid). status/seed/colorway/registry_version/current_intent 승계, user_id NOT NULL화. **예산 카운터 recraft_used·finalize_used 추가** — 프로세스-로컬 budget 대체(Postgres 공유 카운터, ARCHITECTURE §7) |
| **checkpoints / checkpoint_blobs / checkpoint_writes / checkpoint_migrations** | — (드롭) | LangGraph 미승계. 턴 이력은 **design_session_turns**(신규, session_id+seq unique)로 api가 소유 |
| **ai_generation_logs** | — (드롭) | generate-tile 잔재 — seamless 워커가 대체 |
| **design_chat_sessions / design_chat_messages** | — (드롭) | generate-tile 기반 /design 구현체 — /design은 신규 설계(보존 예외) |
| **design_generations / design_generation_variants** | — (드롭) | 동일 (마이그레이션 `20260512000034`에만 존재하던 테이블) |
| (없음) | **generation_jobs** (신규) | finalize/export 비동기 잡(Cloud Tasks) 상태 폴링: kind/status/params/result/request_id/attempts |
| 뷰 19종 | — (드롭) | 전부 api 조회 쿼리로 (§3) |

공통 변환: `auth.users(id)` 참조 FK → `users(id)`. updated_at 트리거 → SQLAlchemy onupdate(모든 쓰기 api 경유 전제). enum은 user_role만 유지, 나머지 상태값은 text+CHECK 그대로.

## 2. DB 함수·트리거 → 새 소유자 (api 모듈)

| 기존 (DB 함수/트리거/RPC) | 새 소유자 | 비고 |
|---|---|---|
| generate_order_number / generate_token_order_number / generate_claim_number / generate_quote_number | api orders·tokens·claims·quotes | `ORD|TKN|CLM|QUO-YYYYMMDD-NNN`, pg_advisory_xact_lock 방식 그대로 재현 |
| auto_generate_product_code (트리거) | api products | `{3F|SF|KN|BT|XX}-YYYYMMDD-NNN` |
| update_updated_at_column 계열 트리거 17종 | SQLAlchemy onupdate | DB 트리거 없음 |
| sync_product_like_counts (트리거) | — 제거 | COUNT 쿼리 대체 |
| get_design_token_balance / use_design_tokens / refund_design_tokens / manage_design_tokens_admin / get_token_plans / create_token_order / request·cancel·approve_token_refund / get_refundable_token_orders | api tokens | 만료 필터(`expires_at IS NULL OR > now()`)·paid 우선 차감·advisory lock 의미 보존 |
| grant_initial_design_tokens (가입 트리거) | api auth 가입 처리 | admin_settings `design_token_initial_grant`(기본 30) |
| handle_new_auth_user_profile (트리거) | api auth | users 단일 테이블이라 소멸 |
| is_admin + RLS 전체 | api 인가 3규칙 | 상품·찜 공개 조회 / owner-only / admin 역할 — testcontainers 403 테스트(3단계) |
| create_order_txn / create_custom_order_txn / create_sample_order_txn / customer_confirm_purchase / calculate_custom_order_amounts / calculate_refund_amount | api orders | 주문 3종 트랜잭션 |
| confirm_payment_orders / lock·unlock_payment_orders / get_sample_coupon_and_pricing | api payments | Toss 웹훅 서명 검증 + 이벤트 ID 멱등(3단계) |
| create_claim / cancel_claim / admin_update_claim_status | api claims | — |
| create_quote_request_txn / admin_update_quote_request_status | api quotes | — |
| replace_cart_items / remove_cart_items_by_ids / get_cart_items | api cart | — |
| upsert_shipping_address / replace_product_options / get_products_by_ids / product_is_liked_rpc | api 각 도메인 | — |
| register_image / register_reform_upload / register_repair_shipping_upload / set_image_expiry_on_quote_complete(트리거) / submit_repair_tracking / submit_repair_no_tracking | api images·repairs | 업로드는 GCS 서명 URL 발급으로 대체(ImageKit 제거) |
| create_phone_verification / set_notification_preferences / set_marketing_consent | api auth·users | — |
| admin_update_order_status / admin_update_order_tracking / admin_bulk_issue_coupons / admin_revoke_coupons_* / admin_get_* 통계·로그 RPC | api admin | 뷰·통계는 쿼리로 |
| auto_confirm_delivered_orders / cancel_stale_pending_orders / delete_old_claim_notification_logs / cleanup-expired-images(엣지펑션) | Cloud Scheduler → api 배치 엔드포인트 | 부분 인덱스 3종이 스캔 대상 |

엣지 펑션 13종의 매핑은 ARCHITECTURE §4 표를 따른다 (generate-tile·imagekit-auth = 제거).

## 3. 데이터 이관 정책 (§6)

| 분류 | 대상 | 처리 |
|---|---|---|
| **이관 (구현됨)** | products, product_options, coupons, pricing_constants, admin_settings, motifs | `migrate_data.py` — 유저 무관, updated_by는 NULL로 |
| **조건부 (스텁)** | shipping_addresses, orders 계열, claims 계열, user_coupons, cart_items, inquiries, quote_requests 계열, design_tokens, token_purchases, images 메타 | 3단계에서 기존 유저 매칭(provider ID/이메일 best-effort) 확정 후 구현. 매칭 포기 시 이관 안 함(사용자 확정 — 주문 이력 연결 포기) |
| **이관 안 함** | auth.users/profiles(재로그인), Storage 객체(수동 재등록), phone_verifications, checkpoint 4종, ai_generation_logs, design_chat_*, design_generations(+variants), product_like_counts, quote_request_contact_migration_audit, seamless_sessions(활성 세션 이관 무의미) | — |
| **보류** | seamless_generation_logs | 과거 로그 이관 가치 낮음 — 리허설 단계에서 결정 |
