import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict

Category = Literal["3fold", "sfolderato", "knit", "bowtie"]
Color = Literal["black", "navy", "gray", "wine", "blue", "brown", "beige", "silver"]
Pattern = Literal["solid", "stripe", "dot", "check", "paisley"]
Material = Literal["silk", "cotton", "polyester", "wool"]


class ProductOptionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    additional_price: int
    stock: int | None


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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


class ProductCreate(BaseModel):
    name: str
    price: int
    image: str
    category: Category
    color: Color
    pattern: Pattern
    material: Material
    info: str
    code: str | None = None  # 미지정 시 자동 채번
    detail_images: list[str] | None = None
    stock: int | None = None
    option_label: str | None = None


class ProductUpdate(BaseModel):
    name: str | None = None
    price: int | None = None
    image: str | None = None
    category: Category | None = None
    color: Color | None = None
    pattern: Pattern | None = None
    material: Material | None = None
    info: str | None = None
    detail_images: list[str] | None = None
    stock: int | None = None
    option_label: str | None = None


class ProductOptionIn(BaseModel):
    name: str
    additional_price: int = 0
    stock: int | None = None
