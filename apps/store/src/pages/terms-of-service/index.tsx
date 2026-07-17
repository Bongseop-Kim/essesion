import { Text, VStack } from "@essesion/shared";

import { ContentLayout } from "@/shared/ui/content-layout";
import {
  policyBodyProps as bodyProps,
  PolicyDocument,
  PolicyInfoBox,
  PolicyList,
  PolicySection,
} from "@/shared/ui/policy-blocks";

export function TermsOfServiceContent() {
  return (
    <PolicyDocument>
      <PolicySection title="1. 목적">
        <Text as="p" {...bodyProps}>
          이 약관은 영선산업(상호명 ESSE SION, 이하 “회사”)이 제공하는 온라인
          쇼핑, 수선, 맞춤·샘플 제작과 AI 디자인 서비스의 이용 조건 및 회사와
          이용자의 권리·의무를 정합니다.
        </Text>
      </PolicySection>

      <PolicySection title="2. 용어의 정의">
        <PolicyList
          items={[
            "‘서비스’는 회사가 웹사이트와 관련 시스템을 통해 제공하는 상품 판매 및 제반 기능을 말합니다.",
            "‘회원’은 소셜 로그인 또는 회사가 발급한 계정으로 인증하여 서비스를 이용하는 사람을 말합니다.",
            "‘주문 제작’은 이용자가 선택하거나 제출한 사양에 따라 개별 생산하는 맞춤·샘플 제작을 말합니다.",
            "‘디자인 토큰’은 AI 디자인 기능 사용 시 차감되는 유료 또는 무료 크레딧을 말합니다.",
          ]}
        />
      </PolicySection>

      <PolicySection title="3. 약관의 효력과 변경">
        <Text as="p" {...bodyProps}>
          이 약관은 서비스 화면에 게시하거나 이용자에게 알린 때부터 효력이
          발생합니다. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수
          있으며, 적용일과 변경 사유를 사전에 공지합니다. 이용자에게 불리한
          중요한 변경은 법령이 정한 기간과 방법에 따라 알립니다.
        </Text>
      </PolicySection>

      <PolicySection title="4. 계정과 로그인">
        <Text as="p" {...bodyProps}>
          고객용 공개 아이디·비밀번호 회원가입은 제공하지 않습니다. 회원은
          회사가 지원하는 소셜 로그인을 사용하며, 테스트·운영 점검용 계정은
          회사가 별도로 생성합니다. 이용자는 자신의 인증수단을 안전하게 관리해야
          하며 타인의 계정을 사용할 수 없습니다.
        </Text>
      </PolicySection>

      <PolicySection title="5. 서비스의 내용">
        <PolicyList
          items={[
            "일반 상품의 정보 제공, 주문, 결제와 배송",
            "넥타이 수선과 수거·발송 관리",
            "맞춤 제작 및 샘플 제작의 사양 선택, 견적과 주문",
            "AI 기반 디자인 생성과 결과물 관리",
            "디자인 토큰 구매·사용·잔액 및 환불 신청 관리",
            "그 밖에 회사가 공지하고 제공하는 고객지원 기능",
          ]}
        />
      </PolicySection>

      <PolicySection title="6. 주문과 계약의 성립">
        <Text as="p" {...bodyProps}>
          이용자는 상품, 수량, 제작 사양, 배송지, 가격과 환불 조건을 확인한 후
          주문을 제출합니다. 회사의 결제 승인 및 주문 접수 안내가 완료되면
          구매계약이 성립합니다. 품절, 제작 불가 또는 명백한 가격 오류가 있으면
          회사는 지체 없이 알리고 받은 대금을 관련 법령에 따라 환급합니다.
        </Text>
      </PolicySection>

      <PolicySection title="7. 결제">
        <Text as="p" {...bodyProps}>
          결제는 결제 화면에서 토스페이먼츠가 제공하는 수단으로 진행합니다.
          이용자는 결제 정보를 정확하게 입력해야 하며, 회사는 중복 승인 방지와
          결제 상태 확인을 위해 주문·결제 거래 식별자를 처리할 수 있습니다.
        </Text>
      </PolicySection>

      <PolicySection title="8. 배송과 수령">
        <Text as="p" {...bodyProps}>
          배송비와 예상 일정은 주문 화면에 표시합니다. 이용자가 잘못 입력한
          주소나 연락처, 택배사 사정, 천재지변 등으로 배송이 지연될 수 있습니다.
          배송이 시작된 뒤에는 주소 변경이 제한될 수 있으므로 주문 정보를 미리
          확인해야 합니다.
        </Text>
      </PolicySection>

      <PolicySection title="9. 수선·맞춤·샘플 제작">
        <Text as="p" {...bodyProps}>
          수선과 주문 제작은 이용자가 제출한 사진, 치수, 원단, 수량과 사양을
          기준으로 진행합니다. 실물 확인 결과 작업이 불가능하거나 추가 협의가
          필요할 수 있으며, 이 경우 회사는 진행 여부와 비용을 안내합니다. 개별
          제작이 시작된 이후의 취소·환불 제한은 환불정책과 관련 법령을 따릅니다.
        </Text>
      </PolicySection>

      <PolicySection title="10. AI 디자인과 디자인 토큰">
        <PolicyList
          items={[
            "AI 생성 결과는 입력, 외부 모델과 시스템 상태에 따라 달라질 수 있으며 특정 결과를 보장하지 않습니다.",
            "생성 요청이 실패하면 해당 요청에 차감된 토큰은 시스템 정책에 따라 복원됩니다.",
            "유료 토큰과 무료 토큰의 잔액·사용 순서·유효기간은 구매 화면과 환불정책에 표시합니다.",
            "이용자는 타인의 개인정보, 저작권, 상표권 등 권리를 침해하는 자료를 입력해서는 안 됩니다.",
          ]}
        />
      </PolicySection>

      <PolicySection title="11. 서비스의 변경과 중단">
        <Text as="p" {...bodyProps}>
          회사는 점검, 설비 장애, 외부 서비스 중단 또는 운영상 필요한 경우
          서비스의 전부나 일부를 변경·중단할 수 있습니다. 예측 가능한 중단은
          사전에 알리고, 긴급한 경우에는 사후에 알릴 수 있습니다.
        </Text>
      </PolicySection>

      <PolicySection title="12. 이용자의 의무">
        <PolicyList
          items={[
            "허위 정보 등록, 타인 정보나 결제수단의 도용을 하지 않을 것",
            "서비스 또는 시스템의 정상 운영을 방해하지 않을 것",
            "회사나 제3자의 지식재산권, 개인정보와 명예를 침해하지 않을 것",
            "불법·유해 콘텐츠를 업로드하거나 생성하도록 요청하지 않을 것",
            "관련 법령, 이 약관과 서비스 화면의 안내를 준수할 것",
          ]}
        />
      </PolicySection>

      <PolicySection title="13. 계약 해지와 이용 제한">
        <Text as="p" {...bodyProps}>
          회원은 마이페이지에서 탈퇴를 요청할 수 있습니다. 회사는 약관 위반,
          부정 결제, 서비스 방해 등 합리적인 사유가 있으면 사전 통지 후 이용을
          제한하거나 계약을 해지할 수 있습니다. 긴급한 보안 위험이 있는 경우
          먼저 제한하고 사후에 알릴 수 있습니다.
        </Text>
      </PolicySection>

      <PolicySection title="14. 책임과 분쟁 해결">
        <Text as="p" {...bodyProps}>
          회사와 이용자는 분쟁이 발생하면 성실히 협의합니다. 회사는 고의 또는
          과실로 이용자에게 손해를 발생시킨 경우 관련 법령에 따라 책임을
          부담합니다. 이 약관에 정하지 않은 사항은 대한민국 법령과 상관례를
          따르며, 관할은 관련 절차법이 정하는 법원에 따릅니다.
        </Text>
      </PolicySection>

      <PolicySection title="15. 시행일">
        <PolicyInfoBox>
          <Text textStyle="labelSm">시행일: 2026년 7월 17일</Text>
        </PolicyInfoBox>
      </PolicySection>
    </PolicyDocument>
  );
}

export function TermsOfServicePage() {
  return (
    <>
      <title>이용약관 | ESSE SION</title>
      <meta
        name="description"
        content="ESSE SION의 상품, 수선, 맞춤 제작, AI 디자인 서비스 이용 조건을 안내합니다."
      />
      <ContentLayout
        breadcrumbs={[{ label: "홈", href: "/" }, { label: "이용약관" }]}
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2" alignItems="stretch">
            <Text as="h1" textStyle="title1">
              이용약관
            </Text>
            <Text as="p" textStyle="body" color="fg.neutral-muted">
              ESSE SION 서비스 이용에 필요한 기본 조건을 안내합니다.
            </Text>
          </VStack>
          <TermsOfServiceContent />
        </VStack>
      </ContentLayout>
    </>
  );
}
