from typing import Literal

from pydantic import Field, PositiveFloat, field_validator, model_validator

from api.schemas import StrictModel


class ReformPricingOut(StrictModel):
    automatic_cost: int
    width_cost: int
    restoration_cost: int
    automatic_combined_cost: int
    width_restoration_cost: int
    shipping_cost: int


class ReformImageIn(StrictModel):
    object_key: str = Field(min_length=1, max_length=1_024)
    claim_token: str | None = Field(default=None, max_length=512)


class ReformImageOut(StrictModel):
    object_key: str


class AutomaticReform(StrictModel):
    """자동수선 — 착용자 키 또는 넥타이 길이 중 하나 이상.

    키만 오면 작업 시 키 기준 권장 길이로 맞춘다.
    """

    mechanism: Literal["zipper", "string"]
    wearer_height_cm: PositiveFloat | None = None
    total_length_cm: PositiveFloat | None = None
    dimple: bool = False
    turn_knot: bool = False

    @model_validator(mode="after")
    def validate_addons(self) -> "AutomaticReform":
        if self.wearer_height_cm is None and self.total_length_cm is None:
            raise ValueError("착용자 키나 넥타이 길이 중 하나를 입력해 주세요")
        if self.mechanism == "string" and self.dimple:
            raise ValueError("끈 방식에서는 딤플을 선택할 수 없습니다")
        if self.dimple and not self.turn_knot:
            raise ValueError("딤플은 돌려묶기와 함께만 선택할 수 있습니다")
        return self


class WidthReform(StrictModel):
    target_width_cm: PositiveFloat


class RestorationReform(StrictModel):
    memo: str = Field(default="", max_length=200)

    @field_validator("memo")
    @classmethod
    def strip_memo(cls, value: str) -> str:
        return value.strip()


class _TieOptions(StrictModel):
    automatic: AutomaticReform | None = None
    width: WidthReform | None = None
    restoration: RestorationReform | None = None

    @model_validator(mode="after")
    def validate_service_selected(self) -> "_TieOptions":
        if self.automatic is None and self.width is None and self.restoration is None:
            raise ValueError("수선 서비스를 하나 이상 선택해주세요")
        return self


class ReformTieIn(_TieOptions):
    image: ReformImageIn


class ReformTieOut(_TieOptions):
    image: ReformImageOut


class ReformDataIn(StrictModel):
    tie: ReformTieIn


class ReformDataOut(StrictModel):
    tie: ReformTieOut
    cost: int
