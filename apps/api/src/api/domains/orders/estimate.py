"""주문 제작 예상 견적서 — 엑셀 첨부 파일과 메일 본문 (docs/api-spec/domains.md §7).

요청에서 온 options는 자유 dict다. 여기서 아는 키·값만 라벨로 바꿔 싣고 나머지는 버린다 —
우리 도메인 명의의 문서에 임의 문구가 실리지 않게 하는 장치다.
"""

import io
from datetime import date
from typing import Any

import xlsxwriter

# 표시 문구는 store와 같은 값으로 맞춘다: packages/shared/src/order-content.ts(OPTION_LABELS·
# OPTION_VALUES), apps/store/src/features/custom-order/model/options.ts(customOrderSummary).
FABRIC_LABELS = {"SILK": "실크", "POLY": "폴리"}
DESIGN_LABELS = {"YARN_DYED": "선염", "PRINTING": "날염"}
POINT_LABELS = {"EMBROIDERY": "자수", "HEAT_TRANSFER": "열전사 필름"}
SIZE_LABELS = {"ADULT": "성인용", "CHILD": "아동용"}
FINISHING_LABELS = {
    "triangle_stitch": "삼각 봉제",
    "side_stitch": "옆선 봉제",
    "bar_tack": "바텍",
    "fold7": "7폴드",
    "spoderato": "스포데라토",
    "brand_label": "브랜드 라벨",
    "care_label": "케어 라벨",
}

# 공급자 정보 — store 푸터(apps/store/src/app/layout/app-layout.tsx)와 같은 값.
SUPPLIER = [
    ("등록번호", "305-26-32033"),
    ("상호", "영선산업 (ESSE SION)"),
    ("대표", "김영선"),
    ("소재지", "대전광역시 동구 우암로246번길 9-16 (가양동)"),
    ("업태 · 종목", "도소매 · 넥타이, 스카프"),
    ("연락처", "0507-1381-7422 · help@essesion.com"),
]
ACCOUNT = "국민은행 724701-01-510832  ·  예금주 김영선(영선산업)"
ITEM_NAME = "맞춤 넥타이 제작"

# 한글 글꼴을 지정하면 그 글꼴이 없는 쪽(맥의 맑은 고딕 등)에서 명조로 떨어진다 — 라틴 산세리프를
# 지정해 두면 윈도우·맥 모두 시스템 고딕으로 이어진다.
FONT = "Arial"
INK = "#111111"
MUTED = "#6B7280"
FILL = "#EEF0F2"
COLUMN_WIDTHS = [6, 26, 14, 11, 14, 17, 15]  # No·품목·소재·수량·단가·공급가액·세액
BLANK_ROWS = 4  # 전통 양식의 여백 줄


def _label(table: dict[str, str], value: Any) -> str | None:
    return table.get(value) if isinstance(value, str) else None


def _fabric(options: dict[str, Any]) -> tuple[str, str]:
    """(소재 칸, 제작 사양의 원단 줄)."""
    if _label(POINT_LABELS, options.get("point")):
        material = spec = "정해진 원단"
    elif options.get("fabric_provided") is True:
        material, spec = "원단 제공", "원단 직접 제공"
    else:
        fabric = _label(FABRIC_LABELS, options.get("fabric_type"))
        design = _label(DESIGN_LABELS, options.get("design_type"))
        material = fabric or "-"
        spec = " · ".join(part for part in (fabric, design) if part) or "-"
    if options.get("reorder") is True:
        spec = f"재주문 · {spec}"
    return material, spec


def estimate_specs(options: dict[str, Any]) -> tuple[str, list[tuple[str, str]]]:
    """options → (소재, 제작 사양 줄). 모르는 키와 enum 밖의 값은 버린다."""
    material, fabric = _fabric(options)
    specs = [("원단", fabric)]

    point = _label(POINT_LABELS, options.get("point"))
    if point:
        specs.append(("포인트", point))

    tie = ["자동 타이" if options.get("tie_type") == "AUTO" else "수동 타이"]
    if options.get("turn_knot") is True:
        tie.append("돌려묶기")
    if options.get("dimple") is True:
        tie.append("딤플")
    specs.append(("타이", " · ".join(tie)))

    size = [_label(SIZE_LABELS, options.get("size_type"))]
    width = options.get("tie_width")
    if isinstance(width, int | float) and not isinstance(width, bool) and 0 < width < 100:
        size.append(f"{width:g}cm")
    if any(size):
        specs.append(("규격", " · ".join(part for part in size if part)))

    if options.get("interlining") == "WOOL":
        specs.append(("심지", "울"))

    finishing = [label for key, label in FINISHING_LABELS.items() if options.get(key) is True]
    if finishing:
        specs.append(("추가 옵션", " · ".join(finishing)))
    return material, specs


def split_vat(total: int) -> tuple[int, int]:
    """부가세 포함 합계 → (공급가액, 세액). 세액을 나머지로 잡아 합이 정확히 맞는다."""
    supply = round(total / 1.1)
    return supply, total - supply


def estimate_filename(issued: date) -> str:
    return f"견적서_영선산업_{issued:%Y%m%d}.xlsx"


def estimate_mail_text(*, total: int, order_url: str) -> str:
    return (
        "안녕하세요, ESSE SION(영선산업)입니다.\n"
        "요청하신 주문 제작 예상 견적서를 첨부해 드립니다.\n"
        "\n"
        f"합계 금액: {total:,}원 (부가세 포함)\n"
        "\n"
        f"주문 제작: {order_url}\n"
        "문의: help@essesion.com / 0507-1381-7422\n"
    )


def build_estimate_xlsx(
    *,
    issued: date,
    company_name: str | None,
    options: dict[str, Any],
    quantity: int,
    total: int,
) -> bytes:
    """견적서 엑셀. 금액은 수식이 아닌 값으로 넣는다 — 수식은 메일 앱 미리보기에서 0으로 보인다."""
    material, specs = estimate_specs(options)
    supply, tax = split_vat(total)
    unit = round(supply / quantity)

    buffer = io.BytesIO()
    # strings_to_formulas를 끄면 '='로 시작하는 문자열도 수식이 되지 않는다(엑셀 수식 주입 차단).
    workbook = xlsxwriter.Workbook(buffer, {"in_memory": True, "strings_to_formulas": False})
    sheet = workbook.add_worksheet("견적서")
    for column, width in enumerate(COLUMN_WIDTHS):
        sheet.set_column(column, column, width)

    def fmt(**properties: Any):
        base = {"font_name": FONT, "font_size": 11, "valign": "vcenter", "font_color": INK}
        return workbook.add_format(base | properties)

    box = {"border": 1, "border_color": INK}
    f_title = fmt(font_size=30, bold=True, align="center")
    f_center = fmt(align="center", **box)
    f_center_bold = fmt(align="center", bold=True, **box)
    f_recipient = fmt(align="center", bold=True, font_size=20, text_wrap=True, **box)
    f_label = fmt(align="center", bold=True, bg_color=FILL, **box)
    f_side = fmt(align="center", bold=True, bg_color=FILL, text_wrap=True, **box)
    f_value = fmt(indent=1, text_wrap=True, **box)
    f_value_bold = fmt(indent=1, bold=True, **box)
    f_total_label = fmt(align="center", bold=True, font_size=14, bg_color=FILL, **box)
    f_total = fmt(
        align="center", bold=True, font_size=20, num_format='"₩ "#,##0"  (부가세 포함)"', **box
    )
    f_item = fmt(indent=1, bold=True, **box)
    f_number = fmt(align="right", indent=1, num_format="#,##0", **box)
    f_number_bold = fmt(align="right", indent=1, bold=True, num_format="#,##0", **box)
    f_sum = fmt(align="center", bold=True, font_size=13, num_format='#,##0" 원"', **box)
    f_foot = fmt(font_size=9, font_color=MUTED)

    row = 0
    sheet.set_row(row, 66)
    sheet.merge_range(row, 0, row, 6, "견   적   서", f_title)

    # 왼쪽: 발행일·수신·문구 / 오른쪽: 공급자
    top = row + 1
    for index, (label, value) in enumerate(SUPPLIER):
        sheet.set_row(top + index, 34 if label == "소재지" else 25)
        sheet.write(top + index, 3, label, f_label)
        sheet.merge_range(
            top + index, 4, top + index, 6, value, f_value_bold if index == 0 else f_value
        )
    sheet.merge_range(top, 2, top + 5, 2, "공\n급\n자", f_side)
    sheet.merge_range(
        top, 0, top, 1, f"{issued:%Y}년 {issued.month}월 {issued.day}일", f_center_bold
    )
    sheet.merge_range(
        top + 1, 0, top + 3, 1, f"{company_name} 귀하" if company_name else "", f_recipient
    )
    sheet.merge_range(top + 4, 0, top + 5, 1, "아래와 같이 견적합니다.", f_center)
    row = top + len(SUPPLIER)

    sheet.set_row(row, 46)
    sheet.merge_range(row, 0, row, 1, "합계 금액", f_total_label)
    sheet.merge_range(row, 2, row, 6, total, f_total)
    row += 1

    sheet.set_row(row, 27)
    for column, title in enumerate(["No", "품목", "소재", "수량", "단가", "공급가액", "세액"]):
        sheet.write(row, column, title, f_label)
    row += 1
    sheet.set_row(row, 27)
    sheet.write_number(row, 0, 1, f_center)
    sheet.write(row, 1, ITEM_NAME, f_item)
    sheet.write(row, 2, material, f_center)
    for column, number in zip((3, 4, 5, 6), (quantity, unit, supply, tax), strict=True):
        sheet.write_number(row, column, number, f_number)
    row += 1
    for _ in range(BLANK_ROWS):
        sheet.set_row(row, 25)
        for column in range(7):
            sheet.write_blank(row, column, None, f_center)
        row += 1
    sheet.set_row(row, 27)
    sheet.merge_range(row, 0, row, 4, "계", f_label)
    sheet.write_number(row, 5, supply, f_number_bold)
    sheet.write_number(row, 6, tax, f_number_bold)
    row += 1
    sheet.set_row(row, 32)
    sheet.merge_range(row, 0, row, 4, "합계 (부가세 포함)", f_label)
    sheet.merge_range(row, 5, row, 6, total, f_sum)
    row += 1

    sheet.set_row(row, 27)
    sheet.merge_range(row, 0, row, 6, "제작 사양", f_label)
    row += 1
    for label, value in specs:
        sheet.set_row(row, 25)
        sheet.merge_range(row, 0, row, 1, label, f_label)
        sheet.merge_range(row, 2, row, 6, value, f_value)
        row += 1
    sheet.set_row(row, 27)
    sheet.merge_range(row, 0, row, 1, "세금계산서 입금 계좌", f_label)
    sheet.merge_range(row, 2, row, 6, ACCOUNT, f_value_bold)
    row += 1
    sheet.set_row(row, 22)
    sheet.merge_range(
        row, 0, row, 6, "문의  help@essesion.com  ·  0507-1381-7422  ·  essesion.com", f_foot
    )

    sheet.hide_gridlines(2)
    sheet.set_paper(9)  # A4
    sheet.set_portrait()
    sheet.fit_to_pages(1, 0)
    sheet.center_horizontally()
    sheet.set_margins(left=0.6, right=0.6, top=0.7, bottom=0.7)
    sheet.print_area(0, 0, row, 6)
    workbook.close()
    return buffer.getvalue()
