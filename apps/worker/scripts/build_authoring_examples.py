"""Build the reviewable Plan v3 gallery manifest from test-only golden intents.

The command prints JSON by default. ``--check`` verifies the committed runtime manifest without
rewriting it; developers review and apply regenerated JSON through the normal Git workflow.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
from typing import Any

GOLDEN_DIR = Path(__file__).parents[1] / "tests/golden/json"
MANIFEST = Path(__file__).parents[1] / "src/worker/authoring/data/gallery-v1.json"

_DESCRIPTIONS = {
    "01": "단색 배경만 사용하는 미니멀 솔리드 패턴 / minimal solid background",
    "02": "좁은 한 줄 대각 스트라이프 / narrow single diagonal stripe",
    "03": "폭이 다른 두 줄 대각 스트라이프 / uneven two-band diagonal stripe",
    "04": "넓은 한 줄 대각 스트라이프 / broad single diagonal stripe",
    "05": "세 줄 리듬의 대각 스트라이프 / three-band rhythmic diagonal stripe",
    "06": "큰 모티프의 정규 격자 반복 / regular block lattice motif",
    "07": "열 방향 하프드롭 모티프 / half-drop column motif lattice",
    "08": "행 방향 브릭 반복 모티프 / brick row motif lattice",
    "09": "여백 있는 포아송 산포 모티프 / sparse poisson scattered motif",
    "10": "사틴 순열로 분산된 모티프 / sateen ordered scatter motif",
    "11": "대각 직선 경로를 따르는 모티프 / motif following a straight diagonal path",
    "12": "대각 물결 경로를 따르는 모티프 / motif following a diagonal wave path",
    "13": "안쪽 네 모서리와 중앙의 5점 모티프 / five-anchor inset quincunx motif",
    "14": "작은 모티프의 촘촘한 정규 격자 / small dense lattice motif",
    "15": "넓은 스트라이프 중앙 레인의 모티프 / motif centered on a broad stripe lane",
    "16": "세 개의 얇은 밴드와 직선 경로 모티프 / three thin bands with straight path motif",
    "17": "가드 밴드 사이 중심 레인의 모티프 / motif on guarded stripe center lane",
    "18": "두 밴드와 대각 두 점 모티프 / two bands with diagonal pair point motif",
    "19": "얇은 밴드 위 대각 물결 모티프 / thin bands with diagonal wave motif",
    "20": "리듬 스트라이프의 특정 밴드 중앙 모티프 / rhythmic stripe with motif on selected band",
    "21": "작은 포인트 그리드와 큰 격자 모티프 조합 / point grid filler plus lattice motif",
    "22": "위상이 엇갈린 두 직선 경로 모티프 / two phase-offset straight path motifs",
    "23": "격자 필러와 포아송 메인 모티프 / lattice filler plus poisson main motif",
    "24": "위상이 엇갈린 두 물결 경로 모티프 / two phase-offset wave motifs",
    "25": "서로 다른 스트라이프 밴드를 따르는 두 모티프 / two motifs on opposed stripe bands",
}


def _direction(angle: float) -> str:
    normalized = angle % 360
    if math.isclose(normalized, 360 - 33.690067525979785, abs_tol=1e-5):
        return "diagonal_2_3_up"
    if math.isclose(normalized, 33.690067525979785, abs_tol=1e-5):
        return "diagonal_2_3_down"
    if math.isclose(normalized, 315):
        return "diagonal_up"
    if math.isclose(normalized, 45):
        return "diagonal_down"
    if math.isclose(normalized, 90):
        return "vertical"
    return "horizontal"


def _path_length(tile_mm: float, direction: str) -> float:
    if direction.startswith("diagonal_2_3"):
        return tile_mm * math.sqrt(13)
    return tile_mm * (math.sqrt(2) if direction.startswith("diagonal") else 1)


def _ratio(value: float) -> float:
    return round(float(value), 8)


def _family(number: str) -> str:
    if number == "01":
        return "solid"
    if int(number) <= 5:
        return "stripe"
    if number in {"06", "07", "08", "14"}:
        return "lattice"
    if number in {"09", "10"}:
        return "scatter"
    if number in {"11", "12"}:
        return "path"
    if number == "13":
        return "point_set"
    if int(number) <= 20:
        return "stripe_motif"
    return "multi_motif"


def _placement(
    raw: dict[str, Any],
    *,
    tile_mm: float,
    stripe_layers: list[dict[str, Any]],
) -> dict[str, Any]:
    placement_type = raw["type"]
    if placement_type == "lattice":
        spec = raw["lattice"]
        drop = "none"
        if spec.get("drop_fraction"):
            drop = "half_row" if spec.get("drop_axis", "column") == "row" else "half_column"
        output = {
            "type": "lattice",
            "columns": round(tile_mm / float(spec["cell_w_mm"])),
            "rows": round(tile_mm / float(spec["cell_h_mm"])),
            "drop": drop,
        }
    elif placement_type == "scatter":
        spec = raw["scatter"]
        mode = spec.get("mode", "poisson")
        output = {"type": "scatter", "mode": mode}
        if mode == "poisson":
            min_distance = float(spec["min_dist_mm"])
            inferred = max(
                1,
                int(((tile_mm / min_distance) ** 2) / (math.sqrt(3) / 2)),
            )
            output.update(
                count=spec.get("count", inferred),
                min_distance_ratio=_ratio(min_distance / tile_mm),
            )
        else:
            output.update(order=spec["sateen_n"], step=spec["sateen_step"])
    elif placement_type == "point_set":
        point_count = len(raw["point_set"]["points"])
        template = {
            2: "diagonal_pair",
            5: "quincunx_inset",
            16: "grid4_inset",
        }[point_count]
        output = {"type": "point_template", "template": template}
    else:
        output = _path_placement(raw, tile_mm=tile_mm, stripe_layers=stripe_layers)
    if placement_type != "path_following" and "fixed_rotation_deg" in raw:
        output["fixed_rotation_deg"] = raw["fixed_rotation_deg"]
    return output


def _path_placement(
    raw: dict[str, Any],
    *,
    tile_mm: float,
    stripe_layers: list[dict[str, Any]],
) -> dict[str, Any]:
    if raw.get("host_layer"):
        stripe_ids = [layer["id"] for layer in stripe_layers]
        host_index = stripe_ids.index(raw["host_layer"])
        direction = _direction(stripe_layers[host_index]["params"]["angle"])
        output: dict[str, Any] = {
            "type": "path",
            "kind": "straight",
            "direction": direction,
            "spacing_ratio": _ratio(float(raw["spacing_mm"]) / _path_length(tile_mm, direction)),
            "phase_ratio": _ratio(float(raw.get("phase_mm", 0)) / _path_length(tile_mm, direction)),
            "host_stripe_index": host_index,
        }
        lane = raw.get("lane", "center")
        if lane.startswith("b"):
            output["host_band_index"] = int(lane.split(".")[0][1:])
    else:
        path = raw["path"]
        direction = _direction(path.get("angle", 0))
        output = {
            "type": "path",
            "kind": path.get("kind", "straight"),
            "direction": direction,
            "spacing_ratio": _ratio(float(raw["spacing_mm"]) / _path_length(tile_mm, direction)),
            "phase_ratio": _ratio(float(raw.get("phase_mm", 0)) / _path_length(tile_mm, direction)),
        }
        if output["kind"] == "wave":
            output.update(
                wavelength_ratio=_ratio(float(path["wavelength"]) / tile_mm),
                amplitude_ratio=_ratio(float(path["amplitude"]) / tile_mm),
            )
    if raw.get("rotation"):
        output["rotation"] = raw["rotation"]
    if "fixed_rotation_deg" in raw:
        output["fixed_rotation_deg"] = raw["fixed_rotation_deg"]
    return output


def _manifest(path: Path) -> dict[str, Any]:
    intent = json.loads(path.read_text(encoding="utf-8"))
    tile_mm = float(intent["canvas"]["tile_mm"])
    palette_slots = intent["palette"]["slots"]
    slot_ids = [slot["id"] for slot in palette_slots]
    color_index = {slot_id: index for index, slot_id in enumerate(slot_ids)}
    colors = [slot["hex"].upper() for slot in palette_slots]
    background = next(layer for layer in intent["layers"] if layer["type"] == "background")
    stripe_layers = [layer for layer in intent["layers"] if layer["type"] == "stripe"]
    motif_ids: list[str] = []
    for layer in intent["layers"]:
        if layer["type"] != "motif":
            continue
        motif_id = layer["params"]["motif_id"]
        if motif_id not in motif_ids:
            motif_ids.append(motif_id)

    layers: list[dict[str, Any]] = []
    for layer in intent["layers"]:
        if layer["type"] == "background":
            continue
        if layer["type"] == "stripe":
            params = layer["params"]
            period_mm = float(params["period_mm"])
            layers.append(
                {
                    "type": "stripe",
                    "direction": _direction(params["angle"]),
                    "period_ratio": _ratio(period_mm / tile_mm),
                    "bands": [
                        {
                            "offset_ratio": _ratio(
                                (float(band["offset_mm"]) % period_mm) / period_mm
                            ),
                            "width_ratio": _ratio(float(band["width_mm"]) / period_mm),
                            "color_index": color_index[band["color"]],
                        }
                        for band in params["bands"]
                    ],
                }
            )
            continue

        params = layer["params"]
        colors_used = list(params["colors"].values()) if params.get("colors") else [params["color"]]
        layers.append(
            {
                "type": "motif",
                "motif_index": motif_ids.index(params["motif_id"]),
                "size_ratio": _ratio(float(params["size_mm"]) / tile_mm),
                "color_indices": [color_index[value] for value in colors_used],
                "placement": _placement(
                    layer["placement"], tile_mm=tile_mm, stripe_layers=stripe_layers
                ),
            }
        )

    number = path.name[:2]
    stem = path.stem[3:]
    return {
        "example_id": f"gallery_{number}_{stem}",
        "family": _family(number),
        "retrieval_text": _DESCRIPTIONS[number],
        "tags": [token for token in stem.split("_") if token != "motif"][:12],
        "golden_file": path.name,
        "golden_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "plan": {
            "colors": colors,
            "ground_color_index": color_index[background["params"]["color"]],
            "motifs": [
                {"source": "input", "input_index": index + 1} for index in range(len(motif_ids))
            ],
            "layers": layers,
        },
    }


def build() -> str:
    manifests = [_manifest(path) for path in sorted(GOLDEN_DIR.glob("*.json"))]
    return json.dumps(manifests, ensure_ascii=False, indent=2) + "\n"


def _arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    return parser.parse_args()


if __name__ == "__main__":
    args = _arguments()
    generated = build()
    if args.check:
        if not MANIFEST.exists() or json.loads(MANIFEST.read_text(encoding="utf-8")) != json.loads(
            generated
        ):
            raise SystemExit("authoring example manifest is out of date")
        print("authoring example manifest is current")
    else:
        print(generated, end="")
