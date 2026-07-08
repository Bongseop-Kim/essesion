"""SVG geometry bbox 파서 경계 테스트 — 원본 tests/test_geometry.py 이식.

normalize의 tight-bbox 프레이밍과 Recraft 게이트의 전면 배경 감지가 이 파서에 의존한다.
Bezier/arc 경계는 안전한 과대평가(제어점/반지름 박스)다.
"""

import xml.etree.ElementTree as ET

import pytest
from worker.motifs import geometry as geom


def _el(markup: str) -> ET.Element:
    return ET.fromstring(markup)


def test_rect_bbox():
    assert geom.element_bbox(_el('<rect x="10" y="20" width="30" height="40"/>')) == (
        10.0,
        20.0,
        40.0,
        60.0,
    )


def test_circle_bbox():
    assert geom.element_bbox(_el('<circle cx="50" cy="50" r="10"/>')) == (40.0, 40.0, 60.0, 60.0)


def test_ellipse_bbox():
    assert geom.element_bbox(_el('<ellipse cx="50" cy="30" rx="20" ry="10"/>')) == (
        30.0,
        20.0,
        70.0,
        40.0,
    )


def test_line_bbox():
    assert geom.element_bbox(_el('<line x1="5" y1="9" x2="15" y2="3"/>')) == (5.0, 3.0, 15.0, 9.0)


def test_polygon_bbox():
    assert geom.element_bbox(_el('<polygon points="0,0 10,0 10,10 0,10"/>')) == (
        0.0,
        0.0,
        10.0,
        10.0,
    )


def test_path_abs_h_v_commands():
    assert geom.element_bbox(_el('<path d="M2 2 H10 V10 H2 Z"/>')) == (2.0, 2.0, 10.0, 10.0)


def test_path_relative_commands():
    assert geom.element_bbox(_el('<path d="m5 5 l10 0 l0 10 z"/>')) == (5.0, 5.0, 15.0, 15.0)


def test_path_cubic_uses_control_points_overestimate():
    assert geom.element_bbox(_el('<path d="M0 0 C0 10 10 10 10 0"/>')) == (0.0, 0.0, 10.0, 10.0)


def test_path_smooth_cubic_includes_reflected_control_point():
    box = geom.element_bbox(_el('<path d="M10 0 C20 0 20 20 10 20 S10 40 10 40"/>'))
    assert box == (0.0, 0.0, 20.0, 40.0)


def test_path_smooth_quadratic_includes_reflected_control_point():
    box = geom.element_bbox(_el('<path d="M10 0 Q20 20 10 20 T10 40"/>'))
    assert box == (0.0, 0.0, 20.0, 40.0)


def test_rotated_large_arc_bbox_uses_arc_extrema():
    box = geom.element_bbox(_el('<path d="M0 0 A100 1 45 1 1 10 0"/>'))
    assert box is not None
    assert box[1] < -40.0 or box[3] > 40.0


def test_nested_group_translate_applies():
    box = geom.element_bbox(
        _el('<g transform="translate(100,0)"><rect x="0" y="0" width="10" height="10"/></g>')
    )
    assert box == (100.0, 0.0, 110.0, 10.0)


def test_nested_group_scale_applies():
    box = geom.element_bbox(
        _el('<g transform="scale(2)"><rect x="0" y="0" width="10" height="10"/></g>')
    )
    assert box == (0.0, 0.0, 20.0, 20.0)


def test_compound_transform_translate_then_scale():
    box = geom.element_bbox(
        _el('<g transform="translate(5,5) scale(2)"><rect x="0" y="0" width="10" height="10"/></g>')
    )
    assert box == (5.0, 5.0, 25.0, 25.0)


def test_matrix_transform():
    m = geom.parse_transform("matrix(2 0 0 3 1 1)")
    assert geom._apply(m, 10.0, 10.0) == pytest.approx((21.0, 31.0))


def test_bbox_of_multiple_siblings():
    a = _el('<rect x="0" y="0" width="10" height="10"/>')
    b = _el('<rect x="20" y="20" width="10" height="10"/>')
    assert geom.bbox_of([a, b]) == (0.0, 0.0, 30.0, 30.0)


def test_empty_group_is_none():
    assert geom.element_bbox(_el("<g></g>")) is None
    assert geom.bbox_of([_el("<defs></defs>")]) is None


def test_defs_and_symbol_children_do_not_contribute_bbox():
    box = geom.element_bbox(
        _el(
            '<svg><defs><rect x="1000" y="1000" width="50" height="50"/></defs>'
            '<symbol><rect x="500" y="500" width="50" height="50"/></symbol>'
            '<rect x="0" y="0" width="10" height="10"/></svg>'
        )
    )
    assert box == (0.0, 0.0, 10.0, 10.0)
