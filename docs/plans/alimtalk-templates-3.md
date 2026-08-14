# 알림톡 3종 추가 — 인증번호·가입환영·결제완료

카카오 채널에 승인된 템플릿 6종 중 현재 코드가 쓰는 것은 3종(클레임 완료·클레임 거부·견적요청접수)뿐이다.
나머지 3종을 붙인다. 템플릿 ID는 이미 발급돼 있다.

| 용도 | 템플릿 ID | 현재 상태 |
|---|---|---|
| 인증번호 | `KA01TP221027002252645FPwAcO9SguY` | 알림톡 아님 — 일반 SMS로 발송 중 |
| 가입환영 | `KA01TP221025083117992xkz17KyvNbr` | 미구현 |
| 결제완료 | `KA01TP260401050136256mqRqb0difkp` | 미구현 |

## 선행 확인 (착수 전)

- 세 템플릿의 **변수 이름**을 Solapi/카카오 콘솔에서 확인한다. 코드의 `variables` 키가 템플릿 본문의
  `#{...}`와 정확히 일치해야 하고, 불일치는 발송 시점에 실패로만 드러난다.
- 세 템플릿 모두 **정보성**인지 확인한다. 광고성이면 수신동의 필드가 없는 현 스키마로는 보낼 수 없다.

## 공통 — 설정 3개 추가

- `apps/api/src/api/config.py:71-73` 옆에 `solapi_template_phone_code`,
  `solapi_template_welcome`, `solapi_template_payment_done` 추가(기본 `""`).
- `infra/production.tfvars`의 `api_extra_env`에 대응 env 3개 추가.
- **capability는 건드리지 않는다.** `main.py`의 `solapi` capability는 클라이언트 생성 여부만 보므로
  템플릿 ID가 비어도 `/readyz`는 초록이다. 템플릿 미설정은 해당 발송만 조용히 건너뛰게 한다
  (`if not template_id: return`) — 배포 전체를 막지 않는다.

## 1. 인증번호 — SMS → 알림톡(ATA) 전환

`apps/api/src/api/domains/auth/phone.py:74`가 `send_sms`로 평문 발송 중이다. `send_alimtalk`로 바꾼다.

- `send_alimtalk(normalized, template, {"인증번호": code}, fallback_text=<현재 SMS 문구>)`.
- `solapi.py:84`의 `disableSms: False` 덕분에 알림톡 실패 시 SMS로 자동 대체되므로, 지금의
  "발송 실패면 PhoneVerification 삭제 후 UpstreamError" 로직은 **그대로 둔다**. 반환값 계약이 같다.
- 템플릿 ID가 비어 있으면 기존 `send_sms` 경로를 그대로 쓴다 — 설정 누락으로 인증이 막히면 안 된다.

## 2. 가입환영 — 훅 위치 주의

소셜 최초 로그인(`auth/service.py:253`)에는 **전화번호가 없다**. 그 시점에 알림톡을 보낼 대상이 없다.

따라서 훅은 `auth/phone.py`의 `verify_code`에서 `user.phone`·`user.phone_verified`를 세팅하는
지점(파일 내 `user.phone = normalized` 직후)에 둔다. 조건은 "**이 사용자가 이번에 처음으로
phone_verified가 된 경우**" — 재인증·번호 변경에서는 다시 보내지 않는다(직전 값이 `False`였을 때만).

발송 실패는 로그만 남기고 무시한다. 환영 인사 때문에 인증 성공 응답을 실패로 바꾸지 않는다.

## 3. 결제완료

`apps/api/src/api/domains/payments/service.py:149 confirm_payment`의 성공 종료 직전에 발송한다.

- 멱등 사전체크(`all(o.paid_at is not None)`)로 돌아오는 경로에서는 **보내지 않는다** — successUrl
  새로고침마다 알림톡이 재발송되는 것을 막는다. 최초 확정 경로에서만 1회.
- `user.phone`이 없거나 `phone_verified`가 아니면 건너뛴다.
- 변수는 주문번호·금액 정도. 결제 그룹에 주문이 여러 건이면 대표 주문 1건 기준으로 보낸다.

## 전달 신뢰성 — outbox를 새로 만들지 않는다

클레임만 `claim_notification_logs`(`db/models/commerce.py:398`) outbox를 쓴다. 이번 3종은
`quotes/router.py:39`와 같은 **best-effort 직접 발송**으로 간다. 이유:

- 인증번호는 실패 시 사용자가 즉시 재시도한다(이미 재시도 경로가 있다).
- 가입환영은 놓쳐도 손실이 없다.
- 결제완료는 놓치면 CS 문의가 될 수 있으나, 결제 자체는 주문 상태로 확인되므로 알림 재전송이
  필수는 아니다. **미발송이 실제로 CS 부담이 되는 것이 관측되면** 그때 결제완료만 outbox로 승격한다.

새 테이블·마이그레이션·배치를 지금 만들지 않는다.

## 검증

- `apps/api/tests/`에 도메인별 단위 테스트: 템플릿 ID 미설정 시 건너뛰기, 결제 멱등 재호출 시
  재발송 없음, 재인증 시 가입환영 미발송. 발송 클라이언트는 `DryRunSolapiClient`로 확인한다.
- production 검증은 실제 번호로 3종 수신 확인(OPERATOR-CHECKLIST E2와 함께).

## 미결정

- 가입환영을 "phone 인증 완료" 대신 별도 온보딩 완료 시점으로 옮길지 — 현재 다른 후보 훅이 없다.
- 결제완료 변수에 주문번호 외에 상품명을 넣을지(템플릿 본문 확인 후 결정).
