"""디자인 첫 진입 예시 — 큐레이션 갤러리와 무과금 세션 시작.

세션 상태는 전부 run 로그에서 파생되므로(`_resolve_design_run`) 예시 시작은 렌더·
워커 호출 없이 세션 1개 + 턴 2개(generate succeeded + activate)만 만들면 된다.
"""

import uuid
from typing import Any, Literal

from db.models.design import DesignExample, DesignSession
from db.models.seamless import Motif, SeamlessGenerationLog
from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import func, select

from api.db import SessionDep
from api.deps import AdminUser, CurrentUser
from api.domains.design.router import (
    DesignAssistantGenerationPayload,
    DesignSessionOut,
    DesignStepActivateTurnPayload,
    _append_turn,
    _design_session_out,
    _ensure_intent_motif_access,
    _intent_motif_ids,
    _motif_preview_svg,
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


class DesignExampleColorway(BaseModel):
    id: str
    name: str | None
    mapping: dict[str, str]


class DesignExampleOut(BaseModel):
    id: uuid.UUID
    name: str
    # 카드 라벨 둘째 줄 — 없으면 store가 제목만 그린다.
    caption: str | None
    preview_svg: str
    # 템플릿 데이터 — 정본은 시드 코드, 컬럼은 전달용(플랜 design-template-first 2026-10-14).
    category: str | None
    point: Literal["none", "top", "bottom"]
    logo_slot: Literal[1, 2] | None
    photo_full_url: str | None
    photo_detail_url: str | None
    # 로고 슬롯 모티프의 미리보기(세션 `current_motifs[].preview_svg`와 같은 형식) — 포인트
    # 로고 자리의 자리표시. 슬롯이 없거나 그 자리에 모티프가 없으면 null.
    logo_preview_svg: str | None
    # run intent의 colorways 그대로(`default` + 실 색 프리셋) — 색 고르기 화면의 선택지와 같은 목록.
    colorways: list[DesignExampleColorway]


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


def _colorways(design: Any) -> list[DesignExampleColorway]:
    intent = design.get("intent") if isinstance(design, dict) else None
    raw = intent.get("colorways") if isinstance(intent, dict) else None
    return [DesignExampleColorway.model_validate(item) for item in raw] if raw else []


def _logo_slot_motif_id(example: DesignExample, design: Any) -> str | None:
    """로고 슬롯(1|2)에 지금 들어 있는 모티프 id — run 디자인의 intent 레이어 순서다."""
    if example.logo_slot is None or not isinstance(design, dict):
        return None
    motif_ids = _intent_motif_ids(design.get("intent"))
    return motif_ids[example.logo_slot - 1] if len(motif_ids) >= example.logo_slot else None


def _example_out(
    example: DesignExample,
    preview_svg: str,
    logo_preview_svg: str | None,
    colorways: list[DesignExampleColorway] | None = None,
) -> DesignExampleOut:
    return DesignExampleOut(
        id=example.id,
        name=example.name,
        caption=example.caption,
        preview_svg=preview_svg,
        category=example.category,
        point=example.point,  # type: ignore[arg-type]  # CHECK 제약이 값을 보장한다
        logo_slot=example.logo_slot,  # type: ignore[arg-type]
        photo_full_url=example.photo_full_url,
        photo_detail_url=example.photo_detail_url,
        logo_preview_svg=logo_preview_svg,
        colorways=colorways or [],
    )


async def _examples_with_preview(
    session: SessionDep, *, published_only: bool
) -> list[tuple[DesignExample, str, str | None, list[DesignExampleColorway]]]:
    """(예시, 디자인 SVG, 로고 슬롯 모티프 미리보기, colorways) — 슬롯 모티프는 한 번에 조회한다."""
    query = (
        select(DesignExample, SeamlessGenerationLog.design)
        .join(SeamlessGenerationLog, SeamlessGenerationLog.id == DesignExample.run_id)
        .order_by(DesignExample.ordinal, DesignExample.created_at)
    )
    if published_only:
        query = query.where(DesignExample.published.is_(True)).limit(MAX_PUBLISHED_EXAMPLES)
    rows = [(example, design) for example, design in (await session.execute(query)).all()]
    slot_ids = {
        motif_id
        for example, design in rows
        if (motif_id := _logo_slot_motif_id(example, design)) is not None
    }
    motifs = (
        {
            motif.id: _motif_preview_svg(motif)
            for motif in await session.scalars(select(Motif).where(Motif.id.in_(slot_ids)))
        }
        if slot_ids
        else {}
    )
    return [
        (
            example,
            _preview_svg(design),
            motifs.get(_logo_slot_motif_id(example, design) or ""),
            _colorways(design),
        )
        for example, design in rows
    ]


@router.get("/design/examples", response_model=list[DesignExampleOut])
async def list_design_examples(session: SessionDep) -> list[DesignExampleOut]:
    """첫 진입 갤러리 — 상품과 같은 공개 조회. 그릴 수 없는 예시는 내리지 않는다."""
    return [
        _example_out(example, preview_svg, logo_preview_svg, colorways)
        for example, preview_svg, logo_preview_svg, colorways in await _examples_with_preview(
            session, published_only=True
        )
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
        example_id=example.id,
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
    return await _design_session_out(session, design_session)


def _admin_out(
    example: DesignExample, preview_svg: str, logo_preview_svg: str | None = None
) -> AdminDesignExampleOut:
    return AdminDesignExampleOut(
        **_example_out(example, preview_svg, logo_preview_svg).model_dump(),
        run_id=example.run_id,
        ordinal=example.ordinal,
        published=example.published,
    )


@admin_router.get("", response_model=list[AdminDesignExampleOut])
async def list_admin_design_examples(
    session: SessionDep, admin: AdminUser
) -> list[AdminDesignExampleOut]:
    return [
        _admin_out(example, preview_svg, logo_preview_svg)
        for example, preview_svg, logo_preview_svg, _ in await _examples_with_preview(
            session, published_only=False
        )
    ]


@admin_router.post("", response_model=AdminDesignExampleOut, status_code=201)
async def create_admin_design_example(
    body: AdminDesignExampleCreateRequest,
    session: SessionDep,
    admin: AdminUser,
) -> AdminDesignExampleOut:
    """run 하나를 예시로 등록한다 — 비공개 모티프를 쓰는 run은 공개할 수 없다."""
    resolved = await _resolve_design_run(session, run_id=body.run_id)
    duplicate = await session.scalar(
        select(DesignExample.id).where(DesignExample.run_id == body.run_id).limit(1)
    )
    if duplicate is not None:
        raise ConflictError(
            "이미 같은 run으로 등록된 예시가 있습니다",
            code="duplicate_example_run",
        )
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
    if body.published and not example.published:
        published_count = await session.scalar(
            select(func.count())
            .select_from(DesignExample)
            .where(DesignExample.published.is_(True), DesignExample.id != example.id)
        )
        if (published_count or 0) >= MAX_PUBLISHED_EXAMPLES:
            raise ConflictError(
                f"게시 예시는 최대 {MAX_PUBLISHED_EXAMPLES}개까지입니다 — "
                "먼저 다른 예시를 내려주세요",
                code="published_example_limit",
            )
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
