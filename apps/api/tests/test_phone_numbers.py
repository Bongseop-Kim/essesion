from datetime import date

import pytest
from api.domains.admin.manual_orders import ManualOrderCreateRequest, ManualOrderItem
from api.domains.orders.schemas import RepairPickupIn
from api.domains.users.router import ShippingAddressIn
from api.phone_numbers import normalize_mobile_phone
from pydantic import ValidationError


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("01012345678", "01012345678"),
        ("010-1234-5678", "01012345678"),
        ("(010) 1234-5678", "01012345678"),
    ],
)
def test_normalize_mobile_phone(value: str, expected: str) -> None:
    assert normalize_mobile_phone(value) == expected


@pytest.mark.parametrize("value", ["010-123-456", "+82-10-1234-5678", "abc01012345678"])
def test_normalize_mobile_phone_rejects_unknown_forms(value: str) -> None:
    with pytest.raises(ValueError, match="유효하지 않은 휴대폰 번호"):
        normalize_mobile_phone(value)


def test_phone_write_models_store_canonical_digits() -> None:
    shipping = ShippingAddressIn(
        recipient_name="홍길동",
        recipient_phone="010-1234-5678",
        postal_code="12345",
        address="서울시 중구",
    )
    pickup = RepairPickupIn(
        recipient_name="홍길동",
        recipient_phone="010 1234 5678",
        address="서울시 중구",
    )
    manual = ManualOrderCreateRequest(
        order_date=date(2026, 8, 13),
        customer_name="홍길동",
        phone="010-1234-5678",
        amount=10_000,
        items=[
            ManualOrderItem.model_validate(
                {
                    "quantity": 1,
                    "automatic": {
                        "mechanism": "zipper",
                        "total_length_cm": 145,
                    },
                }
            )
        ],
    )

    assert shipping.recipient_phone == "01012345678"
    assert pickup.recipient_phone == "01012345678"
    assert manual.phone == "01012345678"


def test_phone_write_models_reject_invalid_mobile_number() -> None:
    with pytest.raises(ValidationError):
        ShippingAddressIn(
            recipient_name="홍길동",
            recipient_phone="대표번호 확인 필요",
            postal_code="12345",
            address="서울시 중구",
        )
