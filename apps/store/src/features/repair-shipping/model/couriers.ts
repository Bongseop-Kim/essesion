import { COURIER_OPTIONS, courierLabel } from "@essesion/shared";

// 택배사 목록은 admin 송장 입력과 같이 쓰려고 shared로 옮겼다 — 여기서는 조회 URL만 소유한다.
export { COURIER_OPTIONS, courierLabel };

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

export function courierTrackingUrl(
  code: string | null | undefined,
  trackingNumber: string | null | undefined,
): string | null {
  if (!code || !trackingNumber) return null;
  // admin 송장 입력은 택배사를 이름으로 저장한다(알림톡 #{택배사}) — 이름이면 코드로 되돌려 찾는다.
  const template =
    TRACKING_URL_TEMPLATES[
      COURIER_OPTIONS.find((option) => option.label === code)?.value ?? code
    ];
  return template
    ? template.replace("{trackingNumber}", encodeURIComponent(trackingNumber))
    : null;
}
