"""Load and validate the Git-authored Plan v3 example set."""

from __future__ import annotations

import hashlib
import json
import re
from functools import lru_cache
from importlib.resources import files
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from worker.authoring.schema import DesignPlanV3

EXAMPLE_SET_REVISION = "gallery-v1"
_SHA256 = re.compile(r"^[0-9a-f]{64}$")


class AuthoringExampleManifest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    example_id: str = Field(pattern=r"^[a-z0-9][a-z0-9_-]{2,63}$")
    family: Literal[
        "solid",
        "stripe",
        "lattice",
        "scatter",
        "path",
        "point_set",
        "stripe_motif",
        "multi_motif",
    ]
    retrieval_text: str = Field(min_length=10, max_length=500)
    tags: list[str] = Field(min_length=1, max_length=16)
    golden_file: str = Field(pattern=r"^[0-9]{2}_[a-z0-9_]+\.json$")
    golden_sha256: str
    plan: DesignPlanV3

    @field_validator("golden_sha256")
    @classmethod
    def _valid_digest(cls, value: str) -> str:
        if not _SHA256.fullmatch(value):
            raise ValueError("golden_sha256 must be lowercase SHA-256")
        return value

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
        return ", ".join([self.retrieval_text, self.family, *self.tags])

    def prompt_example(self) -> dict[str, object]:
        return {
            "example_id": self.example_id,
            "family": self.family,
            "retrieval_text": self.retrieval_text,
            "plan": self.plan.model_dump(mode="json"),
        }


@lru_cache
def load_example_set() -> tuple[AuthoringExampleManifest, ...]:
    resource = files("worker.authoring").joinpath("data", f"{EXAMPLE_SET_REVISION}.json")
    raw = json.loads(resource.read_text(encoding="utf-8"))
    if not isinstance(raw, list):
        raise ValueError("authoring example set must be a JSON array")
    examples = tuple(AuthoringExampleManifest.model_validate(item) for item in raw)
    ids = [example.example_id for example in examples]
    golden_files = [example.golden_file for example in examples]
    if len(examples) != 25:
        raise ValueError("gallery-v1 must contain exactly 25 examples")
    if len(ids) != len(set(ids)) or len(golden_files) != len(set(golden_files)):
        raise ValueError("authoring example IDs and golden files must be unique")
    return examples
