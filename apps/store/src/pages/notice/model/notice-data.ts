export type NoticeItem = {
  id: string;
  category: string;
  title: string;
  content: string;
  pinned: boolean;
  is_visible: boolean;
  published_at: string;
};

export const NOTICE_DATA = [
  {
    id: "service-rebuild",
    category: "서비스",
    title: "ESSE SION 서비스 개편 안내",
    content: `ESSE SION의 스토어, 주문, 수선과 맞춤 제작 서비스를 새 시스템으로 개편했습니다.

■ 주요 변경 사항
- 모바일과 데스크톱 화면 개선
- 주문·결제와 배송지 관리 흐름 정리
- 주문 상세에서 취소·교환·반품 신청 가능
- 수선, 맞춤 제작과 샘플 제작 주문 통합

기존 서비스 전환 일정과 계정 관련 추가 안내는 별도 공지를 확인해 주세요.`,
    pinned: true,
    is_visible: true,
    published_at: "2026-07-11",
  },
  {
    id: "reform-shipping-fees",
    category: "수선",
    title: "수선품 배송 및 방문 수거 비용 안내",
    content: `수선 주문의 배송 비용을 안내합니다.

■ 비용
- 수선 완료품 반환 배송: {{REFORM_SHIPPING_COST}}원
- 방문 수거 신청: {{REFORM_PICKUP_FEE}}원 추가

직접 발송을 선택한 경우 고객이 수선품을 보내는 비용은 별도입니다. 제주 및 도서산간 지역은 추가 비용이 발생할 수 있습니다.`,
    pinned: true,
    is_visible: true,
    published_at: "2026-07-10",
  },
  {
    id: "social-login",
    category: "계정",
    title: "Google·Kakao 소셜 로그인 안내",
    content: `고객 계정은 Google 또는 Kakao 소셜 로그인으로 이용할 수 있습니다.

상품과 안내 페이지는 로그인 없이 볼 수 있으며, 주문·결제·배송지·주문 내역과 디자인 토큰 관리는 로그인이 필요합니다. 고객용 아이디·비밀번호 회원가입은 제공하지 않습니다.`,
    pinned: false,
    is_visible: true,
    published_at: "2026-07-09",
  },
  {
    id: "toss-payment",
    category: "결제",
    title: "토스페이먼츠 결제 및 결과 확인 안내",
    content: `상품, 수선, 제작 및 디자인 토큰 결제는 토스페이먼츠 결제창에서 진행합니다.

결제 직후 화면을 닫았거나 결과 확인이 늦어지는 경우 같은 주문을 다시 결제하기 전에 마이페이지 주문 내역을 먼저 확인해 주세요. 승인 결과는 중복 처리되지 않도록 주문 단위로 확인합니다.`,
    pinned: false,
    is_visible: true,
    published_at: "2026-07-08",
  },
  {
    id: "custom-order-open",
    category: "맞춤 제작",
    title: "맞춤 넥타이 제작 주문 안내",
    content: `맞춤 주문에서 원단, 수량, 타이·심지, 봉제와 마감 사양을 선택할 수 있습니다.

선택한 사양과 수량에 따라 가격을 바로 확인하거나 견적 요청으로 접수합니다. 참고 이미지는 최대 5장까지 첨부할 수 있으며, 제출 전 치수와 제작 사양을 확인해 주세요.`,
    pinned: false,
    is_visible: true,
    published_at: "2026-07-07",
  },
  {
    id: "sample-order-open",
    category: "샘플 제작",
    title: "샘플 제작 주문 안내",
    content: `본 제작 전 원단과 봉제 사양을 확인할 수 있도록 샘플 제작 주문을 제공합니다.

샘플 유형과 사양을 선택하면 주문 금액을 확인할 수 있고, 참고 이미지는 최대 5장까지 첨부할 수 있습니다. 샘플 주문과 본 제작 주문은 각각 별도로 진행됩니다.`,
    pinned: false,
    is_visible: true,
    published_at: "2026-07-06",
  },
  {
    id: "design-token-purchase",
    category: "AI 디자인",
    title: "디자인 토큰 구매와 실패 복원 안내",
    content: `AI 디자인 생성에 사용하는 디자인 토큰 패키지와 잔액을 토큰 구매 페이지에서 확인할 수 있습니다.

정상 완료된 생성 요청에는 안내된 토큰이 사용됩니다. 시스템 또는 외부 생성 처리 실패로 결과를 만들지 못한 경우 해당 요청에서 차감된 토큰은 자동으로 복원됩니다.`,
    pinned: false,
    is_visible: true,
    published_at: "2026-07-05",
  },
  {
    id: "order-claim-history",
    category: "주문",
    title: "주문 상세 및 취소·교환·반품 내역 안내",
    content: `마이페이지에서 주문 유형별 진행 상태, 배송 정보와 결제 금액을 확인할 수 있습니다.

현재 주문 상태에서 가능한 경우 주문 상세에 취소·교환·반품 버튼이 표시됩니다. 접수한 요청의 처리 상태와 배송 정보는 취소·반품·교환 내역에서 확인해 주세요.`,
    pinned: false,
    is_visible: true,
    published_at: "2026-07-04",
  },
] satisfies readonly NoticeItem[];

export function getVisibleNotices(
  notices: readonly NoticeItem[] = NOTICE_DATA,
): NoticeItem[] {
  return notices
    .filter((notice) => notice.is_visible)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.published_at.localeCompare(a.published_at),
    );
}
