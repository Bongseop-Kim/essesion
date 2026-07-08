import {
  ActionButton,
  Callout,
  HStack,
  PageBanner,
  snackbar,
  VStack,
} from "@essesion/shared";
import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  SparklesIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";

import { Section, SubSection } from "../section";

export function FeedbackSection() {
  return (
    <Section title="피드백">
      <SubSection title="Snackbar">
        <HStack gap="x3" wrap>
          <ActionButton
            variant="neutralOutline"
            onClick={() => snackbar("장바구니에 담았어요")}
          >
            기본
          </ActionButton>
          <ActionButton
            variant="neutralOutline"
            onClick={() =>
              snackbar("항목을 삭제했어요", {
                action: { label: "되돌리기", onClick: () => {} },
              })
            }
          >
            액션 포함
          </ActionButton>
          <ActionButton
            variant="neutralOutline"
            onClick={() => {
              snackbar("첫 번째 알림");
              snackbar("두 번째 알림");
              snackbar("세 번째 알림");
            }}
          >
            연속 3개 (큐)
          </ActionButton>
        </HStack>
      </SubSection>

      <SubSection title="Callout — tone">
        <VStack gap="x3" width="full" maxWidth={520}>
          <Callout
            tone="neutral"
            icon={<InformationCircleIcon className="size-5" />}
            title="배송 안내"
            description="주문 후 평균 2~3일 내에 도착합니다."
          />
          <Callout
            tone="informative"
            icon={<InformationCircleIcon className="size-5" />}
            title="새 기능이 추가됐어요"
            description="이제 위시리스트를 폴더로 정리할 수 있습니다."
          />
          <Callout
            tone="positive"
            icon={<CheckCircleIcon className="size-5" />}
            title="결제가 완료됐어요"
            description="주문 내역은 마이페이지에서 확인하세요."
          />
          <Callout
            tone="warning"
            icon={<ExclamationTriangleIcon className="size-5" />}
            title="재고가 얼마 남지 않았어요"
            description="현재 3개 남았습니다. 서둘러 주문하세요."
          />
          <Callout
            tone="critical"
            icon={<XCircleIcon className="size-5" />}
            title="결제에 실패했어요"
            description="카드 정보를 확인하고 다시 시도해 주세요."
          />
        </VStack>
      </SubSection>

      <SubSection title="Callout — actionable · dismissible">
        <VStack gap="x3" width="full" maxWidth={520}>
          <Callout
            tone="informative"
            icon={<SparklesIcon className="size-5" />}
            title="프로필을 완성해 보세요"
            description="추천 상품을 더 정확하게 받아볼 수 있어요."
            onClick={() => {}}
          />
          <Callout
            tone="neutral"
            title="쿠폰이 도착했어요"
            description="장바구니에서 사용할 수 있습니다."
            onDismiss={() => {}}
          />
        </VStack>
      </SubSection>

      <SubSection title="PageBanner — weak · solid">
        <VStack gap="x3" width="full">
          <PageBanner
            variant="weak"
            tone="informative"
            title="시스템 점검 안내"
            description="7월 10일 새벽 2시부터 30분간 점검이 예정돼 있습니다."
            actionLabel="자세히"
            onAction={() => {}}
            onDismiss={() => {}}
          />
          <PageBanner
            variant="weak"
            tone="warning"
            title="주소지를 확인해 주세요"
            description="배송지가 오래전에 등록됐습니다."
            actionLabel="수정"
            onAction={() => {}}
          />
          <PageBanner
            variant="solid"
            tone="neutral"
            title="신규 회원 첫 구매 10% 할인"
            actionLabel="쿠폰 받기"
            onAction={() => {}}
            onDismiss={() => {}}
          />
          <PageBanner
            variant="solid"
            tone="positive"
            title="무료배송 이벤트 진행 중"
            description="오늘 자정까지 전 상품 무료배송."
            actionLabel="보러가기"
            onAction={() => {}}
          />
          <PageBanner
            variant="solid"
            tone="critical"
            title="결제 오류가 반복되고 있어요"
            actionLabel="문의하기"
            onAction={() => {}}
          />
        </VStack>
      </SubSection>
    </Section>
  );
}
