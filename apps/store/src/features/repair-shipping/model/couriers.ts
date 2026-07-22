/** 주문·수선 발송에서 선택할 수 있는 택배사 코드.
 *  코드는 백엔드 검증 규칙 `^[a-z0-9_-]{1,30}$`을 따른다. */
export const COURIER_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "cj", label: "CJ대한통운" },
  { value: "hanjin", label: "한진택배" },
  { value: "lotte", label: "롯데택배" },
  { value: "logen", label: "로젠택배" },
  { value: "epost", label: "우체국택배" },
  { value: "cupost", label: "CU 편의점택배" },
  { value: "cvsnet", label: "GS Postbox" },
  { value: "kyungdong", label: "경동택배" },
  { value: "daesin", label: "대신택배" },
  { value: "ilyang", label: "일양로지스" },
  { value: "chunil", label: "천일택배" },
  { value: "hapdong", label: "합동택배" },
  { value: "slx", label: "SLX택배" },
  { value: "etc", label: "기타" },
];

const TRACKING_URL_TEMPLATES: Partial<Record<string, string>> = {
  cj: "https://trace.cjlogistics.com/web/detail.jsp?slipno={trackingNumber}",
  hanjin:
    "https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mession=&wblnumText2={trackingNumber}",
  lotte:
    "https://www.lotteglogis.com/home/reservation/tracking/index?InvNo={trackingNumber}",
  logen: "https://www.ilogen.com/web/personal/trace/{trackingNumber}",
  epost:
    "https://service.epost.go.kr/trace.RetrieveDomRi498.postal?sid1={trackingNumber}",
  cupost:
    "https://www.cupost.co.kr/postbox/delivery/localResult.cupost?invoice_no={trackingNumber}",
  cvsnet:
    "https://www.cvsnet.co.kr/invoice/tracking.do?invoice_no={trackingNumber}",
  kyungdong:
    "https://kdexp.com/service/delivery/tracksearch.do?barcode={trackingNumber}",
  daesin:
    "https://home.ds3211.co.kr/freight/internalFreightSearch.ht?billno={trackingNumber}",
};

/** 미등록 코드는 운영자가 값을 확인할 수 있게 그대로 표시한다. */
export function courierLabel(code: string | null | undefined): string {
  if (!code) return "";
  return COURIER_OPTIONS.find((option) => option.value === code)?.label ?? code;
}

export function courierTrackingUrl(
  code: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (!code || !trackingNumber) return null;
  const template = TRACKING_URL_TEMPLATES[code];
  return template
    ? template.replace("{trackingNumber}", encodeURIComponent(trackingNumber))
    : null;
}
