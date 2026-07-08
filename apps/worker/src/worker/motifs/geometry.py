"""결정론적 tight bbox 측정 (worker-motifs.md §1).

용도: (a) normalize에서 실제 도형(작성자 viewBox 여백이 아니라)을 단위 박스에 꽉 채우기,
(b) Recraft 게이트에서 전면 배경 도형 탐지. 좌표만의 순수 함수 — 시간·난수·딕셔너리
순서에 의존하지 않으므로 결정론 계약을 지킨다.

베지어·아크 경계는 제어점/반지름 박스로 잡는다. 이는 결정론적 **과대추정**(참 경계보다
작아지지 않음)이라 프레임이 살짝 헐거워질 뿐 도형이 잘리는 일은 없다.
"""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET

# 아핀 변환 (a, b, c, d, e, f): x' = a*x + c*y + e, y' = b*x + d*y + f (SVG 규약).
Matrix = tuple[float, float, float, float, float, float]
Box = tuple[float, float, float, float]  # (min_x, min_y, max_x, max_y)
IDENTITY: Matrix = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)

SHAPE_TAGS = frozenset({"path", "rect", "circle", "ellipse", "line", "polygon", "polyline"})
DRAWABLE_TAGS = SHAPE_TAGS | {"g"}
# defs/symbol 내부 좌표는 렌더에 기여하지 않는다(use 참조 시점에 재배치).
NON_RENDERING_CONTAINER_TAGS = frozenset({"defs", "symbol"})

_NUM = re.compile(r"[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?")
_PATH_TOKEN = re.compile(r"([MmLlHhVvCcSsQqTtAaZz])|([-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?)")
_TRANSFORM = re.compile(r"(\w+)\s*\(([^)]*)\)")


def _floats(text: str) -> list[float]:
    return [float(m.group(0)) for m in _NUM.finditer(text or "")]


def _compose(outer: Matrix, inner: Matrix) -> Matrix:
    """apply(_compose(a, b), p) == apply(a, apply(b, p)) 가 되도록 합성."""
    a1, b1, c1, d1, e1, f1 = outer
    a2, b2, c2, d2, e2, f2 = inner
    return (
        a1 * a2 + c1 * b2,
        b1 * a2 + d1 * b2,
        a1 * c2 + c1 * d2,
        b1 * c2 + d1 * d2,
        a1 * e2 + c1 * f2 + e1,
        b1 * e2 + d1 * f2 + f1,
    )


def _apply(m: Matrix, x: float, y: float) -> tuple[float, float]:
    a, b, c, d, e, f = m
    return a * x + c * y + e, b * x + d * y + f


def _transform_matrix(name: str, v: list[float]) -> Matrix | None:
    if name == "translate":
        return (1.0, 0.0, 0.0, 1.0, v[0] if v else 0.0, v[1] if len(v) > 1 else 0.0)
    if name == "scale":
        sx = v[0] if v else 1.0
        return (sx, 0.0, 0.0, v[1] if len(v) > 1 else sx, 0.0, 0.0)
    if name == "rotate" and v:
        rad = math.radians(v[0])
        cos, sin = math.cos(rad), math.sin(rad)
        rot: Matrix = (cos, sin, -sin, cos, 0.0, 0.0)
        if len(v) >= 3:  # (cx, cy) 중심 회전
            cx, cy = v[1], v[2]
            return _compose(
                (1.0, 0.0, 0.0, 1.0, cx, cy), _compose(rot, (1.0, 0.0, 0.0, 1.0, -cx, -cy))
            )
        return rot
    if name == "matrix" and len(v) >= 6:
        return (v[0], v[1], v[2], v[3], v[4], v[5])
    if name == "skewX" and v:
        return (1.0, 0.0, math.tan(math.radians(v[0])), 1.0, 0.0, 0.0)
    if name == "skewY" and v:
        return (1.0, math.tan(math.radians(v[0])), 0.0, 1.0, 0.0, 0.0)
    return None


def parse_transform(value: str | None) -> Matrix:
    if not value:
        return IDENTITY
    m = IDENTITY
    for name, args in _TRANSFORM.findall(value):
        tm = _transform_matrix(name, _floats(args))
        if tm is not None:
            m = _compose(m, tm)
    return m


def _vector_angle(u: tuple[float, float], v: tuple[float, float]) -> float:
    ux, uy = u
    vx, vy = v
    return math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)


def _theta_in_sweep(theta: float, start: float, delta: float) -> bool:
    eps = 1e-12
    if delta >= 0:
        return (theta - start) % math.tau <= delta + eps
    return (start - theta) % math.tau <= -delta + eps


def _arc_points(
    x0: float,
    y0: float,
    rx: float,
    ry: float,
    rotation: float,
    large_arc: float,
    sweep: float,
    x1: float,
    y1: float,
) -> list[tuple[float, float]]:
    """아크 끝점 + 축 극점(sweep 안에 드는 것)들 — 실제 경계를 덮는 결정론적 점 집합."""
    rx, ry = abs(rx), abs(ry)
    if rx == 0.0 or ry == 0.0 or (x0 == x1 and y0 == y1):
        return [(x1, y1)]

    phi = math.radians(rotation % 360.0)
    cos_phi, sin_phi = math.cos(phi), math.sin(phi)
    dx2, dy2 = (x0 - x1) / 2.0, (y0 - y1) / 2.0
    x1p = cos_phi * dx2 + sin_phi * dy2
    y1p = -sin_phi * dx2 + cos_phi * dy2

    over = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry)
    if over > 1.0:
        s = math.sqrt(over)
        rx *= s
        ry *= s

    rx2, ry2, x1p2, y1p2 = rx * rx, ry * ry, x1p * x1p, y1p * y1p
    denom = rx2 * y1p2 + ry2 * x1p2
    coef = 0.0
    if denom:
        sign = -1.0 if bool(large_arc) == bool(sweep) else 1.0
        coef = sign * math.sqrt(max(0.0, (rx2 * ry2 - denom) / denom))
    cxp = coef * (rx * y1p / ry)
    cyp = coef * (-ry * x1p / rx)
    cx = cos_phi * cxp - sin_phi * cyp + (x0 + x1) / 2.0
    cy = sin_phi * cxp + cos_phi * cyp + (y0 + y1) / 2.0

    start = _vector_angle((1.0, 0.0), ((x1p - cxp) / rx, (y1p - cyp) / ry))
    delta = _vector_angle(
        ((x1p - cxp) / rx, (y1p - cyp) / ry), ((-x1p - cxp) / rx, (-y1p - cyp) / ry)
    )
    if not sweep and delta > 0:
        delta -= math.tau
    elif sweep and delta < 0:
        delta += math.tau

    def point(theta: float) -> tuple[float, float]:
        return (
            cx + rx * math.cos(theta) * cos_phi - ry * math.sin(theta) * sin_phi,
            cy + rx * math.cos(theta) * sin_phi + ry * math.sin(theta) * cos_phi,
        )

    candidates = [start, start + delta]
    x_extreme = math.atan2(-ry * sin_phi, rx * cos_phi)
    y_extreme = math.atan2(ry * cos_phi, rx * sin_phi)
    for theta in (x_extreme, x_extreme + math.pi, y_extreme, y_extreme + math.pi):
        if _theta_in_sweep(theta, start, delta):
            candidates.append(theta)
    return [point(t) for t in candidates]


def _path_points(d: str) -> list[tuple[float, float]]:
    """path의 on-curve + 제어점 전부 — 경계의 안전한 과대추정."""
    toks = [
        ("cmd", mt.group(1)) if mt.group(1) else ("num", float(mt.group(2)))
        for mt in _PATH_TOKEN.finditer(d or "")
    ]
    pts: list[tuple[float, float]] = []
    i, n = 0, len(toks)
    cx = cy = sx = sy = 0.0
    prev_cubic: tuple[float, float] | None = None
    prev_quad: tuple[float, float] | None = None
    cmd: str | None = None
    try:
        while i < n:
            if toks[i][0] == "cmd":
                cmd = str(toks[i][1])
                i += 1
                if cmd in ("Z", "z"):
                    cx, cy = sx, sy
                    prev_cubic = prev_quad = None
                    continue
            if cmd is None:
                break
            cl, rel = cmd.lower(), cmd.islower()

            def nxt() -> float:
                nonlocal i
                tok = toks[i]
                i += 1
                return tok[1] if isinstance(tok[1], float) else 0.0

            if cl == "m":
                x, y = nxt(), nxt()
                if rel:
                    x, y = x + cx, y + cy
                cx, cy = sx, sy = x, y
                pts.append((cx, cy))
                cmd = "l" if rel else "L"  # 이후 암묵 좌표쌍은 lineto
                prev_cubic = prev_quad = None
            elif cl == "l":
                x, y = nxt(), nxt()
                if rel:
                    x, y = x + cx, y + cy
                cx, cy = x, y
                pts.append((cx, cy))
                prev_cubic = prev_quad = None
            elif cl == "h":
                x = nxt()
                cx = cx + x if rel else x
                pts.append((cx, cy))
                prev_cubic = prev_quad = None
            elif cl == "v":
                y = nxt()
                cy = cy + y if rel else y
                pts.append((cx, cy))
                prev_cubic = prev_quad = None
            elif cl == "c":
                vals = [nxt() for _ in range(6)]
                if rel:
                    vals = [vals[k] + (cx if k % 2 == 0 else cy) for k in range(6)]
                pts += [(vals[0], vals[1]), (vals[2], vals[3]), (vals[4], vals[5])]
                prev_cubic = (vals[2], vals[3])
                prev_quad = None
                cx, cy = vals[4], vals[5]
            elif cl == "s":
                vals = [nxt() for _ in range(4)]
                if rel:
                    vals = [vals[k] + (cx if k % 2 == 0 else cy) for k in range(4)]
                reflected = (
                    (2 * cx - prev_cubic[0], 2 * cy - prev_cubic[1])
                    if prev_cubic is not None
                    else (cx, cy)
                )
                pts += [reflected, (vals[0], vals[1]), (vals[2], vals[3])]
                prev_cubic = (vals[0], vals[1])
                prev_quad = None
                cx, cy = vals[2], vals[3]
            elif cl == "q":
                vals = [nxt() for _ in range(4)]
                if rel:
                    vals = [vals[k] + (cx if k % 2 == 0 else cy) for k in range(4)]
                pts += [(vals[0], vals[1]), (vals[2], vals[3])]
                prev_cubic = None
                prev_quad = (vals[0], vals[1])
                cx, cy = vals[2], vals[3]
            elif cl == "t":
                x, y = nxt(), nxt()
                if rel:
                    x, y = x + cx, y + cy
                reflected = (
                    (2 * cx - prev_quad[0], 2 * cy - prev_quad[1])
                    if prev_quad is not None
                    else (cx, cy)
                )
                pts += [reflected, (x, y)]
                prev_cubic = None
                prev_quad = reflected
                cx, cy = x, y
            elif cl == "a":
                rx, ry, rot, laf, sf, x, y = (nxt() for _ in range(7))
                if rel:
                    x, y = x + cx, y + cy
                pts += _arc_points(cx, cy, rx, ry, rot, laf, sf, x, y)
                prev_cubic = prev_quad = None
                cx, cy = x, y
            else:
                i += 1
                prev_cubic = prev_quad = None
    except IndexError:
        pass  # 잘린/깨진 path — 파싱된 만큼만 경계에 포함
    return pts


def _shape_points(tag: str, el: ET.Element) -> list[tuple[float, float]]:
    def f(name: str, default: float = 0.0) -> float:
        try:
            return float(el.get(name, default))
        except (TypeError, ValueError):
            return default

    if tag == "rect":
        x, y, w, h = f("x"), f("y"), f("width"), f("height")
        return [(x, y), (x + w, y + h)]
    if tag == "circle":
        cx, cy, r = f("cx"), f("cy"), f("r")
        return [(cx - r, cy - r), (cx + r, cy + r)]
    if tag == "ellipse":
        cx, cy, rx, ry = f("cx"), f("cy"), f("rx"), f("ry")
        return [(cx - rx, cy - ry), (cx + rx, cy + ry)]
    if tag == "line":
        return [(f("x1"), f("y1")), (f("x2"), f("y2"))]
    if tag in ("polygon", "polyline"):
        nums = _floats(el.get("points", ""))
        return [(nums[k], nums[k + 1]) for k in range(0, len(nums) - 1, 2)]
    if tag == "path":
        return _path_points(el.get("d", ""))
    return []


def _bounds(points: list[tuple[float, float]]) -> Box | None:
    if not points:
        return None
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    return (min(xs), min(ys), max(xs), max(ys))


def _union(boxes: list[Box]) -> Box | None:
    boxes = [b for b in boxes if b is not None]
    if not boxes:
        return None
    return (
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    )


def element_bbox(el: ET.Element, matrix: Matrix = IDENTITY) -> Box | None:
    """`el`과 그 자손의 축 정렬 bbox — 자신과 모든 조상의 transform을 반영."""
    if not isinstance(el.tag, str):
        return None
    m = _compose(matrix, parse_transform(el.get("transform")))
    tag = el.tag.rsplit("}", 1)[-1].lower()
    boxes: list[Box] = []
    own = _bounds([_apply(m, x, y) for x, y in _shape_points(tag, el)])
    if own is not None:
        boxes.append(own)
    if tag in NON_RENDERING_CONTAINER_TAGS:
        return _union(boxes)
    for child in el:
        child_box = element_bbox(child, m)
        if child_box is not None:
            boxes.append(child_box)
    return _union(boxes)


def bbox_of(elements: list[ET.Element]) -> Box | None:
    """형제 요소 목록(모티프 최상위 노드들)의 합집합 bbox."""
    return _union([b for el in elements if (b := element_bbox(el)) is not None])
