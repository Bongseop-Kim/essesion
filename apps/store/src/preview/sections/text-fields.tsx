import { Box, TextAreaField, TextField, VStack } from "@essesion/shared";

import { Section, SubSection } from "../section";

export function TextFieldsSection() {
  return (
    <Section title="텍스트 필드">
      <Box width="full" maxWidth={420}>
        <VStack gap="x5" alignItems="stretch">
          <SubSection title="기본 · placeholder · description">
            <TextField label="이름" placeholder="홍길동" />
            <TextField
              label="이메일"
              type="email"
              placeholder="you@example.com"
              description="주문 확인 메일을 이 주소로 보냅니다."
            />
          </SubSection>
          <SubSection title="prefix · suffix">
            <TextField
              label="판매가"
              type="number"
              inputMode="numeric"
              prefix="₩"
              suffix="KRW"
              placeholder="0"
            />
          </SubSection>
          <SubSection title="상태 — disabled · invalid">
            <TextField label="쿠폰 코드" defaultValue="SUMMER25" disabled />
            <TextField
              label="전화번호"
              defaultValue="010"
              errorMessage="올바른 전화번호 형식이 아닙니다."
            />
          </SubSection>
          <SubSection title="large">
            <TextField size="large" label="검색어" placeholder="상품 검색" />
          </SubSection>
          <SubSection title="TextAreaField — rows · autoResize">
            <TextAreaField
              label="배송 메모"
              placeholder="문 앞에 놓아주세요"
              rows={3}
            />
            <TextAreaField
              size="large"
              label="상품 설명"
              description="입력한 만큼 높이가 자동으로 늘어납니다."
              placeholder="상품을 설명해 주세요"
              autoResize
            />
          </SubSection>
        </VStack>
      </Box>
    </Section>
  );
}
