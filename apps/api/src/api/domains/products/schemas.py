import uuid
from datetime import datetime
from typing import Literal

from api.schemas import ORMModel

Category = Literal["3fold", "sfolderato", "knit", "bowtie"]
Color = Literal["black", "navy", "gray", "wine", "blue", "brown", "beige", "silver"]
Pattern = Literal["solid", "stripe", "dot", "check", "paisley"]
Material = Literal["silk", "cotton", "polyester", "wool"]
SortOption = Literal["latest", "price-low", "price-high", "popular"]


class ProductOptionOut(ORMModel):
    id: uuid.UUID
    name: str
    additional_price: int
    stock: int | None


class ProductOut(ORMModel):
    id: int
    code: str | None
    name: str
    price: int
    image: str
    detail_images: list[str] | None
    category: str
    color: str
    pattern: str
    material: str
    info: str
    stock: int | None
    option_label: str | None
    created_at: datetime
    updated_at: datetime
    likes: int = 0
    is_liked: bool = False
    options: list[ProductOptionOut] = []
