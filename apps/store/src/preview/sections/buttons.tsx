import {
  ActionButton,
  Badge,
  Chip,
  FloatingActionButton,
  HStack,
  ToggleButton,
  VStack,
} from "@essesion/shared";
import { PlusIcon } from "@heroicons/react/24/outline";

import { Section, SubSection } from "../section";

const badgeTones = [
  "neutral",
  "brand",
  "critical",
  "positive",
  "warning",
  "informative",
] as const;

export function ButtonsSection() {
  return (
    <Section title="버튼">
      <SubSection title="ActionButton — variant × size">
        <VStack gap="x3">
          {(["xsmall", "small", "medium", "large"] as const).map((size) => (
            <HStack key={size} gap="x3" wrap>
              <ActionButton size={size}>주문하기</ActionButton>
              <ActionButton size={size} variant="neutralWeak">
                담기
              </ActionButton>
              <ActionButton size={size} variant="neutralOutline">
                옵션 변경
              </ActionButton>
              <ActionButton size={size} variant="ghost">
                취소
              </ActionButton>
              <ActionButton size={size} variant="criticalSolid">
                삭제
              </ActionButton>
              <ActionButton size={size} disabled>
                품절
              </ActionButton>
              <ActionButton size={size} loading>
                주문하기
              </ActionButton>
            </HStack>
          ))}
        </VStack>
      </SubSection>
      {/* Batch 2: ToggleButton · Chip · FloatingActionButton */}
      <SubSection title="ToggleButton — variant × pressed">
        <HStack gap="x3" wrap>
          <ToggleButton variant="brandSolid">팔로우</ToggleButton>
          <ToggleButton variant="brandSolid" defaultPressed>
            팔로잉
          </ToggleButton>
          <ToggleButton variant="neutralWeak">관심</ToggleButton>
          <ToggleButton variant="neutralWeak" defaultPressed>
            관심 해제
          </ToggleButton>
          <ToggleButton size="xsmall">작게</ToggleButton>
          <ToggleButton size="xsmall" defaultPressed>
            작게 눌림
          </ToggleButton>
        </HStack>
      </SubSection>
      <SubSection title="Chip — variant × selected × size">
        <VStack gap="x3">
          {(["small", "medium", "large"] as const).map((size) => (
            <HStack key={size} gap="x3" wrap>
              <Chip size={size}>전체</Chip>
              <Chip size={size} defaultSelected>
                신상품
              </Chip>
              <Chip size={size} variant="outline">
                베스트
              </Chip>
              <Chip size={size} variant="outline" defaultSelected>
                할인
              </Chip>
              <Chip size={size} disabled>
                품절
              </Chip>
            </HStack>
          ))}
        </VStack>
      </SubSection>
      <SubSection title="FloatingActionButton — 기본 · extended">
        <HStack gap="x3" wrap>
          <FloatingActionButton
            aria-label="상품 추가"
            icon={<PlusIcon className="size-6" />}
          />
          <FloatingActionButton extended icon={<PlusIcon className="size-6" />}>
            상품 추가
          </FloatingActionButton>
        </HStack>
      </SubSection>
      <SubSection title="Badge — variant × tone">
        <VStack gap="x3">
          {(["weak", "solid", "outline"] as const).map((variant) => (
            <HStack key={variant} gap="x2" wrap>
              {badgeTones.map((tone) => (
                <Badge key={tone} variant={variant} tone={tone}>
                  {tone}
                </Badge>
              ))}
            </HStack>
          ))}
          <HStack gap="x2" wrap>
            {badgeTones.map((tone) => (
              <Badge key={tone} size="large" variant="solid" tone={tone}>
                {tone}
              </Badge>
            ))}
          </HStack>
        </VStack>
      </SubSection>
    </Section>
  );
}
