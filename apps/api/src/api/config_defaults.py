"""admin_settings·pricing_constants 초기값과 적용 — 로컬 시드와 production bootstrap의 단일 출처.

두 테이블은 admin 화면이 **기존 행을 수정**하는 구조라(`domains/admin/configuration.py`)
행이 없으면 화면에서 만들 수 없다. 빈 DB는 여기 값으로 먼저 채운다:

  로컬      apps/api/scripts/seed.py
  production apps/api/scripts/bootstrap_admin.py seed-config

값의 정본은 `docs/api-spec/money.md`다. 단가·플랜을 바꿀 때는 명세와 이 파일을 함께 고친다.

**여기 키를 추가·변경하면 `db/migrations/`에 데이터 마이그레이션도 함께 넣는다** — 두 시드는
빈 DB만 채우고 production `seed-config`는 수동이라, 이미 돌고 있는 DB는 마이그레이션으로만
따라온다. 신규 키는 `on conflict do nothing` INSERT(a3f7d94c1e28), 값 변경은 UPDATE(f1c6a80b5d29).
행이 없으면 조용히 넘어가지 않고 하드 에러가 난다 — `design_finalize_cost` 누락이
`GET /tokens/balance` 전체를 400으로 죽인 적이 있다(2026-08-21).
"""

from db.models.commerce import AdminSetting, PricingConstant
from sqlalchemy import delete
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

ADMIN_SETTINGS = {
    "default_courier_company": "롯데택배",
    # 1토큰 ≈ 1원 스케일. 단가 산정 근거·손익 가드는 money.md §6이 정본이다.
    # 탐색~실사화 1회 완주 ≈ 385토큰(생성 25 + 모티프 100 + 수정 12×5 + 실사화 200)의 약 2배
    "design_token_initial_grant": "750",
    "design_token_cost_openai_render_standard": "25",
    "design_edit_cost": "12",
    "design_motif_generate_cost": "100",
    "design_finalize_cost": "200",
}

# 이전 스키마의 admin_settings 잔재 — 남아 있으면 관리자 화면에 유령 행이 남는다.
_RETIRED_ADMIN_SETTING_KEYS = ("design_finalize_daily_limit",)

PRICING: dict[str, tuple[int, str]] = {
    # reform
    "REFORM_AUTOMATIC_COST": (16000, "reform"),
    "REFORM_WIDTH_COST": (30000, "reform"),
    "REFORM_RESTORATION_COST": (30000, "reform"),
    "REFORM_AUTOMATIC_COMBINED_COST": (40000, "reform"),
    "REFORM_WIDTH_RESTORATION_COST": (30000, "reform"),
    "REFORM_SHIPPING_COST": (4500, "reform"),
    # custom order
    "SEWING_PER_COST": (4000, "custom_order"),
    "AUTO_TIE_COST": (1000, "custom_order"),
    "TRIANGLE_STITCH_COST": (500, "custom_order"),
    "SIDE_STITCH_COST": (500, "custom_order"),
    "BAR_TACK_COST": (300, "custom_order"),
    "DIMPLE_COST": (700, "custom_order"),
    "SPODERATO_COST": (800, "custom_order"),
    "FOLD7_COST": (900, "custom_order"),
    "WOOL_INTERLINING_COST": (600, "custom_order"),
    "BRAND_LABEL_COST": (300, "custom_order"),
    "CARE_LABEL_COST": (200, "custom_order"),
    "FABRIC_PRINTING_POLY": (8000, "fabric"),
    "FABRIC_PRINTING_SILK": (12000, "fabric"),
    "FABRIC_YARN_DYED_POLY": (12000, "fabric"),
    "FABRIC_YARN_DYED_SILK": (16000, "fabric"),
    # 샘플비 — 샘플 주문의 정가이면서 주문제작 금액에도 그대로 포함된다 (money.md §3·§4).
    # 원단+봉제는 두 상수의 합이라 별도 키를 두지 않는다.
    "SAMPLE_SEWING_COST": (100000, "custom_order"),
    "SAMPLE_FABRIC_PRINTING_COST": (100000, "custom_order"),
    "SAMPLE_FABRIC_YARN_DYED_COST": (200000, "custom_order"),
    "sample_discount_sewing": (30000, "sample_discount"),
    "sample_discount_fabric_printing": (30000, "sample_discount"),
    "sample_discount_fabric_yarn_dyed": (40000, "sample_discount"),
    # token plans — 가격과 수량은 다르다. 볼륨 할인은 보너스 토큰으로 드러난다 (money.md §6 표).
    "token_plan_starter_price": (2500, "token"),
    "token_plan_starter_amount": (2500, "token"),
    "token_plan_popular_price": (6500, "token"),
    "token_plan_popular_amount": (7500, "token"),
    "token_plan_pro_price": (18000, "token"),
    "token_plan_pro_amount": (25000, "token"),
}

# 이전 스키마의 잔재 — 남아 있으면 견적이 옛 키를 집거나 관리자 화면에 유령 행이 남는다.
_RETIRED_PRICING_KEYS = (
    "REFORM_BASE_COST",
    # 시작비·세팅비는 샘플비로 대체됐고, 원단+봉제는 두 상수의 합으로 계산한다.
    "START_COST",
    "YARN_DYED_DESIGN_COST",
    "SAMPLE_FABRIC_AND_SEWING_PRINTING_COST",
    "SAMPLE_FABRIC_AND_SEWING_YARN_DYED_COST",
    "sample_discount_fabric_and_sewing_printing",
    "sample_discount_fabric_and_sewing_yarn_dyed",
)


async def apply_config_defaults(session: AsyncSession, *, overwrite: bool) -> tuple[int, int]:
    """두 설정 테이블에 기본값을 채운다. 멱등이며 반환값은 (설정 수, 가격 수).

    overwrite=True는 로컬 전용이다 — 단가만 옛 값에 남으면 플랜 수량과 어긋난다.
    production은 False로 부른다. 운영자가 admin 화면에서 조정한 값을 재실행이
    되돌리면 안 되기 때문이다. 빠진 행만 채우고 기존 행은 손대지 않는다.
    """
    for key, value in ADMIN_SETTINGS.items():
        statement = pg_insert(AdminSetting).values(key=key, value=value)
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[AdminSetting.key], set_={"value": value}
            )
            if overwrite
            else statement.on_conflict_do_nothing(index_elements=[AdminSetting.key])
        )
    for key, (amount, category) in PRICING.items():
        statement = pg_insert(PricingConstant).values(key=key, amount=amount, category=category)
        await session.execute(
            statement.on_conflict_do_update(
                index_elements=[PricingConstant.key],
                set_={"amount": amount, "category": category},
            )
            if overwrite
            else statement.on_conflict_do_nothing(index_elements=[PricingConstant.key])
        )
    await session.execute(
        delete(PricingConstant).where(PricingConstant.key.in_(_RETIRED_PRICING_KEYS))
    )
    await session.execute(
        delete(AdminSetting).where(AdminSetting.key.in_(_RETIRED_ADMIN_SETTING_KEYS))
    )
    return len(ADMIN_SETTINGS), len(PRICING)
