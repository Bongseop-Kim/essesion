# 알림톡 2종 추가 — 인증번호·결제완료

카카오 채널에 승인된 템플릿 중 현재 코드가 쓰는 것은 3종(클레임 완료·클레임 거부·견적요청접수)뿐이다.
인증번호·결제완료 2종을 붙인다. 템플릿 ID는 이미 발급돼 있다.

| 용도 | 템플릿 ID | 현재 상태 |
|---|---|---|
| 인증번호 | `KA01TP221027002252645FPwAcO9SguY` | 알림톡 아님 — 일반 SMS로 발송 중 |
| 결제완료 | `KA01TP260401050136256mqRqb0difkp` | 미구현 |

가입환영(`KA01TP221025083117992xkz17KyvNbr`)은 제외한다 — 소셜 최초 로그인 시점에 전화번호가 없고,
전화번호 인증 완료를 훅으로 쓰면 "가입환영"이라는 문구와 시점이 어긋난다. 쓸 자리가 생기면 그때 붙인다.

## 템플릿 본문 (확정)

### 인증번호

```
아래 인증번호를 확인하시고
서비스 화면에 입력해주세요.

인증번호: #{인증번호}
```

### 결제완료

```
주문이 완료되었습니다.

안녕하세요, 고객님.
ESSE SION에서 주문 완료를 안내드립니다.

• 주문번호: #{주문번호}
• 결제금액: #{결제금액}원

주문 내역 및 진행 상황은 앱에서
확인하실 수 있습니다.

감사합니다 :)
```

변수는 `인증번호` / `주문번호`·`결제금액` 3개. `결제금액`은 본문에 `원`이 붙어 있으므로 값에는 단위 없이
천 단위 콤마만 넣는다(`12,000`).

## 선행 확인 (착수 전)

- 두 템플릿 모두 **정보성**인지 확인한다. 광고성이면 수신동의 필드가 없는 현 스키마로는 보낼 수 없다.

## 공통 — 설정 2개 추가

- `apps/api/src/api/config.py:71-73` 옆에 `solapi_template_phone_code`,
  `solapi_template_payment_done` 추가(기본 `""`).
- `infra/production.tfvars`의 `api_extra_env`에 대응 env 2개 추가.
- **capability는 건드리지 않는다.** `main.py`의 `solapi` capability는 클라이언트 생성 여부만 보므로
  템플릿 ID가 비어도 `/readyz`는 초록이다. 템플릿 미설정은 해당 발송만 조용히 건너뛰게 한다
  (`if not template_id: return`) — 배포 전체를 막지 않는다.

## 1. 인증번호 — SMS → 알림톡(ATA) 전환

`apps/api/src/api/domains/auth/phone.py:74`가 `send_sms`로 평문 발송 중이다. `send_alimtalk`로 바꾼다.

- `send_alimtalk(normalized, template, {"인증번호": code}, fallback_text=<현재 SMS 문구>)`.
- `solapi.py:84`의 `disableSms: False` 덕분에 알림톡 실패 시 SMS로 자동 대체되므로, 지금의
  "발송 실패면 PhoneVerification 삭제 후 UpstreamError" 로직은 **그대로 둔다**. 반환값 계약이 같다.
- 템플릿 ID가 비어 있으면 기존 `send_sms` 경로를 그대로 쓴다 — 설정 누락으로 인증이 막히면 안 된다.

## 2. 결제완료

훅은 `confirm_payment`가 아니라 **`_apply_confirmation`**(`payments/service.py:602`의
`await session.commit()` 직전)에 둔다. `paid_at`을 쓰는 유일한 지점이라 결제 확정 3경로가 한 곳에서
잡힌다:

| 경로 | 언제 |
|---|---|
| `confirm_payment` | 정상 successUrl 콜백 |
| `reconcile_from_webhook` DONE (`service.py:958`) | 콜백이 끊긴 결제 — **알림톡이 가장 필요한 케이스** |
| `reconcile_confirmed_payment` (`service.py:452`) | 관리자 대사 |

`confirm_payment`에만 걸면 뒤 2개가 빠진다. 돈은 받고 주문은 확정됐는데 유저는 통보를 못 받는다.

- **멱등은 공짜다.** `_apply_confirmation`은 `status != "결제중"`이면 던진다(`service.py:554`) —
  구조상 주문당 1회만 통과하므로 successUrl 새로고침 재발송 방지에 별도 코드가 필요 없다.
- 웹훅·대사 경로에는 `user` 객체가 없다. `orders[0].user_id`로 User를 한 번 로드한다
  (그룹은 생성 구조상 단일 유저 — `service.py:580` 주석).
- `user.phone`이 없거나 `phone_verified`가 아니면 건너뛴다.
- **order_type 5종(`sale`·`custom`·`repair`·`token`·`sample`) 전부 발송한다.** 토큰 구매도
  `TKN-YYYYMMDD-NNN` 주문번호가 붙은 주문이라 템플릿 문구가 어긋나지 않는다.
- 결제 그룹에 주문이 여러 건이면 대표 주문 1건의 주문번호 + 그룹 결제금액 합계로 보낸다.

## 전달 신뢰성 — outbox를 새로 만들지 않는다

클레임만 `claim_notification_logs`(`db/models/commerce.py:398`) outbox를 쓴다. 이번 2종은
`quotes/router.py:39`와 같은 **best-effort 직접 발송**으로 간다. 이유:

- 인증번호는 실패 시 사용자가 즉시 재시도한다(이미 재시도 경로가 있다).
- 결제완료는 놓치면 CS 문의가 될 수 있으나, 결제 자체는 주문 상태로 확인되므로 알림 재전송이
  필수는 아니다. **미발송이 실제로 CS 부담이 되는 것이 관측되면** 그때 결제완료만 outbox로 승격한다.

새 테이블·마이그레이션·배치를 지금 만들지 않는다.

## 검증

- `apps/api/tests/`에 단위 테스트: 템플릿 ID 미설정 시 건너뛰기(인증번호는 SMS 폴백), 결제 멱등
  재호출 시 재발송 없음, 웹훅 대사 확정에도 발송됨, `phone_verified=False`면 미발송.
  발송 클라이언트는 `DryRunSolapiClient`로 확인한다.
- production 검증은 실제 번호로 2종 수신 확인(OPERATOR-CHECKLIST E2와 함께).
