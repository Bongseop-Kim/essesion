from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, PositiveFloat, field_validator, model_validator


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReformPricingOut(_StrictModel):
    automatic_cost: int
    width_cost: int
    restoration_cost: int
    automatic_combined_cost: int
    width_restoration_cost: int
    shipping_cost: int
    pickup_fee: int


class ReformImageIn(_StrictModel):
    object_key: str = Field(min_length=1)
    claim_token: str | None = None


class ReformImageOut(_StrictModel):
    object_key: str


class AutomaticReform(_StrictModel):
    mechanism: Literal["zipper", "string"]
    wearer_height_cm: PositiveFloat
    dimple: bool = False
    turn_knot: bool = False

    @model_validator(mode="after")
    def validate_turn_knot(self) -> "AutomaticReform":
        if self.mechanism == "string" and self.turn_knot:
            raise ValueError("끈 방식에서는 돌려묶기를 선택할 수 없습니다")
        return self


class WidthReform(_StrictModel):
    target_width_cm: PositiveFloat


class RestorationReform(_StrictModel):
    memo: str = Field(default="", max_length=200)

    @field_validator("memo")
    @classmethod
    def strip_memo(cls, value: str) -> str:
        return value.strip()


class _TieOptions(_StrictModel):
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


class ReformDataIn(_StrictModel):
    tie: ReformTieIn


class ReformDataOut(_StrictModel):
    tie: ReformTieOut
    cost: int
