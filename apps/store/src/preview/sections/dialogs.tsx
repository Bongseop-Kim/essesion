import {
  ActionButton,
  AlertDialog,
  HStack,
  Modal,
  ResponsiveModal,
  SidePanel,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useState } from "react";

import { Section, SubSection } from "../section";

export function DialogsSection() {
  const [basicOpen, setBasicOpen] = useState(false);
  const [destructiveOpen, setDestructiveOpen] = useState(false);
  const [columnOpen, setColumnOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [leftOpen, setLeftOpen] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [responsiveOpen, setResponsiveOpen] = useState(false);

  return (
    <Section title="다이얼로그">
      <SubSection title="Modal · ResponsiveModal">
        <HStack gap="x3" wrap>
          <ActionButton
            variant="neutralWeak"
            onClick={() => setModalOpen(true)}
          >
            중앙 모달
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            onClick={() => setResponsiveOpen(true)}
          >
            반응형 (모바일=시트 / PC=모달)
          </ActionButton>
        </HStack>

        <Modal
          open={modalOpen}
          onOpenChange={setModalOpen}
          title="배송지 변경"
          description="새 배송지를 입력하세요"
          footer={
            <ActionButton
              className="w-full"
              onClick={() => setModalOpen(false)}
            >
              저장
            </ActionButton>
          }
        >
          <VStack gap="x4">
            <TextField label="받는 분" placeholder="홍길동" />
            <TextField label="주소" placeholder="도로명 주소" />
          </VStack>
        </Modal>

        <ResponsiveModal
          open={responsiveOpen}
          onOpenChange={setResponsiveOpen}
          title="필터"
          description="창 폭을 바꿔 시트↔모달 전환을 확인"
          footer={
            <ActionButton
              className="w-full"
              onClick={() => setResponsiveOpen(false)}
            >
              적용
            </ActionButton>
          }
        >
          <VStack gap="x3">
            {Array.from({ length: 6 }, (_, i) => (
              <Text key={i}>필터 옵션 {i + 1}</Text>
            ))}
          </VStack>
        </ResponsiveModal>
      </SubSection>

      <SubSection title="AlertDialog">
        <HStack gap="x3" wrap>
          <ActionButton
            variant="neutralWeak"
            onClick={() => setBasicOpen(true)}
          >
            기본 알림
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            onClick={() => setDestructiveOpen(true)}
          >
            파괴적 확인
          </ActionButton>
          <ActionButton
            variant="neutralWeak"
            onClick={() => setColumnOpen(true)}
          >
            세로 액션
          </ActionButton>
        </HStack>

        <AlertDialog
          open={basicOpen}
          onOpenChange={setBasicOpen}
          title="변경 사항을 저장할까요?"
          description="저장하지 않은 변경 사항은 사라집니다."
          primaryActionProps={{ children: "저장" }}
          secondaryActionProps={{ children: "취소" }}
        />

        <AlertDialog
          open={destructiveOpen}
          onOpenChange={setDestructiveOpen}
          title="상품을 삭제할까요?"
          description={
            "이 작업은 되돌릴 수 없습니다.\n삭제된 상품은 복구할 수 없습니다."
          }
          primaryActionProps={{ children: "삭제", variant: "criticalSolid" }}
          secondaryActionProps={{ children: "취소" }}
        />

        <AlertDialog
          open={columnOpen}
          onOpenChange={setColumnOpen}
          actionLayout="column"
          title="알림 수신에 동의하시겠어요?"
          description="언제든지 설정에서 변경할 수 있습니다."
          primaryActionProps={{ children: "동의하고 계속" }}
          secondaryActionProps={{ children: "나중에", variant: "ghost" }}
        />
      </SubSection>

      <SubSection title="SidePanel">
        <HStack gap="x3" wrap>
          <ActionButton
            variant="neutralWeak"
            onClick={() => setRightOpen(true)}
          >
            오른쪽 패널 (small)
          </ActionButton>
          <ActionButton variant="neutralWeak" onClick={() => setLeftOpen(true)}>
            왼쪽 패널 (medium)
          </ActionButton>
        </HStack>

        <SidePanel
          open={rightOpen}
          onOpenChange={setRightOpen}
          title="필터"
          description="조건을 선택해 상품을 좁혀 보세요."
          footer={
            <HStack gap="x2" justify="end">
              <ActionButton
                variant="neutralWeak"
                onClick={() => setRightOpen(false)}
              >
                초기화
              </ActionButton>
              <ActionButton onClick={() => setRightOpen(false)}>
                적용
              </ActionButton>
            </HStack>
          }
        >
          <VStack gap="x4">
            {Array.from({ length: 24 }, (_, i) => (
              <Text key={i} color="fg.neutral-muted">
                스크롤 확인용 항목 {i + 1}
              </Text>
            ))}
          </VStack>
        </SidePanel>

        <SidePanel
          open={leftOpen}
          onOpenChange={setLeftOpen}
          side="left"
          size="medium"
          title="메뉴"
        >
          <VStack gap="x3">
            <Text>홈</Text>
            <Text>신상품</Text>
            <Text>베스트</Text>
            <Text>세일</Text>
          </VStack>
        </SidePanel>
      </SubSection>
    </Section>
  );
}
