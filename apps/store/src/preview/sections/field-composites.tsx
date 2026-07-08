import {
  AttachmentDisplayField,
  Box,
  FieldButton,
  ListPicker,
  SelectBox,
  SelectBoxItem,
  VStack,
} from "@essesion/shared";

import { Section, SubSection } from "../section";

export function FieldCompositesSection() {
  return (
    <Section title="필드 합성">
      <Box maxWidth={480}>
        <VStack gap="x6" alignItems="stretch">
          <SubSection title="FieldButton — placeholder · value · 상태">
            <VStack gap="x3" alignItems="stretch">
              <FieldButton label="카테고리" placeholder="카테고리 선택" />
              <FieldButton label="카테고리" value="의류 · 아우터" />
              <FieldButton
                label="배송지"
                value="서울시 강남구"
                description="주문 시 이 주소로 배송됩니다."
              />
              <FieldButton
                label="쿠폰"
                placeholder="쿠폰을 선택하세요"
                errorMessage="사용 가능한 쿠폰이 없습니다."
              />
              <FieldButton label="사이즈" placeholder="선택 불가" disabled />
              <FieldButton size="large" label="정렬 기준" value="최신순" />
            </VStack>
          </SubSection>
          <SubSection title="AttachmentDisplayField — 썸네일 · 제거 · 카운터">
            <AttachmentDisplayField
              label="상품 이미지"
              description="최대 5장까지 업로드할 수 있습니다."
              max={5}
              items={[
                {
                  id: "a",
                  src: "https://picsum.photos/seed/a/200",
                  alt: "상품 이미지 1",
                },
                {
                  id: "b",
                  src: "https://picsum.photos/seed/b/200",
                  alt: "상품 이미지 2",
                },
              ]}
              onRemove={(id) => console.log("remove", id)}
            />
          </SubSection>
          <SubSection title="SelectBox — 단일 선택 (카드)">
            <SelectBox defaultValue="standard" aria-label="배송 방법">
              <SelectBoxItem
                value="standard"
                label="일반 배송"
                description="2~3일 이내 도착 · 무료"
              />
              <SelectBoxItem
                value="express"
                label="빠른 배송"
                description="다음 날 도착 · ₩3,000"
              />
              <SelectBoxItem
                value="pickup"
                label="매장 픽업"
                description="가까운 매장에서 직접 수령"
                disabled
              />
            </SelectBox>
          </SubSection>
          <SubSection title="SelectBox — 다중 선택 (2열)">
            <SelectBox
              multiple
              columns={2}
              defaultValue={["gift"]}
              aria-label="추가 옵션"
            >
              <SelectBoxItem value="gift" label="선물 포장" />
              <SelectBoxItem value="message" label="메시지 카드" />
              <SelectBoxItem value="eco" label="에코 패키지" />
              <SelectBoxItem value="priority" label="우선 처리" />
            </SelectBox>
          </SubSection>
          <SubSection title="ListPicker — FieldButton+ResponsiveModal+List">
            <ListPicker
              label="정렬 기준"
              placeholder="정렬 방식 선택"
              defaultValue="latest"
              options={[
                { value: "latest", label: "최신순" },
                { value: "price-asc", label: "낮은 가격순" },
                {
                  value: "price-desc",
                  label: "높은 가격순",
                  description: "프리미엄 상품 먼저",
                },
                { value: "review", label: "리뷰 많은순", disabled: true },
              ]}
            />
          </SubSection>
        </VStack>
      </Box>
    </Section>
  );
}
