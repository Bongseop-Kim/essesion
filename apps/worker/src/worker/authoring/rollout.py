"""Deterministic deployment-controlled Plan v3 cohort selection."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class AuthoringCohort:
    pipeline: Literal["legacy", "v3"]
    shadow_v3: bool = False


def _bucket(request_id: str) -> int:
    digest = hashlib.sha256(request_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") % 100


def select_authoring_cohort(settings, request_id: str) -> AuthoringCohort:  # noqa: ANN001
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
