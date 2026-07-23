import type { ListProductsData } from "@essesion/api-client";

import { krw } from "@/shared/lib/format";

export { krw };

type ProductQuery = NonNullable<ListProductsData["query"]>;

export type ProductCategory = NonNullable<ProductQuery["category"]>;
export type ProductColor = NonNullable<ProductQuery["color"]>;
export type ProductPattern = NonNullable<ProductQuery["pattern"]>;
export type ProductMaterial = NonNullable<ProductQuery["material"]>;
export type ProductSort = NonNullable<ProductQuery["sort"]>;

export type FilterValue<T extends string> = "all" | T;

export const PAGE_SIZE = 12;

export const CATEGORY_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "3fold", label: "3폴드" },
  { value: "sfolderato", label: "스포데라토" },
  { value: "knit", label: "니트" },
  { value: "bowtie", label: "보타이" },
] as const satisfies readonly {
  value: FilterValue<ProductCategory>;
  label: string;
}[];

export const COLOR_OPTIONS = [
  { value: "all", label: "전체 색상" },
  { value: "black", label: "블랙" },
  { value: "navy", label: "네이비" },
  { value: "gray", label: "그레이" },
  { value: "wine", label: "와인" },
  { value: "blue", label: "블루" },
  { value: "brown", label: "브라운" },
  { value: "beige", label: "베이지" },
  { value: "silver", label: "실버" },
] as const satisfies readonly {
  value: FilterValue<ProductColor>;
  label: string;
}[];

export const PATTERN_OPTIONS = [
  { value: "all", label: "전체 패턴" },
  { value: "solid", label: "솔리드" },
  { value: "stripe", label: "스트라이프" },
  { value: "dot", label: "도트" },
  { value: "check", label: "체크" },
  { value: "paisley", label: "페이즐리" },
] as const satisfies readonly {
  value: FilterValue<ProductPattern>;
  label: string;
}[];

export const MATERIAL_OPTIONS = [
  { value: "all", label: "전체 소재" },
  { value: "silk", label: "실크" },
  { value: "cotton", label: "코튼" },
  { value: "polyester", label: "폴리에스터" },
  { value: "wool", label: "울" },
] as const satisfies readonly {
  value: FilterValue<ProductMaterial>;
  label: string;
}[];

export const SORT_OPTIONS = [
  { value: "latest", label: "최신순" },
  { value: "popular", label: "인기순" },
  { value: "price-low", label: "낮은 가격순" },
  { value: "price-high", label: "높은 가격순" },
] as const satisfies readonly { value: ProductSort; label: string }[];

const CATEGORY_LABELS = Object.fromEntries(
  CATEGORY_OPTIONS.filter((option) => option.value !== "all").map((option) => [
    option.value,
    option.label,
  ]),
) as Record<string, string>;
const COLOR_LABELS = Object.fromEntries(
  COLOR_OPTIONS.filter((option) => option.value !== "all").map((option) => [
    option.value,
    option.label,
  ]),
) as Record<string, string>;
const PATTERN_LABELS = Object.fromEntries(
  PATTERN_OPTIONS.filter((option) => option.value !== "all").map((option) => [
    option.value,
    option.label,
  ]),
) as Record<string, string>;
const MATERIAL_LABELS = Object.fromEntries(
  MATERIAL_OPTIONS.filter((option) => option.value !== "all").map((option) => [
    option.value,
    option.label,
  ]),
) as Record<string, string>;

export function categoryLabel(value: string) {
  return CATEGORY_LABELS[value] ?? value;
}

export function colorLabel(value: string) {
  return COLOR_LABELS[value] ?? value;
}

export function patternLabel(value: string) {
  return PATTERN_LABELS[value] ?? value;
}

export function materialLabel(value: string) {
  return MATERIAL_LABELS[value] ?? value;
}

export function selectedFilter<T extends string>(
  value: FilterValue<T>,
): T | undefined {
  return value === "all" ? undefined : value;
}

export function optionLabel(option: {
  name: string;
  additional_price: number;
}) {
  return option.additional_price > 0
    ? `${option.name} (+₩${krw.format(option.additional_price)})`
    : option.name;
}

export function optionDescription(option: { stock: number | null }) {
  if (option.stock === 0) return "품절";
  if (option.stock != null && option.stock <= 5) {
    return `${option.stock}개 남음`;
  }
  return undefined;
}
