from fastapi import APIRouter

from api.db import SessionDep

from .schemas import ReformPricingOut
from .service import get_reform_pricing as load_reform_pricing

router = APIRouter(tags=["reform"])


@router.get("/reform/pricing", response_model=ReformPricingOut)
async def get_reform_pricing(session: SessionDep) -> ReformPricingOut:
    return await load_reform_pricing(session)
