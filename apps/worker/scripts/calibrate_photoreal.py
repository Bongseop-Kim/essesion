"""AI 실사화 캘리브레이션 — 골든 intent × weave 실호출 후 육안 평가용 이미지 저장.

finalize-ai-fabric.md 검증 절의 도구다. 유료 호출(gpt-image 편집 2회 × 조합 수)이므로
`--confirm-live` 없이는 실행되지 않는다. `OPENAI_API_KEY` 필요.

성공 기준(육안): (a) 팔레트 색 유지 (b) 모티프 형태 유지 (c) weave가 두 이미지에서
구분됨 (d) 베이스 사진의 셔츠·매듭·조명 유지 + 마스크 경계 자연 (e) 절차 렌더 대비 우위.

실행: uv run python apps/worker/scripts/calibrate_photoreal.py --confirm-live
      [--out /tmp/photoreal-calibration] [--weaves twill-45,herringbone,jacquard]
결과: {out}/{intent}_{weave}_{tie|fabric|tile|reference}.png — 나란히 놓고 판단한다.
"""

import argparse
import asyncio
import json
import pathlib
import sys

GOLDEN = pathlib.Path(__file__).parent.parent / "tests" / "golden" / "json"
# 소량·다양성 위주 — 배경/스트라이프/모티프가 섞이도록 고른 골든 3종.
DEFAULT_INTENTS = [
    "01_background_solid.json",
    "03_stripe_diagonal_uneven_bands.json",
    "06_motif_lattice_block.json",
]
DEFAULT_WEAVES = ["twill-45", "herringbone", "jacquard"]


def _golden_catalog():
    """골든 intent가 참조하는 픽스처 모티프 — 테스트와 같은 정의를 카탈로그로."""
    from worker.motifs.registry import MotifDef

    specs = json.loads((GOLDEN.parent / "motifs.json").read_text())
    return {
        motif_id: MotifDef(
            id=motif_id,
            symbol=spec["symbol"],
            bbox_mm=tuple(spec["bbox_mm"]),
            anchor=tuple(spec["anchor"]),
        )
        for motif_id, spec in specs.items()
    }


async def _run(out_dir: pathlib.Path, weaves: list[str]) -> int:
    from worker.adapters.gpt_image import build_gpt_image_client
    from worker.config import get_settings
    from worker.render.photoreal import prepare_photoreal_inputs, render_photoreal

    settings = get_settings()
    catalog = _golden_catalog()
    client = build_gpt_image_client(settings)
    if client is None:
        print("OPENAI_API_KEY가 설정되지 않았습니다 — 캘리브레이션은 실호출입니다.")
        return 1

    out_dir.mkdir(parents=True, exist_ok=True)
    failures = 0
    try:
        for intent_file in DEFAULT_INTENTS:
            intent = json.loads((GOLDEN / intent_file).read_text())
            stem = intent_file.removesuffix(".json")
            for weave in weaves:
                method = "yarn_dyed" if weave not in ("twill-0", "twill-45") else "print"
                params = {"intent": intent, "production_method": method, "weave": weave}
                label = f"{stem}_{weave}"
                try:
                    inputs = prepare_photoreal_inputs(params, settings, catalog)
                    tie_png, fabric_png = await render_photoreal(
                        inputs, client, quality=settings.finalize_image_quality
                    )
                except Exception as exc:  # 캘리브레이션은 전 조합 관찰이 목적 — 계속 진행
                    failures += 1
                    print(f"[FAIL] {label}: {exc}")
                    continue
                (out_dir / f"{label}_tie.png").write_bytes(tie_png)
                (out_dir / f"{label}_fabric.png").write_bytes(fabric_png)
                (out_dir / f"{label}_tile.png").write_bytes(inputs.tile_png)
                (out_dir / f"{label}_reference.png").write_bytes(inputs.tie_reference_png)
                print(f"[OK]   {label}")
    finally:
        await client.aclose()
    print(f"\n저장 위치: {out_dir}  (실패 {failures}건)")
    return 1 if failures else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--confirm-live", action="store_true", help="유료 실호출 동의")
    parser.add_argument("--out", default="/tmp/photoreal-calibration")
    parser.add_argument("--weaves", default=",".join(DEFAULT_WEAVES))
    args = parser.parse_args()
    if not args.confirm_live:
        print("유료 호출입니다 — --confirm-live 를 붙여 실행하세요.")
        return 1
    weaves = [w.strip() for w in args.weaves.split(",") if w.strip()]
    return asyncio.run(_run(pathlib.Path(args.out), weaves))


if __name__ == "__main__":
    sys.exit(main())
