import runpy
from pathlib import Path

from db.models.commerce import Product

_seed = runpy.run_path(str(Path(__file__).parents[1] / "scripts" / "seed.py"))
PRODUCTS = _seed["PRODUCTS"]
_backfill_option_label = _seed["_backfill_option_label"]


def _product(option_label: str | None = None) -> Product:
    return Product(
        code="TEST",
        name="테스트 상품",
        price=1000,
        image="",
        category="3fold",
        color="navy",
        pattern="solid",
        material="silk",
        info="테스트",
        option_label=option_label,
    )


def test_option_seed_products_define_a_group_label():
    assert [spec["code"] for spec in PRODUCTS if spec["options"]] == [
        "3F-SEED-001",
        "3F-SEED-002",
    ]
    assert all(spec["option_label"] == "길이" for spec in PRODUCTS if spec["options"])


def test_seed_backfills_only_missing_option_labels():
    missing = _product()
    customized = _product("맞춤 길이")

    _backfill_option_label(missing, "길이")
    _backfill_option_label(customized, "길이")

    assert missing.option_label == "길이"
    assert customized.option_label == "맞춤 길이"
