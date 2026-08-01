"""디자인 첫 진입 예시 — 큐레이션 갤러리와 무과금 세션 시작.

세션 상태는 전부 run 로그에서 파생되므로(`_resolve_design_run`) 예시 시작은 렌더·
워커 호출 없이 세션 1개 + 턴 2개(generate succeeded + activate)만 만들면 된다.
"""

import uuid
from typing import Any

from db.models.design import DesignExample, DesignSession
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser, SettingsDep
from api.domains.design.router import (
    DesignAssistantGenerationPayload,
    DesignSessionOut,
    DesignStepActivateTurnPayload,
    _append_turn,
    _design_session_out,
    _ensure_intent_motif_access,
    _intent_motif_ids,
    _resolve_design_run,
)
from api.errors import ConflictError, NotFoundError
from api.schemas import StrictModel

router = APIRouter(tags=["design"])
admin_router = APIRouter(prefix="/admin/design/examples", tags=["admin-design-examples"])

# 갤러리는 큐레이션이라 십수 개면 충분하다 — SVG를 통짜로 내려주므로 상한을 둔다.
MAX_PUBLISHED_EXAMPLES = 24
# 카드 라벨 둘째 줄 — 한 줄에 들어가는 길이만 받는다.
MAX_CAPTION_LENGTH = 60


class DesignExampleOut(BaseModel):
    id: uuid.UUID
    name: str
    # 카드 라벨 둘째 줄 — 없으면 store가 제목만 그린다.
    caption: str | None
    preview_svg: str


class AdminDesignExampleOut(DesignExampleOut):
    run_id: uuid.UUID
    ordinal: int
    published: bool


class DesignExampleStartRequest(StrictModel):
    example_id: uuid.UUID


class AdminDesignExampleCreateRequest(StrictModel):
    run_id: uuid.UUID
    name: str = Field(min_length=1, max_length=100)
    caption: str | None = Field(default=None, max_length=MAX_CAPTION_LENGTH)
    ordinal: int = Field(default=0, ge=0)


class AdminDesignExampleUpdateRequest(StrictModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    # 빈 문자열이 지우기 — 생략(null)은 "안 바꿈"이라 지울 수단이 따로 필요하다.
    caption: str | None = Field(default=None, max_length=MAX_CAPTION_LENGTH)
    ordinal: int | None = Field(default=None, ge=0)
    published: bool | None = None


def _preview_svg(design: Any) -> str:
    svg = design.get("svg") if isinstance(design, dict) else None
    return svg if isinstance(svg, str) else ""


async def _examples_with_preview(
    session: SessionDep, *, published_only: bool
) -> list[tuple[DesignExample, str]]:
    query = (
        select(DesignExample, SeamlessGenerationLog.design)
        .join(SeamlessGenerationLog, SeamlessGenerationLog.id == DesignExample.run_id)
        .order_by(DesignExample.ordinal, DesignExample.created_at)
    )
    if published_only:
        query = query.where(DesignExample.published.is_(True)).limit(MAX_PUBLISHED_EXAMPLES)
    rows = await session.execute(query)
    return [(example, _preview_svg(design)) for example, design in rows.all()]


@router.get("/design/examples", response_model=list[DesignExampleOut])
async def list_design_examples(session: SessionDep) -> list[DesignExampleOut]:
    """첫 진입 갤러리 — 상품과 같은 공개 조회. 그릴 수 없는 예시는 내리지 않는다."""
    return [
        DesignExampleOut(
            id=example.id,
            name=example.name,
            caption=example.caption,
            preview_svg=preview_svg,
        )
        for example, preview_svg in await _examples_with_preview(session, published_only=True)
        if preview_svg
    ]


@router.post(
    "/design/sessions/from-example",
    response_model=DesignSessionOut,
    status_code=201,
)
async def create_design_session_from_example(
    body: DesignExampleStartRequest,
    session: SessionDep,
    user: CurrentUser,
    settings: SettingsDep,
) -> DesignSessionOut:
    """예시를 새 세션의 시작점으로 복원한다 — 렌더도 워커 호출도 없어 토큰이 들지 않는다."""
    example = await session.scalar(
        select(DesignExample).where(
            DesignExample.id == body.example_id,
            DesignExample.published.is_(True),
        )
    )
    if example is None:
        raise NotFoundError("예시를 찾을 수 없습니다")
    resolved = await _resolve_design_run(session, run_id=example.run_id)
    # 등록 시점에 비공개 모티프를 막지만, 워커가 실제로 해석할 지점에서 한 번 더 본다.
    await _ensure_intent_motif_access(
        resolved.intent,
        session=session,
        user_id=user.id,
        design_session_id=None,
    )

    design_session = DesignSession(
        user_id=user.id,
        current_intent=resolved.intent,
        current_plan=resolved.plan,
        seed=resolved.seed,
        colorway=resolved.colorway_id,
        registry_version=resolved.log.registry_version,
    )
    session.add(design_session)
    await session.flush()
    await _append_turn(
        session,
        design_session.id,
        "assistant",
        DesignAssistantGenerationPayload(
            run_id=example.run_id,
            status="succeeded",
            summary=example.name,
        ),
    )
    await _append_turn(
        session,
        design_session.id,
        "user",
        DesignStepActivateTurnPayload(
            run_id=example.run_id,
            seed=resolved.seed,
            colorway_id=resolved.colorway_id,
        ),
    )
    await session.commit()
    await session.refresh(design_session)
    return await _design_session_out(session, design_session, settings.design_recraft_budget)


def _admin_out(example: DesignExample, preview_svg: str) -> AdminDesignExampleOut:
    return AdminDesignExampleOut(
        id=example.id,
        name=example.name,
        caption=example.caption,
        preview_svg=preview_svg,
        run_id=example.run_id,
        ordinal=example.ordinal,
        published=example.published,
    )


@admin_router.get("", response_model=list[AdminDesignExampleOut])
async def list_admin_design_examples(
    session: SessionDep, admin: AdminUser
) -> list[AdminDesignExampleOut]:
    return [
        _admin_out(example, preview_svg)
        for example, preview_svg in await _examples_with_preview(session, published_only=False)
    ]


@admin_router.post("", response_model=AdminDesignExampleOut, status_code=201)
async def create_admin_design_example(
    body: AdminDesignExampleCreateRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminDesignExampleOut:
    """run 하나를 예시로 등록한다 — 비공개 모티프를 쓰는 run은 공개할 수 없다."""
    resolved = await _resolve_design_run(session, run_id=body.run_id)
    motif_ids = _intent_motif_ids(resolved.intent)
    if motif_ids:
        private = await session.scalar(
            select(Motif.id).where(Motif.id.in_(motif_ids), Motif.source == "user_upload").limit(1)
        )
        if private is not None:
            raise ConflictError(
                "사용자가 올린 모티프를 쓰는 디자인은 예시로 등록할 수 없습니다",
                code="private_motif_example",
            )
    example = DesignExample(
        run_id=body.run_id,
        name=body.name,
        caption=(body.caption or "").strip() or None,
        ordinal=body.ordinal,
    )
    session.add(example)
    await session.commit()
    await session.refresh(example)
    return _admin_out(example, _preview_svg(resolved.log.design))


async def _example_or_404(session: SessionDep, example_id: uuid.UUID) -> DesignExample:
    example = await session.get(DesignExample, example_id)
    if example is None:
        raise NotFoundError("예시를 찾을 수 없습니다")
    return example


@admin_router.patch("/{example_id}", response_model=AdminDesignExampleOut)
async def update_admin_design_example(
    example_id: uuid.UUID,
    body: AdminDesignExampleUpdateRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminDesignExampleOut:
    example = await _example_or_404(session, example_id)
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(example, field, value.strip() or None if field == "caption" else value)
    await session.commit()
    await session.refresh(example)
    log = await session.get(SeamlessGenerationLog, example.run_id)
    return _admin_out(example, _preview_svg(log.design if log is not None else None))


@admin_router.delete("/{example_id}", status_code=204)
async def delete_admin_design_example(
    example_id: uuid.UUID, session: SessionDep, admin: AdminUser
) -> None:
    await session.delete(await _example_or_404(session, example_id))
    await session.commit()
