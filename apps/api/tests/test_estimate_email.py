"""예상 견적서 메일 — 엑셀 내용과 발송 엔드포인트 (docs/api-spec/domains.md §7)."""

import io
import zipfile
from datetime import date

import pytest
from api.domains.orders.estimate import build_estimate_xlsx, estimate_specs, split_vat
from api.domains.orders.schemas import CustomEstimateEmailRequest
from pydantic import ValidationError

from .factories import auth_headers, make_user, seed_pricing

# store가 보내는 옵션 전부 — apps/store/src/features/custom-order/model/options.ts
# customOrderApiOptions. 키가 늘면 여기와 estimate.py의 라벨을 함께 고친다.
STORE_OPTIONS = {
    "fabric_provided": False,
    "reorder": True,
    "point": None,
    "fabric_type": "SILK",
    "design_type": "YARN_DYED",
    "tie_type": "AUTO",
    "interlining": "WOOL",
    "size_type": "ADULT",
    "tie_width": 8,
    "triangle_stitch": True,
    "side_stitch": True,
    "bar_tack": True,
    "fold7": True,
    "dimple": True,
    "turn_knot": True,
    "spoderato": True,
    "brand_label": True,
    "care_label": True,
}
PRICING = {
    "SEWING_PER_COST": 3000,
    "AUTO_TIE_COST": 1000,
    "TRIANGLE_STITCH_COST": 500,
    "SIDE_STITCH_COST": 500,
    "BAR_TACK_COST": 300,
    "DIMPLE_COST": 700,
    "SPODERATO_COST": 800,
    "FOLD7_COST": 900,
    "WOOL_INTERLINING_COST": 600,
    "BRAND_LABEL_COST": 200,
    "CARE_LABEL_COST": 100,
    "EMBROIDERY_COST": 5000,
    "HEAT_TRANSFER_COST": 3000,
    "SAMPLE_SEWING_COST": 50000,
    "SAMPLE_FABRIC_PRINTING_COST": 60000,
    "SAMPLE_FABRIC_YARN_DYED_COST": 80000,
    "FABRIC_PRINTING_POLY": 8000,
    "FABRIC_PRINTING_SILK": 10000,
    "FABRIC_YARN_DYED_POLY": 12000,
    "FABRIC_YARN_DYED_SILK": 14000,
}
URL = "/orders/custom/estimate-email"


def _xlsx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return "".join(
            archive.read(name).decode() for name in archive.namelist() if name.endswith(".xml")
        )


def test_specs_cover_every_store_option():
    material, specs = estimate_specs(STORE_OPTIONS)
    text = " ".join(value for _, value in specs)

    assert material == "실크"
    for expected in (
        "재주문 · 실크 · 선염",
        "자동 타이 · 돌려묶기 · 딤플",
        "성인용 · 8cm",
        "울",
        "삼각 봉제",
        "옆선 봉제",
        "바택",
        "7폴드",
        "스포데라토",
        "브랜드 라벨",
        "케어 라벨",
    ):
        assert expected in text
    assert estimate_specs({**STORE_OPTIONS, "point": "EMBROIDERY"})[1][1] == ("포인트", "자수")


def test_specs_drop_unknown_keys_and_values():
    _, specs = estimate_specs(
        {
            "fabric_type": "http://evil.example",
            "design_type": ["x"],
            "size_type": "입금은 여기로",
            "tie_width": "8; DROP",
            "memo": "계좌 변경 안내",
            "brand_label": "yes",
        }
    )
    assert specs == [("원단", "-"), ("타이", "수동 타이")]


def test_split_vat_adds_up():
    assert split_vat(1_610_000) == (1_463_636, 146_364)
    for total in (1, 10, 999, 123_457):
        supply, tax = split_vat(total)
        assert supply + tax == total


def test_xlsx_contains_amounts_and_recipient():
    data = build_estimate_xlsx(
        issued=date(2026, 11, 18),
        company_name="(주)샘플상사",
        options=STORE_OPTIONS,
        quantity=100,
        total=1_610_000,
    )
    text = _xlsx_text(data)

    assert "(주)샘플상사 귀하" in text
    assert "2026년 11월 18일" in text
    assert "305-26-32033" in text
    for number in ("1610000", "1463636", "146364", "14636"):
        assert f"<v>{number}</v>" in text
    assert "<f>" not in text  # 수식 없음 — 값만


def test_xlsx_never_turns_text_into_formula():
    data = build_estimate_xlsx(
        issued=date(2026, 11, 18),
        company_name="=HYPERLINK(1)",  # 스키마가 막지만 생성기도 수식으로 만들지 않는다
        options={},
        quantity=10,
        total=110_000,
    )
    assert "<f>" not in _xlsx_text(data)


@pytest.mark.parametrize(
    "email",
    ["a@b.co\r\nBcc: x@y.zz", "a@b.co, c@d.ee", "a b@c.dd", "<a@b.co>", "a@b", "가@b.co"],
)
def test_request_rejects_unsafe_email(email):
    with pytest.raises(ValidationError):
        CustomEstimateEmailRequest(options={}, quantity=10, email=email)


@pytest.mark.parametrize("name", ["=1+1", "@cmd", "http://x.y/z", "a" * 41, "<b>x</b>", "x\ny"])
def test_request_rejects_unsafe_company_name(name):
    with pytest.raises(ValidationError):
        CustomEstimateEmailRequest(
            options={}, quantity=10, email="buyer@example.com", company_name=name
        )


async def test_estimate_email_requires_login(client):
    res = await client.post(
        URL, json={"options": STORE_OPTIONS, "quantity": 100, "email": "buyer@example.com"}
    )
    assert res.status_code == 401


async def test_estimate_email_sends_recalculated_total(client, db_session, settings, app):
    await seed_pricing(db_session, PRICING)
    user = await make_user(db_session)
    payload = {"options": STORE_OPTIONS, "quantity": 100, "email": "buyer@example.com"}
    expected = (await client.post("/orders/custom/calculate", json=payload)).json()["total_cost"]

    res = await client.post(
        URL,
        json={**payload, "company_name": "(주)샘플상사", "total_cost": 1},  # 보낸 금액은 무시
        headers=auth_headers(user, settings),
    )

    assert res.status_code == 204
    (message,) = app.state.mailer.sent
    assert message["To"] == "buyer@example.com"
    assert message["From"] == "ESSE SION <help@essesion.com>"
    assert f"{expected:,}원" in message.get_body().get_content()
    (attachment,) = message.iter_attachments()
    assert attachment.get_filename().startswith("견적서_영선산업_")
    text = _xlsx_text(attachment.get_content())
    assert f"<v>{expected}</v>" in text
    assert "(주)샘플상사 귀하" in text


async def test_estimate_email_rate_limited_per_user(client, db_session, settings, app):
    await seed_pricing(db_session, PRICING)
    user = await make_user(db_session)
    payload = {"options": STORE_OPTIONS, "quantity": 100, "email": "buyer@example.com"}
    headers = auth_headers(user, settings)

    for _ in range(settings.estimate_mail_user_rate_limit_attempts):
        assert (await client.post(URL, json=payload, headers=headers)).status_code == 204
    res = await client.post(URL, json=payload, headers=headers)

    assert res.status_code == 429
    assert len(app.state.mailer.sent) == settings.estimate_mail_user_rate_limit_attempts
