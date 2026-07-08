import {
  ActionButton,
  BottomSheet,
  HStack,
  SwipeableMenuSheet,
  SwipeableMenuSheetGroup,
  SwipeableMenuSheetItem,
  Text,
  VStack,
} from "@essesion/shared";
import { useState } from "react";

import { Section, SubSection } from "../section";

export function SheetsSection() {
  const [bottomOpen, setBottomOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Section title="시트">
      <SubSection title="BottomSheet">
        <HStack gap="x3" wrap>
          <ActionButton onClick={() => setBottomOpen(true)}>
            바텀시트 열기
          </ActionButton>
        </HStack>
        <BottomSheet
          open={bottomOpen}
          onOpenChange={setBottomOpen}
          title="배송지 선택"
          description="주문에 사용할 배송지를 선택하세요."
          showCloseButton
          footer={
            <ActionButton
              className="w-full"
              onClick={() => setBottomOpen(false)}
            >
              이 주소로 배송
            </ActionButton>
          }
        >
          <VStack gap="x3" align="stretch">
            {Array.from({ length: 12 }, (_, i) => (
              <Text key={i} textStyle="body" color="fg.neutral-muted">
                서울특별시 어딘가 {i + 1}번지 — 스크롤을 확인하기 위한 긴 본문
                항목입니다. 콘텐츠가 길어지면 바디만 스크롤되고 핸들과 푸터는
                고정됩니다.
              </Text>
            ))}
          </VStack>
        </BottomSheet>
      </SubSection>

      <SubSection title="SwipeableMenuSheet">
        <HStack gap="x3" wrap>
          <ActionButton
            variant="neutralOutline"
            onClick={() => setMenuOpen(true)}
          >
            더보기 메뉴 열기
          </ActionButton>
        </HStack>
        <SwipeableMenuSheet
          open={menuOpen}
          onOpenChange={setMenuOpen}
          title="게시물"
          description="이 게시물에 대해 무엇을 하시겠어요?"
        >
          <SwipeableMenuSheetGroup>
            <SwipeableMenuSheetItem onSelect={() => console.log("공유")}>
              공유하기
            </SwipeableMenuSheetItem>
            <SwipeableMenuSheetItem onSelect={() => console.log("링크 복사")}>
              링크 복사
            </SwipeableMenuSheetItem>
            <SwipeableMenuSheetItem onSelect={() => console.log("저장")}>
              저장하기
            </SwipeableMenuSheetItem>
          </SwipeableMenuSheetGroup>
          <SwipeableMenuSheetGroup>
            <SwipeableMenuSheetItem
              labelAlign="center"
              onSelect={() => console.log("숨기기")}
            >
              숨기기
            </SwipeableMenuSheetItem>
            <SwipeableMenuSheetItem
              tone="critical"
              labelAlign="center"
              onSelect={() => console.log("신고")}
            >
              신고하기
            </SwipeableMenuSheetItem>
          </SwipeableMenuSheetGroup>
        </SwipeableMenuSheet>
      </SubSection>
    </Section>
  );
}
