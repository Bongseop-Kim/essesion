"""공용 Pydantic 베이스 — 도메인 스키마가 반복하던 model_config를 한 곳에 모은다.

- ORMModel: ORM 행을 그대로 `model_validate(row)` 하기 위한 from_attributes.
- StrictModel: 요청 바디에서 정의되지 않은 필드를 거부(extra="forbid").

정책을 바꿀 곳은 여기 한 군데. populate_by_name·str_strip_whitespace처럼
개별 모델에만 필요한 설정은 그 모델에서 직접 지정한다.
"""

from pydantic import BaseModel, ConfigDict


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")
