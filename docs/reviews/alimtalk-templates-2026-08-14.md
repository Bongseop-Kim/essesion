# 알림톡 2종 추가 (인증번호·결제완료) — 2026-08-14

`docs/plans/alimtalk-templates-2.md` 실행 완료. 가입환영(`KA01TP221025083117992xkz17KyvNbr`)은
소셜 최초 로그인 시점에 전화번호가 없어 훅 위치가 없다고 판단해 제외했다 — 승인 템플릿은 그대로 남아 있으니
쓸 자리가 생기면 그때 붙인다.

## 결과

| 항목 | 결과 |
|---|---|
| 인증번호 SMS → 알림톡(ATA) | `auth/phone.py send_verification` — `template_id`가 있으면 ATA, 없으면 기존 SMS. 실패 처리(레코드 삭제 후 `UpstreamError`) 계약은 그대로. |
| 결제완료 | `payments/service.py _apply_confirmation` 커밋 직후 best-effort 발송. |
| 설정 | `solapi_template_phone_code`·`solapi_template_payment_done`(기본 `""`), `production.tfvars`의 `api_extra_env`에 실 템플릿 ID 2개. **`*.tfvars`는 gitignore라 이 값은 커밋되지 않는다** — 배포자가 자기 로컬 tfvars에 같은 2줄을 넣어야 한다(OPERATOR-CHECKLIST B-5). |
| outbox | 새로 만들지 않았다 — 클레임만 outbox 유지. |

## 훅 위치를 `confirm_payment`에서 옮긴 이유

플랜 초안은 `confirm_payment` 성공 종료 직전이었다. 그 지점은 결제 확정 3경로 중 1개만 덮는다:

- `confirm_payment` — 정상 successUrl 콜백
- `reconcile_from_webhook` DONE — 콜백이 끊긴 결제. **유저가 결제 여부를 모르는, 알림이 가장 필요한 경로**
- `reconcile_confirmed_payment` — 관리자 대사

세 경로가 모두 `_apply_confirmation`을 지나고 `paid_at`을 쓰는 지점도 거기 하나뿐이라 훅을 그 안으로
옮겼다. 부수효과로 재발송 방지 코드가 필요 없어졌다 — `_apply_confirmation`은 `status != "결제중"`이면
던지므로 구조적으로 주문당 1회만 통과한다.

발송은 `session.commit()` **뒤**다. 커밋 전이면 최대 10초짜리 solapi 호출이 `FOR UPDATE`로 잠긴 주문 row를
붙잡는다.

## 결정 사항

- **order_type 5종(`sale`·`custom`·`repair`·`token`·`sample`) 전부 발송.** 토큰 구매도 `TKN-` 주문번호가
  붙은 주문이라 "주문이 완료되었습니다" 문구가 어긋나지 않는다.
- 수신 조건은 클레임·견적과 동일한 4개 조합(`notification_consent`·`notification_enabled`·
  `phone_verified`·`phone`). 미충족은 조용히 건너뛴다.
- 변수 키는 `#{...}` 래퍼를 포함한다(`{"#{주문번호}": ...}`) — 클레임 발송과 같은 형식.
- `solapi`/`settings`는 keyword 기본값 `None`으로 주입한다. 알림이 필요 없는 호출자(테스트 등)는
  그대로 두면 발송을 건너뛴다. 대신 **실 호출자가 인자를 빼먹으면 조용히 미발송**이 되므로, 라우터
  3곳(`payments/router.py` confirm·webhook, `admin/claims_router.py` reconcile)이 인자를 넘기는지가
  회귀 지점이다.

## 검증

- `apps/api/tests/test_payments.py` 3건 추가: 최초 확정 1회 발송·멱등 재호출 미재발송, 미인증 번호 미발송,
  웹훅 대사 확정 시 발송.
- `apps/api/tests/test_auth.py` 1건 추가: 템플릿 설정 시 ATA + fallback 문구 유지.
- `test_payments`·`test_auth` 112 PASS, `test_admin_phase_d`·`test_config`·`test_claims`·`test_quotes`
  33 PASS. 대상 파일 ruff·pyright PASS.
- **미검증**: 실제 카카오 템플릿의 변수 이름 일치와 정보성/광고성 구분. 불일치는 실 발송 시점에만
  드러나므로 production에서 실제 번호로 2종 수신 확인이 필요하다(OPERATOR-CHECKLIST E2).
