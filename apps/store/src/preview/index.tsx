// 5단계에서 재작성 — 디자인 시스템 살아있는 검증 페이지 (임시)
import {
  Box,
  SnackbarHost,
  Text,
  useBreakpoint,
  VStack,
} from "@essesion/shared";

import { ButtonsSection } from "./sections/buttons";
import { ContentSection } from "./sections/content";
import { DialogsSection } from "./sections/dialogs";
import { DisplaySection } from "./sections/display";
import { FeedbackSection } from "./sections/feedback";
import { FieldCompositesSection } from "./sections/field-composites";
import { LayoutSection } from "./sections/layout";
import { MenuSection } from "./sections/menu";
import { NavigationSection } from "./sections/navigation";
import { SelectionControlsSection } from "./sections/selection-controls";
import { SheetsSection } from "./sections/sheets";
import { TextFieldsSection } from "./sections/text-fields";
import { TokensSection } from "./sections/tokens";

export function Preview() {
  const bp = useBreakpoint();
  return (
    <Box maxWidth={1040} mx="auto" px={{ base: "x4", md: "x6" }} py="x8">
      <VStack gap="x12">
        <VStack gap="x2">
          <Text as="h1" textStyle="display1">
            essesion 디자인 시스템
          </Text>
          <Text textStyle="bodySm" color="fg.neutral-muted">
            현재 브레이크포인트: {bp} — 창 크기를 바꿔 반응형을 확인
          </Text>
        </VStack>
        <TokensSection />
        <ButtonsSection />
        <TextFieldsSection />
        <SelectionControlsSection />
        <FieldCompositesSection />
        <NavigationSection />
        <MenuSection />
        <DialogsSection />
        <SheetsSection />
        <FeedbackSection />
        <DisplaySection />
        <ContentSection />
        <LayoutSection />
      </VStack>
      <SnackbarHost />
    </Box>
  );
}
