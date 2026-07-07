"""Recraft 모티프 어댑터 (worker-motifs.md §3): prompt → 정규화 모티프.

복잡한 모티프(페이즐리·플로럴…)는 손코딩 라이브러리 대신 외부 API(Recraft)로 생성한다.
authoring-time 단계 — 런타임 generate가 아니다. 한 번 생성·게이트·정규화해 content-hash
motif_id로 저장하면 이후 런타임은 id만 참조하므로 같은 intent+seed는 늘 같은 SVG.

재구현 결정(원본과 다름): gradient는 첫 stop 색으로 평탄화하지 않고 **오류**로 처리해
재프롬프트를 유발한다(gradient 미사용 방침). 프롬프트도 "Do NOT use ..." 금지형.
"""

from __future__ import annotations

import base64
import re
import xml.etree.ElementTree as ET

import httpx

from worker.adapters import AdapterClientError, AdapterNotConfigured
from worker.motifs import geometry as geom
from worker.motifs.normalize import NormalizedMotif, normalize_motif_svg
from worker.render import sanitize

_GRADIENT_TAGS = {"lineargradient", "radialgradient"}
_DROP_TAGS = {"filter", "clippath", "mask", "title", "desc", "metadata", "style", "text", "tspan"}
_RGB_RE = re.compile(r"rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)", re.IGNORECASE)
_PAINT_ATTRS = ("fill", "stroke", "color")
# 선두 filled 도형의 bbox가 viewBox의 이 비율 이상이면 전면 배경 — 제거(최소 1 drawable 유지).
_BG_AREA_RATIO = 0.9

DEFAULT_VECTOR_MODEL = "recraftv4_1_vector"
DEFAULT_SIZE = "1024x1024"
DEFAULT_BASE_URL = "https://external.api.recraft.ai/v1"
_API_PATH = "/images/generations"


class RecraftError(AdapterClientError):
    """Recraft 생성기가 실패(502급)."""


# ---- 적합성 게이트 (순수 함수) ----


def _local(el: ET.Element) -> str:
    return el.tag.rsplit("}", 1)[-1].lower() if isinstance(el.tag, str) else ""


def _is_clean_paint(value: str) -> bool:
    low = value.strip().lower()
    return low in ("none", "currentcolor") or low.startswith("#")


def _color_to_hex(value: str) -> str:
    """rgb()/rgba() → #rrggbb; hex/none/currentColor/url()은 그대로. 그 외는 원문(정규화가 거부)."""
    low = value.strip().lower()
    if low in ("none", "currentcolor") or low.startswith(("#", "url(")):
        return value
    match = _RGB_RE.match(low)
    if not match:
        return value
    r, g, b = (max(0, min(255, round(float(c)))) for c in match.groups())
    return f"#{r:02x}{g:02x}{b:02x}"


def _hoist_style_paint(el: ET.Element, style: str) -> None:
    """style 속성의 fill/stroke/color 선언을 실제 속성으로 끌어올린다(이미 있으면 유지)."""
    for prop in _PAINT_ATTRS:
        if el.get(prop) is not None:
            continue
        match = re.search(rf"(?:^|;)\s*{prop}\s*:\s*([^;]+)", style, re.IGNORECASE)
        if match:
            el.set(prop, match.group(1).strip())


def _strip_and_recolor(el: ET.Element) -> None:
    style = el.get("style")
    if style:
        _hoist_style_paint(el, style)
    for attr in [a for a in el.attrib if a.rsplit("}", 1)[-1] not in sanitize.ALLOWED_ATTRS]:
        del el.attrib[attr]
    for attr in _PAINT_ATTRS:
        value = el.get(attr)
        if value is not None:
            el.set(attr, _color_to_hex(value))
    for child in list(el):
        if _local(child) in _DROP_TAGS:
            el.remove(child)
            continue
        _strip_and_recolor(child)


def _is_filled(el: ET.Element) -> bool:
    fill = el.get("fill")
    return not (fill is not None and fill.strip().lower() == "none")


def _find_backgrounds(root: ET.Element) -> list[tuple[ET.Element, ET.Element]]:
    """제거 대상 선두 전면 도형 (parent, element) 쌍 — 최소 1 drawable은 항상 남긴다."""
    parts = (root.get("viewBox") or "").replace(",", " ").split()
    if len(parts) < 4:
        return []
    try:
        vb_w, vb_h = float(parts[2]), float(parts[3])
    except ValueError:
        return []
    if vb_w <= 0 or vb_h <= 0:
        return []
    vb_area = vb_w * vb_h

    container = root
    kids = [c for c in container if _local(c) in geom.DRAWABLE_TAGS]
    if len(kids) == 1 and _local(kids[0]) == "g":  # 전체를 하나의 <g>로 감싼 출력
        container = kids[0]
        kids = [c for c in container if _local(c) in geom.DRAWABLE_TAGS]

    backgrounds: list[tuple[ET.Element, ET.Element]] = []
    for el in kids:
        if len(kids) - len(backgrounds) <= 1:
            break  # 최소 1 drawable 유지
        if not _is_filled(el):
            break  # 선두만 — 첫 비배경 drawable에서 중단
        box = geom.element_bbox(el)
        if box is None:
            break
        if (box[2] - box[0]) * (box[3] - box[1]) >= _BG_AREA_RATIO * vb_area:
            backgrounds.append((container, el))
        else:
            break
    return backgrounds


def gate_recraft_svg(raw_svg: str) -> str:
    """Recraft SVG 적합성 게이트(순수) — 깨끗하면 무변경, 아니면 정리본 반환.

    gradient·raster image는 오류(재프롬프트 트리거). 그 외: rgb()→hex, style paint hoist,
    비허용 속성/비벡터 태그 drop, 전면 배경 제거. normalize_motif_svg가 소비하기 전 단계.
    """
    root = sanitize.parse_svg_tree(raw_svg)

    needs_clean = False
    for el in root.iter():
        tag = _local(el)
        if tag == "image":
            raise ValueError("raster <image> in motif SVG is not allowed")
        if tag in _GRADIENT_TAGS:
            raise ValueError("gradient in motif SVG is not allowed (use flat solid fills)")
        if tag in _DROP_TAGS:
            needs_clean = True
        if any(a.rsplit("}", 1)[-1] not in sanitize.ALLOWED_ATTRS for a in el.attrib):
            needs_clean = True
        for attr in _PAINT_ATTRS:
            value = el.get(attr)
            if value is None:
                continue
            low = value.strip().lower()
            if not _is_clean_paint(value) and not low.startswith("url("):
                needs_clean = True

    backgrounds = _find_backgrounds(root)
    if backgrounds:
        needs_clean = True
    if not needs_clean:
        return raw_svg

    _strip_and_recolor(root)
    for parent, el in backgrounds:
        parent.remove(el)
    root.set("xmlns", "http://www.w3.org/2000/svg")
    return ET.tostring(root, encoding="unicode")


def _build_recraft_prompt(spec: dict, *, errors: list[str] | None = None) -> str:
    lines = [
        "Draw ONE single, isolated object as one inline SVG. Output ONLY the SVG markup — "
        "no markdown, no prose, no <?xml?> prolog.",
        "CRITICAL: exactly ONE centered subject that FILLS the frame. It must NOT be a "
        "pattern, NOT repeated, NOT scattered or tiled, NOT a scene, collage or grid.",
        "NO background: do not draw any background rectangle, border or backdrop — the "
        "object sits on a transparent canvas.",
        "The root <svg> MUST have a viewBox. Multiple solid colors are allowed; use flat "
        "vector <path>/<g> shapes with solid fills. Do NOT use raster <image>, <text>, "
        "gradients or filters.",
        f"subject: {spec.get('subject')}",
        f"scope: {spec.get('scope')}",
    ]
    for key in ("view", "expression", "style", "description"):
        if spec.get(key):
            lines.append(f"{key}: {spec.get(key)}")
    if errors:
        lines += ["", "Your previous SVG was rejected. Fix exactly these:"]
        lines += [f"- {e}" for e in errors]
    return "\n".join(lines)


# ---- HTTP 클라이언트 (async) ----


class RecraftHTTPClient:
    """실제 Recraft 벡터 API 호출 — generate, 120s, HTTP 재시도 없음.

    vectorize(이미지→SVG) 경로는 이미지 입력 파이프라인과 함께 5단계에서 재도입한다.
    """

    def __init__(
        self,
        api_key: str,
        *,
        model: str = DEFAULT_VECTOR_MODEL,
        style: str = "",
        size: str = DEFAULT_SIZE,
        response_format: str = "url",
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 120.0,
    ) -> None:
        if not api_key:
            raise RecraftError("RecraftHTTPClient requires a non-empty api_key")
        self._api_key = api_key
        self._model = model
        self._style = style
        self._size = size
        self._response_format = response_format
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._client: httpx.AsyncClient | None = None

    def _http(self) -> httpx.AsyncClient:
        """지연 생성 공유 커넥션 풀 — 요청마다 열지 않는다, aclose가 닫는다."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self._timeout)
        return self._client

    async def _post_for_svg(self, path: str, *, extract, label: str, **request_kwargs) -> str:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        client = self._http()
        try:
            resp = await client.post(f"{self._base_url}{path}", headers=headers, **request_kwargs)
            resp.raise_for_status()
            svg = await extract(client, resp.json())
        except httpx.HTTPStatusError as exc:
            raise RecraftError(
                f"Recraft {label} HTTP {exc.response.status_code}: {exc.response.text[:500]}"
            ) from exc
        except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError) as exc:
            raise RecraftError(f"Recraft {label} request failed: {exc}") from exc
        if not svg or "<svg" not in svg.lower():
            raise RecraftError(f"Recraft {label} returned a non-SVG payload")
        return svg

    async def generate(self, prompt: str) -> str:
        payload: dict = {
            "prompt": prompt,
            "model": self._model,
            "response_format": self._response_format,
            "n": 1,
        }
        if self._style:
            payload["style"] = self._style
        if self._size:
            payload["size"] = self._size

        async def _extract(client: httpx.AsyncClient, data: dict) -> str:
            item = data["data"][0]
            if self._response_format == "b64_json":
                return base64.b64decode(item["b64_json"]).decode("utf-8")
            file_resp = await client.get(item["url"])
            file_resp.raise_for_status()
            return file_resp.text

        return await self._post_for_svg(_API_PATH, json=payload, extract=_extract, label="API")

    async def aclose(self) -> None:
        if self._client is not None and not self._client.is_closed:
            await self._client.aclose()


def build_recraft_client(settings) -> RecraftHTTPClient | None:
    api_key = getattr(settings, "recraft_api_key", "")
    if not api_key:
        return None
    return RecraftHTTPClient(
        api_key,
        model=getattr(settings, "recraft_model", None) or DEFAULT_VECTOR_MODEL,
        style=getattr(settings, "recraft_style", "") or "",
        size=getattr(settings, "recraft_size", None) or DEFAULT_SIZE,
        response_format=getattr(settings, "recraft_response_format", None) or "url",
        base_url=getattr(settings, "recraft_base_url", None) or DEFAULT_BASE_URL,
    )


async def generate_motif(spec: dict, *, client, settings) -> NormalizedMotif:
    """miss spec에 대해 Recraft로 모티프 생성 → 정규화 모티프 반환(등록은 호출자/store 소관).

    게이트 순수 함수 + 정규화를 매 시도 실행. 게이트/정규화 실패 시 1회 재프롬프트, 2회 실패
    또는 클라이언트 미구성이면 RecraftError/AdapterNotConfigured.
    """
    if client is None:
        raise AdapterNotConfigured("no Recraft client configured (set recraft_api_key)")

    errors: list[str] | None = None
    for _ in range(2):  # 최초 시도 + 게이트 재생성 1회
        try:
            raw = await client.generate(_build_recraft_prompt(spec, errors=errors))
        except RecraftError:
            raise
        except Exception as exc:  # 생성기 실패는 업스트림(502급)
            raise RecraftError(f"Recraft generation failed: {exc}") from exc
        try:
            flat = gate_recraft_svg(raw)
            return normalize_motif_svg(
                flat,
                max_color_slots=settings.recraft_max_color_slots,
                max_aspect_ratio=settings.motif_max_aspect_ratio,
                edge_seam_tol=settings.motif_edge_seam_tol,
                render_check=settings.motif_render_check,
            )
        except (sanitize.SanitizeError, ValueError) as exc:
            errors = [str(exc)]
            continue
    raise RecraftError(f"Recraft motif failed the suitability/sanitize gate after retry: {errors}")
