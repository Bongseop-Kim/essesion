import { Text, VStack } from "@essesion/shared";

import { ContentLayout } from "@/shared/ui/content-layout";
import {
  PolicyDocument,
  PolicyInfoBox,
  PolicyList,
  PolicySection,
} from "@/shared/ui/policy-blocks";

const bodyProps = {
  textStyle: "bodySm",
  color: "fg.neutral-muted",
} as const;

export function RefundPolicyContent() {
  return (
    <PolicyDocument>
      <PolicySection title="1. 적용 범위">
        <Text as="p" {...bodyProps}>
          이 정책은 영선산업(상호명 ESSE SION, 이하 “회사”)이 판매하는 일반
          상품, 수선, 맞춤·샘플 제작 및 디자인 토큰의 취소, 교환과 환불에
          적용됩니다. 관련 법령이 이 정책보다 이용자에게 유리한 기준을 정한 경우
          그 법령을 우선합니다.
        </Text>
      </PolicySection>

      <PolicySection title="2. 일반 상품의 청약철회 기간">
        <Text as="p" {...bodyProps}>
          이용자는 상품을 받은 날부터 7일 이내에 청약철회를 신청할 수 있습니다.
          공급이 늦거나 계약 내용을 확인하기 어려웠던 경우의 기산일은 관련
          법령을 따릅니다.
        </Text>
      </PolicySection>

      <PolicySection title="3. 청약철회가 제한되는 경우">
        <PolicyList
          items={[
            "이용자 책임으로 상품이 멸실·훼손된 경우. 다만 내용을 확인하기 위한 포장 훼손은 제외합니다.",
            "사용 또는 일부 소비로 상품 가치가 현저히 감소한 경우",
            "시간이 지나 재판매가 곤란할 정도로 상품 가치가 현저히 감소한 경우",
            "이용자 주문에 따라 개별 생산되는 상품으로서, 철회 시 회사에 회복하기 어려운 중대한 피해가 예상되고 법령상 사전 고지와 동의 요건을 갖춘 경우",
            "디지털 서비스 제공이 시작되었고 법령상 사전 고지와 동의 요건을 갖춘 경우",
          ]}
        />
      </PolicySection>

      <PolicySection title="4. 표시·광고 또는 계약과 다른 상품">
        <Text as="p" {...bodyProps}>
          상품이나 서비스가 표시·광고 또는 계약 내용과 다르게 제공된 경우,
          이용자는 공급받은 날부터 3개월 이내이면서 그 사실을 안 날 또는 알 수
          있었던 날부터 30일 이내에 청약철회를 신청할 수 있습니다.
        </Text>
      </PolicySection>

      <PolicySection title="5. 취소·교환·반품 신청 방법">
        <Text as="p" {...bodyProps}>
          마이페이지의 주문 상세에서 해당 주문에 표시되는 취소·교환·반품 메뉴를
          이용합니다. 메뉴가 보이지 않거나 별도 협의가 필요한 제작 주문은
          고객지원으로 주문번호, 대상 상품과 사유를 알려 주세요. 진행 중 상태에
          따라 가능한 신청 유형이 달라질 수 있습니다.
        </Text>
      </PolicySection>

      <PolicySection title="6. 반환 비용">
        <PolicyList
          items={[
            "단순 변심에 따른 반환 비용은 이용자가 부담합니다.",
            "상품 하자, 오배송 또는 계약 내용과 다른 이행에 따른 반환 비용은 회사가 부담합니다.",
            "무료 배송 주문을 전부 반품하면 최초 배송비를 포함한 실제 반환 비용이 공제될 수 있습니다.",
          ]}
        />
      </PolicySection>

      <PolicySection title="7. 환불 방법과 시기">
        <Text as="p" {...bodyProps}>
          회사는 반환 상품을 받은 날 또는 서비스 청약철회가 성립한 날을 기준으로
          관련 법령이 정한 기간 안에 결제 취소나 환급에 필요한 조치를 합니다.
          원칙적으로 결제에 사용한 수단으로 환불하며, 결제사·카드사 처리 일정에
          따라 실제 반영 시점이 달라질 수 있습니다. 법정 기간을 넘겨 지연한
          경우에는 관련 법령이 정한 지연배상 기준을 적용합니다.
        </Text>
      </PolicySection>

      <PolicySection title="8. 교환">
        <Text as="p" {...bodyProps}>
          재고가 있는 일반 상품은 동일 상품 또는 협의한 상품으로 교환할 수
          있습니다. 교환품을 제공하기 어려운 경우 환불로 처리할 수 있습니다.
          교환 배송비 부담은 제6조의 귀책 기준을 따릅니다.
        </Text>
      </PolicySection>

      <PolicySection title="9. 맞춤·샘플 제작 주문">
        <PolicyList
          items={[
            "제작 시작 전에는 이미 발생한 실비가 없다면 전액 취소할 수 있습니다.",
            "원단 출력, 샘플 또는 본 제작이 시작된 뒤에는 진행 단계와 실제 발생 비용을 확인하여 환불액을 안내합니다.",
            "개별 제작 상품의 단순 변심 철회 제한은 법령상 사전 고지와 동의 요건을 갖춘 경우에만 적용합니다.",
            "합의한 사양과 다르거나 하자가 있는 경우 재제작, 수선, 교환 또는 환불을 협의합니다.",
          ]}
        />
      </PolicySection>

      <PolicySection title="10. 수선 주문">
        <PolicyList
          items={[
            "수선품 발송 또는 방문 수거 전에는 전액 취소할 수 있습니다.",
            "운송이 시작된 뒤에는 실제 발생한 왕복 배송비가 공제될 수 있습니다.",
            "수선 작업이 시작된 뒤에는 진행된 작업과 실제 비용을 기준으로 환불 가능 여부를 안내합니다.",
            "합의한 수선 내용과 다르거나 작업상 하자가 있는 경우 재수선 또는 환불을 협의합니다.",
          ]}
        />
      </PolicySection>

      <PolicySection title="11. 디자인 토큰과 디지털 서비스">
        <PolicyList
          items={[
            "사용하지 않은 유료 토큰의 환불은 마이페이지 또는 고객지원을 통해 신청할 수 있습니다.",
            "무상으로 지급된 토큰과 이미 정상적으로 사용된 토큰은 환불 금액에 포함되지 않습니다.",
            "AI 디자인 생성이 실패하면 해당 요청에서 차감한 토큰은 자동으로 복원합니다.",
            "디지털 서비스 제공 개시 후 철회 제한은 관련 법령상 사전 고지와 동의 요건을 갖춘 경우에만 적용합니다.",
          ]}
        />
      </PolicySection>

      <PolicySection title="12. 정책 변경과 시행일">
        <Text as="p" {...bodyProps}>
          정책이 변경되면 적용일과 주요 내용을 공지사항에 안내합니다.
        </Text>
        <PolicyInfoBox>
          <Text textStyle="labelSm">시행일: [운영 확정 필요]</Text>
        </PolicyInfoBox>
      </PolicySection>
    </PolicyDocument>
  );
}

export function RefundPolicyPage() {
  return (
    <>
      <title>환불정책 | ESSE SION</title>
      <meta
        name="description"
        content="ESSE SION의 일반 상품, 수선, 맞춤 제작과 디자인 토큰의 취소·교환·환불 기준을 안내합니다."
      />
      <ContentLayout
        breadcrumbs={[{ label: "홈", href: "/" }, { label: "환불정책" }]}
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2" alignItems="stretch">
            <Text as="h1" textStyle="title1">
              환불정책
            </Text>
            <Text as="p" textStyle="body" color="fg.neutral-muted">
              주문 유형별 취소·교환·환불 기준을 확인해 주세요.
            </Text>
          </VStack>
          <RefundPolicyContent />
        </VStack>
      </ContentLayout>
    </>
  );
}
