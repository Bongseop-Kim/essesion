export type FaqItem = {
  id: string;
  category: string;
  question: string;
  answer: string;
  sort_order: number;
  is_visible: boolean;
};

export const FAQ_DATA = [
  {
    id: "shipping-tracking",
    category: "배송",
    question: "배송 진행 상황은 어디에서 확인하나요?",
    answer: `로그인 후 마이페이지의 주문 내역에서 주문을 선택하면 배송 상태와 송장 정보를 확인할 수 있습니다.

출고 직후에는 택배사 시스템에 송장이 반영되기까지 시간이 걸릴 수 있습니다. 송장 정보가 오래 보이지 않으면 고객지원으로 주문번호를 알려 주세요.`,
    sort_order: 10,
    is_visible: true,
  },
  {
    id: "shipping-duration",
    category: "배송",
    question: "배송에는 얼마나 걸리나요?",
    answer: `일반 상품은 결제 완료 후 재고와 택배사 일정을 확인해 순차 발송합니다. 주말·공휴일, 주문 집중 기간과 도서산간 지역은 더 걸릴 수 있습니다.

맞춤·샘플 제작과 수선 주문은 제작 또는 작업 기간이 별도로 필요하며, 주문 화면과 진행 안내에서 예상 일정을 확인할 수 있습니다.`,
    sort_order: 20,
    is_visible: true,
  },
  {
    id: "shipping-cost",
    category: "배송",
    question: "배송비는 얼마인가요?",
    answer: `일반 상품의 배송비는 주문서에 표시되는 금액을 확인해 주세요.

■ 수선 배송비
- 수선품 반환 배송: {{REFORM_SHIPPING_COST}}원
- 방문 수거 신청: {{REFORM_PICKUP_FEE}}원 추가

제주 및 도서산간 지역은 추가 비용이 발생할 수 있습니다.`,
    sort_order: 30,
    is_visible: true,
  },
  {
    id: "shipping-address-change",
    category: "배송",
    question: "주문 후 배송지를 바꿀 수 있나요?",
    answer: `결제 전에는 주문서에서 배송지를 다시 선택할 수 있습니다. 결제 후에는 주문 처리 상태에 따라 변경이 제한될 수 있으므로 고객지원에 주문번호와 새 배송지를 빠르게 알려 주세요.

이미 출고된 주문은 회사에서 주소를 변경할 수 없으며 택배사와 별도 협의가 필요할 수 있습니다.`,
    sort_order: 40,
    is_visible: true,
  },
  {
    id: "order-cancel",
    category: "주문·결제",
    question: "주문 취소는 어떻게 신청하나요?",
    answer: `마이페이지 > 주문 내역 > 주문 상세에서 현재 상태에 가능한 취소 메뉴를 선택해 신청할 수 있습니다.

배송, 수선 또는 제작이 이미 시작된 경우에는 취소가 제한되거나 발생 비용이 공제될 수 있습니다. 자세한 기준은 환불정책을 확인해 주세요.`,
    sort_order: 50,
    is_visible: true,
  },
  {
    id: "return-exchange",
    category: "주문·결제",
    question: "반품이나 교환은 어떻게 신청하나요?",
    answer: `일반 상품은 주문 상세에 표시되는 반품·교환 메뉴에서 신청할 수 있습니다. 상품을 받은 날부터 7일 이내 신청이 원칙입니다.

상품 하자나 오배송이 아닌 단순 변심은 반환 배송비가 발생할 수 있고, 개별 제작 상품은 진행 단계에 따라 제한됩니다.`,
    sort_order: 60,
    is_visible: true,
  },
  {
    id: "payment-methods",
    category: "주문·결제",
    question: "어떤 결제 수단을 사용할 수 있나요?",
    answer: `결제는 토스페이먼츠 결제창에서 진행합니다. 실제로 사용할 수 있는 카드·간편결제 등의 수단은 주문 시 결제창에 표시되는 목록을 기준으로 합니다.

결제가 완료되지 않았거나 결과 확인이 지연되면 같은 주문을 중복 결제하지 말고 주문 내역을 먼저 확인해 주세요.`,
    sort_order: 70,
    is_visible: true,
  },
  {
    id: "coupon-use",
    category: "주문·결제",
    question: "쿠폰은 어떻게 사용하나요?",
    answer: `사용 가능한 쿠폰이 있으면 주문서에서 상품별로 선택할 수 있습니다. 쿠폰마다 최소 주문금액, 대상 상품, 유효기간과 중복 사용 조건이 다릅니다.

결제가 완료되기 전 취소된 대기 주문의 예약 쿠폰은 상태 확인 후 다시 사용할 수 있도록 복원됩니다.`,
    sort_order: 80,
    is_visible: true,
  },
  {
    id: "custom-order",
    category: "맞춤 제작",
    question: "맞춤 넥타이는 어떻게 주문하나요?",
    answer: `주문 제작 페이지에서 원단, 타이·심지, 수량, 봉제와 마감 사양을 선택하고 참고 이미지를 첨부할 수 있습니다.

수량과 사양에 따라 즉시 주문 또는 견적 요청으로 나뉩니다. 개별 제작이므로 제출 전 치수와 첨부 자료를 꼭 확인해 주세요.`,
    sort_order: 90,
    is_visible: true,
  },
  {
    id: "sample-order",
    category: "맞춤 제작",
    question: "본 주문 전에 샘플을 만들 수 있나요?",
    answer: `샘플 제작 페이지에서 샘플 유형, 원단, 봉제 사양과 참고 이미지를 선택해 주문할 수 있습니다.

샘플 비용과 제작 가능 범위는 선택한 조건에 따라 계산되며, 샘플 확인 뒤 본 제작은 별도의 맞춤 주문으로 진행합니다.`,
    sort_order: 100,
    is_visible: true,
  },
  {
    id: "reform-apply",
    category: "수선",
    question: "넥타이 수선은 어떻게 신청하나요?",
    answer: `수선 페이지에서 넥타이 사진을 등록하고 길이, 폭, 복원 등 필요한 작업을 선택합니다. 여러 개를 한 번에 등록하고 같은 옵션을 일괄 적용할 수도 있습니다.

주문 후에는 직접 발송 또는 방문 수거를 선택하고 주문 상세의 안내에 따라 수선품을 보내 주세요.`,
    sort_order: 110,
    is_visible: true,
  },
  {
    id: "reform-unavailable",
    category: "수선",
    question: "수선이 어려운 경우도 있나요?",
    answer: `원단 손상이 심하거나, 특수 소재·장식·기존 수선 흔적 때문에 요청한 작업이 어려울 수 있습니다.

온라인 사진만으로 확정하기 어려운 경우 실물을 확인한 뒤 가능 여부를 안내합니다. 작업이 불가능하면 진행된 운송 비용을 포함한 환불 기준을 개별 안내합니다.`,
    sort_order: 120,
    is_visible: true,
  },
  {
    id: "ai-design",
    category: "AI 디자인",
    question: "AI 디자인 서비스는 무엇인가요?",
    answer: `원하는 분위기와 패턴을 입력해 넥타이·원단용 반복 디자인을 생성하는 서비스입니다. 생성 결과는 입력 내용과 외부 모델의 처리 결과에 따라 달라질 수 있습니다.

타인의 개인정보, 로고, 이미지 또는 저작물을 사용할 때에는 필요한 권리를 먼저 확인해야 합니다.`,
    sort_order: 130,
    is_visible: true,
  },
  {
    id: "design-token-use",
    category: "AI 디자인",
    question: "디자인 토큰은 어떻게 사용되나요?",
    answer: `디자인 토큰은 AI 디자인 생성 요청에 사용하는 크레딧입니다. 보유량과 패키지는 토큰 구매 페이지에서 확인할 수 있습니다.

생성 요청이 실패하면 해당 요청에서 차감된 토큰은 자동으로 복원됩니다. 무료 지급 토큰과 구매 토큰은 환불 조건이 다를 수 있습니다.`,
    sort_order: 140,
    is_visible: true,
  },
  {
    id: "design-token-refund",
    category: "AI 디자인",
    question: "구매한 디자인 토큰을 환불할 수 있나요?",
    answer: `사용하지 않은 유료 토큰은 환불을 신청할 수 있습니다. 이미 정상적으로 사용한 토큰과 이벤트 등으로 무상 지급된 토큰은 환불 금액에 포함되지 않습니다.

세부 기준과 신청 방법은 환불정책 및 토큰 구매 내역의 안내를 확인해 주세요.`,
    sort_order: 150,
    is_visible: true,
  },
  {
    id: "account-login",
    category: "계정",
    question: "회원가입 없이 이용할 수 있나요?",
    answer: `상품과 안내 페이지는 로그인 없이 볼 수 있고, 게스트 장바구니도 사용할 수 있습니다.

주문, 결제, 주문 내역, 배송지와 토큰 관리는 로그인이 필요합니다. 고객용 아이디·비밀번호 가입은 제공하지 않으며 Google 또는 Kakao 로그인을 지원합니다.`,
    sort_order: 160,
    is_visible: true,
  },
  {
    id: "business-hours",
    category: "고객지원",
    question: "고객지원 운영시간은 언제인가요?",
    answer: `고객지원 운영시간과 연락처는 사이트 하단의 사업자 정보를 확인해 주세요. 주말·공휴일이나 운영시간 이후에 접수된 문의는 다음 영업일부터 순차적으로 확인합니다.

주문 관련 문의에는 주문번호를 함께 남겨 주시면 더 빠르게 확인할 수 있습니다.`,
    sort_order: 170,
    is_visible: true,
  },
  {
    id: "visit-store",
    category: "고객지원",
    question: "방문 상담이나 수선 접수가 가능한가요?",
    answer: `방문 상담과 수선 접수가 필요한 경우 사이트 하단 연락처로 먼저 일정을 확인해 주세요. 사전 확인 없이 방문하면 작업 일정이나 담당자 부재로 바로 응대하기 어려울 수 있습니다.

방문 주소는 사이트 하단의 최신 사업자 정보를 기준으로 확인해 주세요.`,
    sort_order: 180,
    is_visible: true,
  },
] satisfies readonly FaqItem[];

export const VISIBLE_FAQS = FAQ_DATA.filter((item) => item.is_visible).sort(
  (a, b) => a.sort_order - b.sort_order,
);
