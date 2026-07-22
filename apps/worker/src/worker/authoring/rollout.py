"""DB-controlled, deterministic Plan v3 cohort selection."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal

from db.models.commerce import AdminSetting
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

AuthoringPipelineMode = Literal["legacy", "shadow", "canary", "v3"]
_SETTING_KEYS = {
    "authoring_pipeline_mode",
    "authoring_shadow_percent",
    "authoring_canary_percent",
}


@dataclass(frozen=True)
class AuthoringRuntimeSettings:
    authoring_pipeline_mode: AuthoringPipelineMode = "legacy"
    authoring_shadow_percent: int = 5
    authoring_canary_percent: int = 10
    status: Literal["ok", "missing", "invalid"] = "ok"
    reason: str | None = None


@dataclass(frozen=True)
class AuthoringCohort:
    pipeline: Literal["legacy", "v3"]
    shadow_v3: bool = False


def _bucket(request_id: str) -> int:
    digest = hashlib.sha256(request_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % 100


async def load_authoring_runtime_settings(session: AsyncSession) -> AuthoringRuntimeSettings:
    rows = await session.execute(
        select(AdminSetting.key, AdminSetting.value).where(AdminSetting.key.in_(_SETTING_KEYS))
    )
    values = {key: value for key, value in rows}
    missing = sorted(_SETTING_KEYS - values.keys())
    if missing:
        return AuthoringRuntimeSettings(
            authoring_pipeline_mode="legacy",
            status="missing",
            reason=",".join(missing),
        )
    try:
        mode = values["authoring_pipeline_mode"]
        if mode not in {"legacy", "shadow", "canary", "v3"}:
            raise ValueError("mode")
        shadow = int(values["authoring_shadow_percent"] or "")
        canary = int(values["authoring_canary_percent"] or "")
        if not 0 <= shadow <= 100 or not 0 <= canary <= 100:
            raise ValueError("percent")
    except (TypeError, ValueError):
        return AuthoringRuntimeSettings(
            authoring_pipeline_mode="legacy",
            status="invalid",
            reason="invalid_value",
        )
    return AuthoringRuntimeSettings(
        authoring_pipeline_mode=mode,
        authoring_shadow_percent=shadow,
        authoring_canary_percent=canary,
    )


def select_authoring_cohort(settings: AuthoringRuntimeSettings, request_id: str) -> AuthoringCohort:
    mode = settings.authoring_pipeline_mode
    bucket = _bucket(request_id)
    if mode == "v3":
        return AuthoringCohort(pipeline="v3")
    if mode == "canary":
        pipeline = "v3" if bucket < settings.authoring_canary_percent else "legacy"
        return AuthoringCohort(pipeline=pipeline)
    if mode == "shadow":
        return AuthoringCohort(
            pipeline="legacy",
            shadow_v3=bucket < settings.authoring_shadow_percent,
        )
    return AuthoringCohort(pipeline="legacy")
