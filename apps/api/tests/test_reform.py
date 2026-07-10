import pytest
from api.domains.reform.schemas import ReformDataIn, ReformPricingOut
from api.domains.reform.service import calculate_reform_cost
from pydantic import ValidationError

from .factories import seed_pricing

PRICES = {
    "REFORM_AUTOMATIC_COST": 16000,
    "REFORM_WIDTH_COST": 30000,
    "REFORM_RESTORATION_COST": 30000,
    "REFORM_AUTOMATIC_COMBINED_COST": 40000,
    "REFORM_WIDTH_RESTORATION_COST": 30000,
    "REFORM_SHIPPING_COST": 4500,
    "REFORM_PICKUP_FEE": 5000,
}

PRICING = ReformPricingOut(
    automatic_cost=16000,
    width_cost=30000,
    restoration_cost=30000,
    automatic_combined_cost=40000,
    width_restoration_cost=30000,
    shipping_cost=4500,
    pickup_fee=5000,
)


def _data(*, automatic: bool = False, width: bool = False, restoration: bool = False):
    tie: dict[str, object] = {
        "image": {"object_key": "uploads/reform_upload/tie.png"}
    }
    if automatic:
        tie["automatic"] = {"mechanism": "zipper", "wearer_height_cm": 175}
    if width:
        tie["width"] = {"target_width_cm": 8}
    if restoration:
        tie["restoration"] = {"memo": "복원 상담"}
    return ReformDataIn.model_validate({"tie": tie})


def test_reform_price_combinations():
    cases = [
        (_data(automatic=True), 16000),
        (_data(width=True), 30000),
        (_data(restoration=True), 30000),
        (_data(automatic=True, width=True), 40000),
        (_data(automatic=True, restoration=True), 40000),
        (_data(automatic=True, width=True, restoration=True), 40000),
        (_data(width=True, restoration=True), 30000),
    ]
    for data, expected in cases:
        assert calculate_reform_cost(data, PRICING) == expected


def test_reform_option_validation():
    with pytest.raises(ValidationError):
        _data()
    with pytest.raises(ValidationError):
        ReformDataIn.model_validate(
            {
                "tie": {
                    "image": {"object_key": "uploads/reform_upload/tie.png"},
                    "automatic": {
                        "mechanism": "string",
                        "wearer_height_cm": 175,
                        "turn_knot": True,
                    },
                }
            }
        )
    with pytest.raises(ValidationError):
        ReformDataIn.model_validate(
            {
                "tie": {
                    "image": {"object_key": "uploads/reform_upload/tie.png"},
                    "width": {"target_width_cm": 0},
                }
            }
        )


async def test_reform_pricing_endpoint(client, db_session):
    await seed_pricing(db_session, PRICES, category="reform")
    response = await client.get("/reform/pricing")
    assert response.status_code == 200
    assert response.json() == PRICING.model_dump()
