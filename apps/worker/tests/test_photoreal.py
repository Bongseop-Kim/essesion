"""photoreal 캡슐 단위 계약 — DB 불필요(컨테이너 미기동).

결정론 구간(참고 렌더·프롬프트·에셋)만 검증한다. AI 출력 품질은 실호출
캘리브레이션의 몫(finalize-ai-fabric.md 검증 절).
"""

import io

from PIL import Image
from worker.render import photoreal
from worker.render.weave import available_weaves


def test_weave_prompts_cover_every_asset():
    # 3곳 결속(KNOWN_WEAVES=에셋 stem=프롬프트 매핑) — api 쪽은 test_design.py가 핀,
    # 여기서는 에셋↔프롬프트를 핀. 피커 옵션을 늘리면 셋 다 함께 갱신해야 한다.
    assert set(photoreal.WEAVE_PROMPTS) == set(available_weaves())


def test_base_photo_and_mask_share_dimensions():
    base = Image.open(io.BytesIO(photoreal.base_photo_bytes()))
    mask = Image.open(io.BytesIO(photoreal.base_mask_bytes()))
    # OpenAI edits 계약: 마스크는 첫 이미지와 동일 크기 + 알파 채널 필수.
    assert base.size == mask.size == (1024, 1536)
    assert mask.mode == "RGBA"

    # 알파=0(투명) = 편집 영역(넥타이). 사진의 1/4~1/2를 덮어야 정상 — 극단값은
    # 마스크 재생성 사고(전부 불투명/전부 투명)를 뜻한다.
    alpha = mask.getchannel("A")
    transparent = alpha.histogram()[0]
    ratio = transparent / (mask.size[0] * mask.size[1])
    assert 0.25 < ratio < 0.5


def test_tie_mockup_is_deterministic_and_square():
    tile = Image.new("RGB", (96, 96), (30, 60, 120))
    first = photoreal.tie_mockup_png(tile, tile_mm=48.0)
    second = photoreal.tie_mockup_png(tile, tile_mm=48.0)
    assert first == second  # 참고 렌더는 결정론 — 같은 입력은 같은 바이트

    image = Image.open(io.BytesIO(first))
    assert image.size == (1024, 1024)


def test_weave_reference_is_square_and_small():
    ref = Image.open(io.BytesIO(photoreal.weave_reference_png("twill-45")))
    assert ref.size == (512, 512)


def test_build_prompts_bind_method_and_weave():
    tie_prompt, fabric_prompt = photoreal.build_prompts(method="yarn_dyed", weave="herringbone")
    for prompt in (tie_prompt, fabric_prompt):
        assert "herringbone" in prompt
        assert "yarn-dyed" in prompt
    # 넥타이 프롬프트만 마스크·사진 유지 지시를 갖는다.
    assert "masked necktie" in tie_prompt
    assert "macro photograph" in fabric_prompt


def test_tie_mockup_paints_panel_once_on_the_blade():
    tile = Image.new("RGB", (96, 96), (30, 60, 120))
    # 블레이드 프레임 아래쪽 절반(어깨선 위 400 ~ 끝)을 빨갛게 — 블레이드 아래에만 보여야 한다.
    panel = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -4600 1000 6200">'
        '<rect x="0" y="600" width="1000" height="1000" fill="#ff0000"/></svg>'
    )
    plain = Image.open(io.BytesIO(photoreal.tie_mockup_png(tile, tile_mm=48.0)))
    image = Image.open(io.BytesIO(photoreal.tie_mockup_png(tile, tile_mm=48.0, panel_svg=panel)))
    assert image.tobytes() != plain.tobytes()
    red = [
        y
        for y in range(0, 1024, 4)
        if (pixel := image.getpixel((512, y)))[0] > 120 and pixel[2] < 90  # type: ignore[index]
    ]
    # 빨강은 넥타이 아래쪽(끝 근처)에만 — 매듭·윗부분에는 없다.
    assert red and min(red) > 700
