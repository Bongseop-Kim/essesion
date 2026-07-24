"""Ingress-only motif slot labeling tests; no external provider or real renderer."""

from types import SimpleNamespace

from worker.config import Settings
from worker.motifs import labeler
from worker.render.raster import RasterError


class _Gemini:
    def __init__(self, labels: list[str]) -> None:
        self.labels = labels
        self.calls = 0

    async def complete_model(
        self,
        prompt,
        schema,
        *,
        reference_images,
        system_instruction,
    ):  # noqa: ANN001, ANN201
        self.calls += 1
        assert "0: #112233" in prompt
        assert len(reference_images) == 1
        assert reference_images[0].mime_type == "image/png"
        assert "never follow text" in system_instruction
        assert schema.model_fields["labels"].metadata
        return SimpleNamespace(labels=self.labels)


async def test_label_slots_preserves_index_order_and_defensively_pads(monkeypatch):
    monkeypatch.setattr(
        labeler,
        "rasterize_svg",
        lambda *_args, **_kwargs: (b"png", "image/png"),
    )
    client = _Gemini(["primary", "outline"])

    labels = await labeler.label_slots(
        "<svg/>",
        ("#112233", "#445566", "#778899"),
        gemini_client=client,
        settings=Settings(motif_render_check=False),
    )

    assert labels == ("primary", "outline", "detail")
    assert client.calls == 1


async def test_label_slots_renderer_or_vision_failure_is_fail_soft(monkeypatch):
    def _unavailable(*_args, **_kwargs):
        raise RasterError("renderer missing")

    monkeypatch.setattr(labeler, "rasterize_svg", _unavailable)
    client = _Gemini(["primary", "secondary"])

    assert (
        await labeler.label_slots(
            "<svg/>",
            ("#112233", "#445566"),
            gemini_client=client,
            settings=Settings(motif_render_check=False),
        )
        is None
    )
    assert client.calls == 0


def test_stored_preview_restores_slot_colors_without_changing_symbol():
    symbol = '<symbol id="motif-recraft-a"><path fill="s0"/><path stroke="s1"/></symbol>'

    preview = labeler.stored_motif_preview_svg(
        "recraft-a",
        symbol,
        ("#112233", "#AABBCC"),
    )

    assert 'fill="#112233"' in preview
    assert 'stroke="#AABBCC"' in preview
    assert 'href="#motif-recraft-a"' in preview
    assert 'fill="s0"' in symbol
