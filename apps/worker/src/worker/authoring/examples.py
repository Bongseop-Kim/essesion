"""Load and validate the small Git-backed Plan v3 starter set."""

from __future__ import annotations

import hashlib
import json
from functools import lru_cache
from importlib.resources import files
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from worker.authoring.schema import DesignPlanV3, structural_fingerprint

AuthoringFamily = Literal[
    "solid",
    "stripe",
    "lattice",
    "scatter",
    "path",
    "point_set",
    "stripe_motif",
    "multi_motif",
]


class AuthoringExampleManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    example_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{2,63}$")
    family: AuthoringFamily
    retrieval_text: str = Field(min_length=10, max_length=500)
    tags: list[str] = Field(min_length=1, max_length=16)
    plan: DesignPlanV3

    @field_validator("tags")
    @classmethod
    def _normalize_tags(cls, values: list[str]) -> list[str]:
        normalized = [value.strip().casefold() for value in values if value.strip()]
        if len(normalized) != len(set(normalized)):
            raise ValueError("example tags must be distinct")
        return normalized

    def source_digest(self) -> str:
        canonical = json.dumps(self.model_dump(mode="json"), sort_keys=True, separators=(",", ":"))
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    def embedding_document(self) -> str:
        return embedding_document(self.retrieval_text, self.family, self.tags)

    def prompt_example(self) -> dict[str, object]:
        return {
            "example_id": self.example_id,
            "family": self.family,
            "retrieval_text": self.retrieval_text,
            "plan": self.plan.model_dump(mode="json"),
        }


@lru_cache
def load_example_set() -> tuple[AuthoringExampleManifest, ...]:
    resource = files("worker.authoring").joinpath("data", "gallery-v1.json")
    raw = json.loads(resource.read_text(encoding="utf-8"))
    return _validate_example_set(raw)


def _validate_example_set(raw: object) -> tuple[AuthoringExampleManifest, ...]:
    if not isinstance(raw, list):
        raise ValueError("authoring example set must be a JSON array")
    examples = tuple(AuthoringExampleManifest.model_validate(item) for item in raw)
    ids = [example.example_id for example in examples]
    if len(ids) != len(set(ids)):
        raise ValueError("authoring example IDs must be unique")
    return examples


def classify_plan_family(plan: DesignPlanV3) -> AuthoringFamily:
    stripes = [layer for layer in plan.layers if layer.type == "stripe"]
    motifs = [layer for layer in plan.layers if layer.type == "motif"]
    if not stripes and not motifs:
        return "solid"
    if not motifs:
        return "stripe"
    if len(plan.motifs) > 1:
        return "multi_motif"
    if stripes:
        return "stripe_motif"
    placement = motifs[0].placement.type
    if placement == "point_template":
        return "point_set"
    return placement


def tags_for_plan(plan: DesignPlanV3, family: AuthoringFamily | None = None) -> list[str]:
    """Deterministic retrieval tags without resolved motif IDs or image bytes."""

    resolved_family = family or classify_plan_family(plan)
    tags: list[str] = [resolved_family]
    for motif in plan.motifs:
        tags.append(motif.source)
    for layer in plan.layers:
        if layer.type == "stripe":
            tags.extend(("stripe", layer.direction))
        else:
            tags.append(layer.placement.type)
    return list(dict.fromkeys(tags))[:16]


def embedding_document(
    retrieval_text: str,
    family: AuthoringFamily,
    tags: list[str],
) -> str:
    return ", ".join([retrieval_text.strip(), family, *tags])


def example_source_digest(
    *,
    retrieval_text: str,
    family: AuthoringFamily,
    tags: list[str],
    plan: DesignPlanV3,
) -> str:
    canonical = json.dumps(
        {
            "retrieval_text": retrieval_text.strip(),
            "family": family,
            "tags": tags,
            "plan": plan.model_dump(mode="json"),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def analyze_authoring_example(
    retrieval_text: str,
    plan: DesignPlanV3,
) -> dict[str, object]:
    """Normalize one authored example and derive all non-user-editable metadata."""

    normalized_text = retrieval_text.strip()
    family = classify_plan_family(plan)
    tags = tags_for_plan(plan, family)
    return {
        "family": family,
        "motif_count": len(plan.motifs),
        "retrieval_text": normalized_text,
        "tags": tags,
        "plan": plan.model_dump(mode="json"),
        "structural_fingerprint": structural_fingerprint(plan),
        "source_digest": example_source_digest(
            retrieval_text=normalized_text,
            family=family,
            tags=tags,
            plan=plan,
        ),
    }
