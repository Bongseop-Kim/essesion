"""Paid Recraft vs GPT Image 2 motif pilot.

Usage:
  uv run python apps/worker/scripts/eval_motif_adapters.py --confirm-live

The script writes only local scratch artifacts. It does not read or mutate the database and it
does not change the runtime adapter wiring. GPT low and medium traces reuse the same paid PNGs.
"""

from __future__ import annotations

import argparse
import asyncio
import html
import json
import re
import shutil
import time
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from worker.adapters import AdapterClientError
from worker.adapters.gpt_image import (
    GPTImageHTTPClient,
    build_gpt_image_client,
    vectorize_png_motif,
)
from worker.adapters.gpt_image import (
    generate_motif as generate_gpt_image_motif,
)
from worker.adapters.recraft import (
    RecraftHTTPClient,
    build_recraft_client,
    gate_recraft_svg,
)
from worker.adapters.recraft import (
    generate_motif as generate_recraft_motif,
)
from worker.config import Settings, get_settings
from worker.motifs.normalize import (
    MAX_MOTIF_NODES,
    MAX_MOTIF_PATH_COMMANDS,
    MAX_MOTIF_PATHS,
    MAX_MOTIF_SVG_BYTES,
    NormalizedMotif,
    normalize_motif_svg,
)
from worker.render.raster import rasterize_svg

_PATH_COMMAND = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]")
_RECRAFT_UNIT_COST = 0.08
_GPT_IMAGE_UNIT_COST = 0.006


@dataclass(frozen=True)
class EvalCase:
    case_id: str
    subject: str
    stroke_risk: bool = False


CASES = [
    EvalCase("motif-01", "청록과 코랄색의 클래식 페이즐리 장식 한 개"),
    EvalCase("motif-02", "붉은 동백꽃 정면 한 송이"),
    EvalCase("motif-03", "둥근 꽃잎의 빈티지 플로럴 메달리온 한 개"),
    EvalCase("motif-04", "은행잎 한 장의 평면 도형"),
    EvalCase("motif-05", "날개를 펼친 나비 실루엣"),
    EvalCase("motif-06", "옆모습의 고래 실루엣"),
    EvalCase("motif-07", "앉아 있는 토끼 실루엣"),
    EvalCase("motif-08", "꼬리를 말고 앉은 고양이 실루엣"),
    EvalCase("motif-09", "달리는 여우의 단순한 실루엣"),
    EvalCase("motif-10", "석류 열매와 잎을 합친 장식 모티프 한 개"),
    EvalCase("motif-11", "팔각 별이 중심인 이슬람 기하 문양 한 개"),
    EvalCase("motif-12", "아르데코 부채꼴 장식 한 개"),
    EvalCase("motif-13", "둥근 구름 아이콘 한 개"),
    EvalCase("motif-14", "눈 결정 모양의 대칭 눈송이 한 개"),
    EvalCase("motif-15", "작은 잎 세 장이 달린 클로버 한 개"),
    EvalCase("stroke-01", "매우 가는 단선으로 그린 잎사귀 line art 한 개", True),
    EvalCase("stroke-02", "한 붓 그리기 스타일의 날아가는 새 한 마리", True),
    EvalCase("stroke-03", "가는 윤곽선만 있는 튤립 꽃 한 송이", True),
    EvalCase("stroke-04", "얇은 선으로 그린 초승달과 작은 별 하나", True),
    EvalCase("stroke-05", "가는 모노라인으로 만든 육각형 매듭 도형", True),
]


@dataclass(frozen=True)
class SvgMetrics:
    nodes: int
    paths: int
    path_commands: int
    svg_bytes: int
    node_budget_ratio: float
    path_budget_ratio: float
    command_budget_ratio: float
    byte_budget_ratio: float


@dataclass
class EvalResult:
    case_id: str
    subject: str
    stroke_risk: bool
    adapter: str
    passed: bool
    attempts: int
    elapsed_seconds: float
    error: str | None = None
    metrics: SvgMetrics | None = None
    svg_file: str | None = None
    png_file: str | None = None
    reuses_gpt_outputs: bool = False


class TrackingRecraftClient:
    def __init__(self, inner: RecraftHTTPClient) -> None:
        self.inner = inner
        self.outputs: list[str] = []

    async def generate(self, prompt: str, *, seed: int | None = None) -> str:
        output = await self.inner.generate(prompt, seed=seed)
        self.outputs.append(output)
        return output


class TrackingGPTImageClient:
    def __init__(self, inner: GPTImageHTTPClient) -> None:
        self.inner = inner
        self.outputs: list[bytes] = []

    async def generate(self, prompt: str, *, seed: int | None = None) -> bytes:
        output = await self.inner.generate(prompt, seed=seed)
        self.outputs.append(output)
        return output


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Recraft와 OpenAI의 유료 이미지 호출을 명시적으로 승인합니다.",
    )
    parser.add_argument("--limit", type=int, help="첫 N개 케이스만 실행합니다.")
    parser.add_argument("--output-dir", type=Path, help="새 산출물 디렉터리")
    return parser.parse_args()


def _metrics(svg: str) -> SvgMetrics:
    root = ET.fromstring(svg)
    elements = list(root.iter())
    paths = [element for element in elements if element.tag.rsplit("}", 1)[-1] == "path"]
    commands = sum(len(_PATH_COMMAND.findall(path.get("d", ""))) for path in paths)
    svg_bytes = len(svg.encode("utf-8"))
    return SvgMetrics(
        nodes=len(elements),
        paths=len(paths),
        path_commands=commands,
        svg_bytes=svg_bytes,
        node_budget_ratio=round(len(elements) / MAX_MOTIF_NODES, 4),
        path_budget_ratio=round(len(paths) / MAX_MOTIF_PATHS, 4),
        command_budget_ratio=round(commands / MAX_MOTIF_PATH_COMMANDS, 4),
        byte_budget_ratio=round(svg_bytes / MAX_MOTIF_SVG_BYTES, 4),
    )


def _save_motif(
    result: EvalResult,
    motif: NormalizedMotif,
    *,
    output_dir: Path,
) -> None:
    assets = output_dir / "assets"
    stem = f"{result.case_id}-{result.adapter.replace('_', '-')}"
    svg_path = assets / f"{stem}.svg"
    png_path = assets / f"{stem}.png"
    svg_path.write_text(motif.preview_svg, encoding="utf-8")
    png, _media = rasterize_svg(
        motif.preview_svg,
        width_mm=48.0,
        height_mm=48.0,
        dpi=300,
    )
    png_path.write_bytes(png)
    result.metrics = _metrics(motif.preview_svg)
    result.svg_file = svg_path.relative_to(output_dir).as_posix()
    result.png_file = png_path.relative_to(output_dir).as_posix()


def _normalize_recraft(raw_svg: str, settings: Settings) -> NormalizedMotif:
    return normalize_motif_svg(
        gate_recraft_svg(raw_svg),
        max_aspect_ratio=settings.motif_max_aspect_ratio,
        edge_seam_tol=settings.motif_edge_seam_tol,
        render_check=settings.motif_render_check,
    )


def _last_recraft_gate_error(outputs: list[str], settings: Settings) -> str | None:
    last_error: str | None = None
    for output in outputs:
        try:
            _normalize_recraft(output, settings)
        except Exception as exc:
            last_error = str(exc)
    return last_error


def _last_gpt_gate_error(
    outputs: list[bytes],
    settings: Settings,
    simplification: Literal["low", "medium"],
) -> str | None:
    last_error: str | None = None
    for output in outputs:
        try:
            vectorize_png_motif(output, settings=settings, simplification=simplification)
        except Exception as exc:
            last_error = str(exc)
    return last_error


async def _evaluate_recraft(
    case: EvalCase,
    *,
    client: RecraftHTTPClient,
    settings: Settings,
    output_dir: Path,
    seed: int,
) -> EvalResult:
    tracked = TrackingRecraftClient(client)
    started = time.perf_counter()
    try:
        motif = await generate_recraft_motif(
            {"subject": case.subject}, client=tracked, settings=settings, seed=seed
        )
    except AdapterClientError as exc:
        error = _last_recraft_gate_error(tracked.outputs, settings) or str(exc)
        for index, raw_svg in enumerate(tracked.outputs, start=1):
            raw_path = output_dir / "assets" / f"{case.case_id}-recraft-attempt-{index}-raw.svg"
            raw_path.write_text(raw_svg, encoding="utf-8")
        return EvalResult(
            case.case_id,
            case.subject,
            case.stroke_risk,
            "recraft",
            False,
            len(tracked.outputs),
            round(time.perf_counter() - started, 3),
            error=error,
        )
    result = EvalResult(
        case.case_id,
        case.subject,
        case.stroke_risk,
        "recraft",
        True,
        len(tracked.outputs),
        round(time.perf_counter() - started, 3),
    )
    for index, raw_svg in enumerate(tracked.outputs, start=1):
        (output_dir / "assets" / f"{case.case_id}-recraft-attempt-{index}-raw.svg").write_text(
            raw_svg, encoding="utf-8"
        )
    _save_motif(result, motif, output_dir=output_dir)
    return result


async def _evaluate_gpt_image(
    case: EvalCase,
    *,
    client: GPTImageHTTPClient,
    settings: Settings,
    output_dir: Path,
    seed: int,
) -> tuple[EvalResult, EvalResult]:
    tracked = TrackingGPTImageClient(client)
    started = time.perf_counter()
    try:
        motif = await generate_gpt_image_motif(
            {"subject": case.subject},
            client=tracked,
            settings=settings,
            seed=seed,
            simplification="low",
        )
    except AdapterClientError as exc:
        low = EvalResult(
            case.case_id,
            case.subject,
            case.stroke_risk,
            "gpt_image_low",
            False,
            len(tracked.outputs),
            round(time.perf_counter() - started, 3),
            error=_last_gpt_gate_error(tracked.outputs, settings, "low") or str(exc),
        )
    else:
        low = EvalResult(
            case.case_id,
            case.subject,
            case.stroke_risk,
            "gpt_image_low",
            True,
            len(tracked.outputs),
            round(time.perf_counter() - started, 3),
        )
        _save_motif(low, motif, output_dir=output_dir)

    for index, raw_png in enumerate(tracked.outputs, start=1):
        (output_dir / "assets" / f"{case.case_id}-gpt-attempt-{index}-raw.png").write_bytes(raw_png)

    medium_started = time.perf_counter()
    medium_motif: NormalizedMotif | None = None
    medium_error: str | None = None
    medium_attempts = 0
    for attempt_index, raw_png in enumerate(tracked.outputs, start=1):
        medium_attempts = attempt_index
        try:
            medium_motif = vectorize_png_motif(
                raw_png,
                settings=settings,
                simplification="medium",
            )
        except Exception as exc:
            medium_error = str(exc)
            continue
        break
    if not tracked.outputs:
        medium_error = low.error
    medium = EvalResult(
        case.case_id,
        case.subject,
        case.stroke_risk,
        "gpt_image_medium_probe",
        medium_motif is not None,
        medium_attempts,
        round(time.perf_counter() - medium_started, 3),
        error=None if medium_motif is not None else medium_error,
        reuses_gpt_outputs=True,
    )
    if medium_motif is not None:
        _save_motif(medium, medium_motif, output_dir=output_dir)
    return low, medium


def _format_metric(result: EvalResult) -> str:
    if result.metrics is None:
        return "-"
    metric = result.metrics
    return (
        f"{metric.nodes}/{MAX_MOTIF_NODES} nodes, "
        f"{metric.paths}/{MAX_MOTIF_PATHS} paths, "
        f"{metric.path_commands}/{MAX_MOTIF_PATH_COMMANDS} cmds, "
        f"{metric.svg_bytes}/{MAX_MOTIF_SVG_BYTES} bytes"
    )


def _print_summary(results: list[EvalResult]) -> None:
    headers = ("case", "adapter", "pass", "tries", "seconds", "budget", "error")
    rows = [
        (
            result.case_id,
            result.adapter,
            "yes" if result.passed else "no",
            str(result.attempts),
            f"{result.elapsed_seconds:.3f}",
            _format_metric(result),
            result.error or "",
        )
        for result in results
    ]
    widths = [
        min(80, max(len(headers[index]), *(len(row[index]) for row in rows)))
        for index in range(len(headers))
    ]

    def line(values: tuple[str, ...]) -> str:
        return " | ".join(
            value[: widths[index]].ljust(widths[index]) for index, value in enumerate(values)
        )

    print(line(headers))
    print("-+-".join("-" * width for width in widths))
    for row in rows:
        print(line(row))

    print()
    for adapter in ("recraft", "gpt_image_low", "gpt_image_medium_probe"):
        selected = [result for result in results if result.adapter == adapter]
        passed = sum(result.passed for result in selected)
        print(f"{adapter}: {passed}/{len(selected)} passed")
    recraft_attempts = sum(result.attempts for result in results if result.adapter == "recraft")
    gpt_attempts = sum(result.attempts for result in results if result.adapter == "gpt_image_low")
    estimated_cost = recraft_attempts * _RECRAFT_UNIT_COST + gpt_attempts * _GPT_IMAGE_UNIT_COST
    print(f"estimated image output cost: ${estimated_cost:.3f}")


def _gallery_card(result: EvalResult | None) -> str:
    if result is None:
        return "<div class='card missing'>missing result</div>"
    image = (
        f"<img src='{html.escape(result.png_file)}' alt='{html.escape(result.adapter)}'>"
        if result.png_file
        else "<div class='failure'>gate failed</div>"
    )
    detail = html.escape(_format_metric(result))
    error = f"<pre>{html.escape(result.error)}</pre>" if result.error else ""
    return (
        "<div class='card'>"
        f"<h3>{html.escape(result.adapter)}</h3>{image}"
        f"<p>{'pass' if result.passed else 'fail'} · {result.attempts} attempt(s) · "
        f"{result.elapsed_seconds:.3f}s</p><small>{detail}</small>{error}</div>"
    )


def _write_gallery(results: list[EvalResult], cases: list[EvalCase], output_dir: Path) -> None:
    by_key = {(result.case_id, result.adapter): result for result in results}
    sections = []
    for case in cases:
        badge = " <span>stroke risk</span>" if case.stroke_risk else ""
        cards = "".join(
            _gallery_card(by_key.get((case.case_id, adapter)))
            for adapter in ("recraft", "gpt_image_low", "gpt_image_medium_probe")
        )
        sections.append(
            f"<section><h2>{html.escape(case.case_id)}{badge}</h2>"
            f"<p>{html.escape(case.subject)}</p><div class='grid'>{cards}</div></section>"
        )
    document = """<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>Motif adapter pilot</title><style>
body{font:15px system-ui,sans-serif;margin:24px;background:#f4f2ed;color:#1d1d1b}
section{background:white;border:1px solid #d8d4ca;border-radius:12px;padding:18px;margin:0 0 20px}
h2{margin:0}h2 span{font-size:12px;color:#a33}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.card{min-width:0}.card h3{font-size:14px}
.card img,.failure{width:100%;aspect-ratio:1;object-fit:contain;background:#fff}
.failure{display:grid;place-items:center;color:#a33}
.card p,.card small{display:block;overflow-wrap:anywhere}
pre{white-space:pre-wrap;color:#a33;font-size:12px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
</style></head><body><h1>Recraft vs GPT Image 2 + VTracer</h1>"""
    document += "".join(sections) + "</body></html>"
    (output_dir / "gallery.html").write_text(document, encoding="utf-8")


async def _main() -> None:
    args = _arguments()
    if not args.confirm_live:
        raise SystemExit("--confirm-live 없이는 유료 이미지 API 평가를 실행하지 않습니다.")
    if args.limit is not None and args.limit < 1:
        raise SystemExit("--limit must be positive")
    if not (shutil.which("rsvg-convert") or shutil.which("resvg")):
        raise SystemExit("rsvg-convert 또는 resvg가 없어 갤러리 PNG를 만들 수 없습니다.")

    settings = get_settings()
    recraft = build_recraft_client(settings)
    gpt_image = build_gpt_image_client(settings)
    if recraft is None:
        raise SystemExit("RECRAFT_API_KEY가 없어 비교 평가를 실행할 수 없습니다.")
    if gpt_image is None:
        raise SystemExit("OPENAI_API_KEY가 없어 비교 평가를 실행할 수 없습니다.")

    selected = CASES[: args.limit] if args.limit is not None else CASES
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    output_dir = args.output_dir or Path("scratch") / f"motif-adapter-eval-{timestamp}"
    try:
        output_dir.mkdir(parents=True, exist_ok=False)
    except FileExistsError as exc:
        raise SystemExit(f"output directory already exists: {output_dir}") from exc
    (output_dir / "assets").mkdir()

    results: list[EvalResult] = []
    try:
        for index, case in enumerate(selected, start=1):
            print(f"[{index}/{len(selected)}] {case.case_id}", flush=True)
            results.append(
                await _evaluate_recraft(
                    case,
                    client=recraft,
                    settings=settings,
                    output_dir=output_dir,
                    seed=10_000 + index,
                )
            )
            low, medium = await _evaluate_gpt_image(
                case,
                client=gpt_image,
                settings=settings,
                output_dir=output_dir,
                seed=10_000 + index,
            )
            results += [low, medium]
    finally:
        await recraft.aclose()
        await gpt_image.aclose()

    payload = {
        "created_at": datetime.now(UTC).isoformat(),
        "cases": [asdict(case) for case in selected],
        "results": [asdict(result) for result in results],
    }
    (output_dir / "results.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    _write_gallery(results, selected, output_dir)
    _print_summary(results)
    print(f"artifacts: {output_dir}")


if __name__ == "__main__":
    asyncio.run(_main())
