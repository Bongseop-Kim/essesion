"""주문 상태기계 — docs/api-spec/money.md §8. 전이표는 기존 시스템 그대로."""

from api.errors import DomainError

ACTIVE_CLAIM_STATUSES = ("접수", "처리중", "수거요청", "수거완료", "재발송")

# 정방향 전이 (current, new)
FORWARD: dict[str, set[tuple[str, str]]] = {
    "sale": {
        ("대기중", "진행중"),
        ("진행중", "배송중"),
        ("배송중", "배송완료"),
        ("배송완료", "완료"),
    },
    "custom": {
        ("대기중", "접수"),
        ("접수", "제작중"),
        ("제작중", "제작완료"),
        ("제작완료", "배송중"),
        ("배송중", "배송완료"),
        ("배송완료", "완료"),
    },
    "sample": {
        ("접수", "제작중"),
        ("제작중", "배송중"),
        ("배송중", "배송완료"),
        ("배송완료", "완료"),
    },
    "repair": {
        # 발송대기→접수: 고객 발송 확인 없이 입고된 실물의 관리자 강제 접수 (money.md §9)
        ("발송대기", "접수"),
        ("발송중", "접수"),
        ("발송확인중", "접수"),
        ("수거예정", "접수"),
        ("접수", "수선중"),
        ("수선중", "수선완료"),
        ("수선완료", "배송중"),
        ("배송중", "배송완료"),
        ("배송완료", "완료"),
    },
    "token": set(),  # 완료는 결제 confirm 전용
}

CANCELABLE_FROM: dict[str, set[str]] = {
    "sale": {"대기중", "결제중", "진행중"},
    "custom": {"대기중", "결제중", "접수"},
    "sample": {"대기중", "결제중", "접수"},
    "repair": {"대기중", "결제중", "발송대기", "발송중", "발송확인중", "수거예정"},
    "token": {"대기중", "결제중"},
}

ROLLBACK_FORBIDDEN_CURRENT = {"배송중", "배송완료", "완료", "취소", "수거완료", "재발송"}

# 롤백 전이 (repair 접수→이전상태는 동적 — validate_transition의 repair_previous)
ROLLBACK: dict[str, set[tuple[str, str]]] = {
    "sale": {("결제중", "대기중"), ("진행중", "대기중")},
    "custom": {
        ("결제중", "대기중"),
        ("접수", "대기중"),
        ("제작중", "접수"),
        ("제작완료", "제작중"),
    },
    "sample": {("결제중", "대기중"), ("접수", "대기중"), ("제작중", "접수")},
    "repair": {("수선중", "접수"), ("수선완료", "수선중")},
    "token": {("결제중", "대기중")},
}


def validate_transition(
    order_type: str,
    current: str,
    new: str,
    *,
    is_rollback: bool,
    repair_previous: str | None = None,
) -> None:
    if is_rollback:
        if current in ROLLBACK_FORBIDDEN_CURRENT:
            raise DomainError(
                f"Rollback not allowed from status {current}", code="invalid_rollback"
            )
        allowed = (current, new) in ROLLBACK[order_type]
        if order_type == "repair" and current == "접수" and repair_previous is not None:
            allowed = allowed or new == repair_previous
        if not allowed:
            raise DomainError(
                f'Invalid rollback from "{current}" to "{new}" for {order_type} order',
                code="invalid_rollback",
            )
        return

    if new == "취소":
        if current not in CANCELABLE_FROM[order_type]:
            raise DomainError(
                f'Invalid transition from "{current}" to "취소" for {order_type} order',
                code="invalid_transition",
            )
        return
    if (current, new) not in FORWARD[order_type]:
        raise DomainError(
            f'Invalid transition from "{current}" to "{new}" for {order_type} order',
            code="invalid_transition",
        )


CLAIM_CANCEL_ACTION_FROM: dict[str, set[str]] = {
    "sale": {"대기중", "진행중"},
    "custom": {"대기중", "접수"},
    "sample": {"대기중", "접수"},
    "repair": {"대기중", "발송대기", "발송중", "발송확인중", "수거예정"},
    "token": {"대기중"},
}

CLAIM_RETURN_EXCHANGE_ACTION_FROM: dict[str, set[str]] = {
    "sale": {"배송중", "배송완료"},
}


def customer_actions(order_type: str, status: str, *, has_active_claim: bool) -> list[str]:
    actions: list[str] = []
    if not has_active_claim:
        if status in CLAIM_CANCEL_ACTION_FROM.get(order_type, set()):
            actions.append("claim_cancel")
        if status in CLAIM_RETURN_EXCHANGE_ACTION_FROM.get(order_type, set()):
            actions += ["claim_return", "claim_exchange"]
        if order_type != "token" and status in ("배송중", "배송완료"):
            actions.append("confirm_purchase")
    return actions


def admin_actions(order_type: str, status: str) -> list[str]:
    if status in ("완료", "취소", "실패"):
        return []
    actions: list[str] = []
    if any(current == status for current, _ in FORWARD[order_type]):
        actions.append("advance")
    can_rollback = status not in ROLLBACK_FORBIDDEN_CURRENT and (
        any(current == status for current, _ in ROLLBACK[order_type])
        or (order_type == "repair" and status == "접수")
    )
    if can_rollback:
        actions.append("rollback")
    if status in CANCELABLE_FROM[order_type]:
        actions.append("cancel")
    return actions
