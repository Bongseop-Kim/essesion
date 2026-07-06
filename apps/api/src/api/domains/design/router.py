"""디자인 세션 골격 — 세션 상태는 api 소유(LangGraph 대체), 워커 연동은 4단계.

예산 카운터(recraft_used/finalize_used)는 Postgres 공유 카운터 — 인스턴스 수와
무관하게 동작 (ARCHITECTURE §7). 턴 payload 스키마는 /design 신규 기획(5단계)에서 구체화.
"""

import uuid
from datetime import datetime
from typing import Any

from db.models.design import DesignSession, DesignSessionTurn
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func, select

from api.db import SessionDep, advisory_xact_lock
from api.deps import CurrentUser, ensure_owner

router = APIRouter(tags=["design"])


class DesignSessionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    seed: int | None
    colorway: str | None
    registry_version: str | None
    current_intent: dict[str, Any] | None
    recraft_used: int
    finalize_used: int
    created_at: datetime
    updated_at: datetime


class DesignSessionUpdateRequest(BaseModel):
    seed: int | None = None
    colorway: str | None = None
    current_intent: dict[str, Any] | None = None


class DesignTurnCreateRequest(BaseModel):
    role: str
    payload: dict[str, Any]


class DesignTurnOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    seq: int
    role: str
    payload: dict[str, Any]
    created_at: datetime


@router.post("/design/sessions", response_model=DesignSessionOut, status_code=201)
async def create_design_session(session: SessionDep, user: CurrentUser) -> DesignSessionOut:
    design_session = DesignSession(user_id=user.id)
    session.add(design_session)
    await session.commit()
    await session.refresh(design_session)
    return DesignSessionOut.model_validate(design_session)


@router.get("/design/sessions", response_model=list[DesignSessionOut])
async def list_design_sessions(session: SessionDep, user: CurrentUser) -> list[DesignSessionOut]:
    rows = await session.scalars(
        select(DesignSession)
        .where(DesignSession.user_id == user.id)
        .order_by(DesignSession.created_at.desc())
    )
    return [DesignSessionOut.model_validate(s) for s in rows]


@router.get("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def get_design_session(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    return DesignSessionOut.model_validate(design_session)


@router.patch("/design/sessions/{session_id}", response_model=DesignSessionOut)
async def update_design_session(
    session_id: uuid.UUID,
    body: DesignSessionUpdateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignSessionOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    assert design_session is not None
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(design_session, field, value)
    await session.commit()
    await session.refresh(design_session)
    return DesignSessionOut.model_validate(design_session)


@router.get("/design/sessions/{session_id}/turns", response_model=list[DesignTurnOut])
async def list_design_turns(
    session_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> list[DesignTurnOut]:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    rows = await session.scalars(
        select(DesignSessionTurn)
        .where(DesignSessionTurn.session_id == session_id)
        .order_by(DesignSessionTurn.seq)
    )
    return [DesignTurnOut.model_validate(t) for t in rows]


@router.post("/design/sessions/{session_id}/turns", response_model=DesignTurnOut, status_code=201)
async def append_design_turn(
    session_id: uuid.UUID,
    body: DesignTurnCreateRequest,
    session: SessionDep,
    user: CurrentUser,
) -> DesignTurnOut:
    design_session = await session.get(DesignSession, session_id)
    ensure_owner(design_session, user)
    await advisory_xact_lock(session, f"design-session:{session_id}")  # seq 직렬화
    next_seq = (
        await session.scalar(
            select(func.coalesce(func.max(DesignSessionTurn.seq), 0)).where(
                DesignSessionTurn.session_id == session_id
            )
        )
        or 0
    ) + 1
    turn = DesignSessionTurn(
        session_id=session_id, seq=next_seq, role=body.role, payload=body.payload
    )
    session.add(turn)
    await session.commit()
    await session.refresh(turn)
    return DesignTurnOut.model_validate(turn)
