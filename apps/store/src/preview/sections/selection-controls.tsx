import {
  Checkbox,
  RadioGroup,
  RadioGroupItem,
  Switch,
  VStack,
} from "@essesion/shared";

import { Section, SubSection } from "../section";

export function SelectionControlsSection() {
  return (
    <Section title="선택 컨트롤">
      <SubSection title="Checkbox">
        <VStack gap="x3" align="start">
          <Checkbox label="이용약관에 동의합니다" />
          <Checkbox label="마케팅 정보 수신 동의" defaultChecked />
          <Checkbox label="일부 항목만 선택됨" indeterminate />
          <Checkbox label="비활성 항목" disabled />
          <Checkbox
            size="large"
            label="큰 체크박스"
            description="설명 텍스트가 라벨 아래에 표시됩니다."
            defaultChecked
          />
        </VStack>
      </SubSection>

      <SubSection title="RadioGroup">
        <VStack gap="x5" align="start">
          <RadioGroup name="plan" defaultValue="basic">
            <RadioGroupItem
              value="basic"
              label="베이직"
              description="월 9,900원"
            />
            <RadioGroupItem
              value="pro"
              label="프로"
              description="월 19,900원"
            />
            <RadioGroupItem
              value="team"
              label="팀"
              description="별도 문의"
              disabled
            />
          </RadioGroup>
          <RadioGroup name="align" defaultValue="left" orientation="horizontal">
            <RadioGroupItem value="left" label="왼쪽" />
            <RadioGroupItem value="center" label="가운데" />
            <RadioGroupItem value="right" label="오른쪽" />
          </RadioGroup>
        </VStack>
      </SubSection>

      <SubSection title="Switch">
        <VStack gap="x3" align="start">
          <Switch label="알림 받기" />
          <Switch label="자동 저장" defaultChecked />
          <Switch label="비활성 (꺼짐)" disabled />
          <Switch label="비활성 (켜짐)" disabled defaultChecked />
          <Switch size="large" label="큰 스위치" defaultChecked />
        </VStack>
      </SubSection>
    </Section>
  );
}
