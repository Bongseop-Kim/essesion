export const CUSTOM_DELIVERY_REQUEST = "DELIVERY_REQUEST_5";

export const DELIVERY_REQUEST_OPTIONS = [
  { value: "", label: "요청사항 없음" },
  { value: "DELIVERY_REQUEST_1", label: "문 앞에 놔주세요." },
  { value: "DELIVERY_REQUEST_2", label: "경비실에 맡겨 주세요." },
  { value: "DELIVERY_REQUEST_3", label: "택배함에 넣어 주세요." },
  { value: "DELIVERY_REQUEST_4", label: "배송 전에 연락 주세요." },
  { value: CUSTOM_DELIVERY_REQUEST, label: "직접입력" },
] as const;

export function deliveryRequestLabel(
  request: string | null | undefined,
  memo?: string | null,
) {
  if (!request) return undefined;
  if (request === CUSTOM_DELIVERY_REQUEST) return memo || "직접입력";
  return DELIVERY_REQUEST_OPTIONS.find((option) => option.value === request)
    ?.label;
}
