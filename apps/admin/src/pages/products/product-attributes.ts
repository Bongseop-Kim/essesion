export const PRODUCT_CATEGORIES = [
  { value: "3fold", label: "쓰리폴드" },
  { value: "sfolderato", label: "스폴데라토" },
  { value: "knit", label: "니트" },
  { value: "bowtie", label: "보타이" },
] as const;

export const PRODUCT_COLORS = [
  { value: "black", label: "블랙" },
  { value: "navy", label: "네이비" },
  { value: "gray", label: "그레이" },
  { value: "wine", label: "와인" },
  { value: "blue", label: "블루" },
  { value: "brown", label: "브라운" },
  { value: "beige", label: "베이지" },
  { value: "silver", label: "실버" },
] as const;

export const PRODUCT_PATTERNS = [
  { value: "solid", label: "솔리드" },
  { value: "stripe", label: "스트라이프" },
  { value: "dot", label: "도트" },
  { value: "check", label: "체크" },
  { value: "paisley", label: "페이즐리" },
] as const;

export const PRODUCT_MATERIALS = [
  { value: "silk", label: "실크" },
  { value: "cotton", label: "코튼" },
  { value: "polyester", label: "폴리에스터" },
  { value: "wool", label: "울" },
] as const;

export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number]["value"];
export type ProductColor = (typeof PRODUCT_COLORS)[number]["value"];
export type ProductPattern = (typeof PRODUCT_PATTERNS)[number]["value"];
export type ProductMaterial = (typeof PRODUCT_MATERIALS)[number]["value"];
