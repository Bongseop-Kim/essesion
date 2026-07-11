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

export function PrivacyPolicyContent() {
  return (
    <PolicyDocument>
      <PolicySection title="1. 개인정보의 처리 목적">
        <Text as="p" {...bodyProps}>
          영선산업(상호명 ESSE SION, 이하 “회사”)은 다음 목적에 필요한 범위에서
          개인정보를 처리합니다. 목적이 변경되면 관련 법령에 따라 별도 동의 등
          필요한 절차를 거칩니다.
        </Text>
        <PolicyList
          items={[
            "소셜 계정 로그인, 본인 식별, 계정과 세션 관리 및 부정 이용 방지",
            "상품·수선·샘플·맞춤 제작 주문, 결제, 배송, 취소·교환·반품 처리",
            "휴대폰 인증, 주문 상태 알림, 문의·견적·고객 불만 처리",
            "AI 디자인 생성, 토큰 과금·복원, 생성 결과 보관 및 서비스 품질 개선",
            "접속 기록 분석, 장애 대응과 서비스 보안 유지",
          ]}
        />
      </PolicySection>

      <PolicySection title="2. 처리하는 개인정보 항목">
        <PolicyList
          items={[
            "로그인 정보: 소셜 로그인 제공자, 제공자 계정 식별자, 이름 또는 닉네임, 이메일",
            "회원 정보: 이름, 이메일, 휴대폰 번호, 생년월일, 휴대폰 인증 여부, 알림·마케팅 수신 설정",
            "주문·배송 정보: 받는 사람, 연락처, 우편번호, 주소, 배송 요청사항, 주문·클레임·문의 내용",
            "결제 정보: 주문번호, 결제 금액, 결제 상태와 결제 거래 식별자. 카드번호 등 결제수단 원문은 회사가 직접 저장하지 않습니다.",
            "제작·디자인 정보: 업로드 이미지, 주문 사양, 프롬프트, 생성 결과와 사용 토큰 내역",
            "자동 생성 정보: IP 주소, 브라우저·기기 정보, 쿠키, 접속 시각, 서비스 이용·오류 기록",
          ]}
        />
      </PolicySection>

      <PolicySection title="3. 개인정보의 처리 및 보유기간">
        <Text as="p" {...bodyProps}>
          회사는 처리 목적이 달성되면 개인정보를 지체 없이 파기합니다. 다만 관계
          법령에서 보존을 요구하는 경우에는 해당 기간 동안 분리하여 보관합니다.
        </Text>
        <PolicyList
          items={[
            "계정 정보: 회원 탈퇴 또는 계정 삭제 시까지. 분쟁·수사가 진행 중이면 종료 시까지",
            "계약 또는 청약철회 등에 관한 기록: 5년",
            "대금결제 및 재화 등의 공급에 관한 기록: 5년",
            "소비자 불만 또는 분쟁처리에 관한 기록: 3년",
            "휴대폰 인증번호와 임시 업로드: 인증·업로드 목적 달성 또는 정해진 만료 시점까지",
          ]}
        />
      </PolicySection>

      <PolicySection title="4. 개인정보의 제3자 제공">
        <Text as="p" {...bodyProps}>
          회사는 정보주체의 동의가 있거나 법률에 특별한 규정이 있는 경우를
          제외하고 개인정보를 제3자에게 제공하지 않습니다. 상품 배송을 위해
          배송업체에 받는 사람의 이름, 연락처, 주소와 배송 요청사항을 제공할 수
          있으며, 제공 목적 달성 후 관련 법령에 따른 기간을 제외하고 파기합니다.
        </Text>
      </PolicySection>

      <PolicySection title="5. 개인정보 처리업무의 위탁 및 국외 처리">
        <Text as="p" {...bodyProps}>
          회사는 서비스 운영에 필요한 업무를 아래 사업자에게 맡길 수 있으며,
          계약과 점검을 통해 개인정보가 안전하게 처리되도록 관리합니다.
        </Text>
        <PolicyList
          items={[
            "Google Cloud: API·데이터베이스·파일 저장소 운영",
            "Cloudflare: 웹 서비스 제공, 보안 프록시와 접속 기록 처리",
            "토스페이먼츠: 결제 승인·취소 및 결제 관련 고객 지원",
            "Solapi: 휴대폰 인증과 서비스 알림 메시지 발송",
            "Google·Kakao: 소셜 로그인 인증",
            "Google Gemini·OpenAI·Recraft: AI 디자인 기능에서 입력한 프롬프트·참조 이미지 처리",
          ]}
        />
        <PolicyInfoBox>
          <Text textStyle="labelSm">공개 전 운영 확인 항목</Text>
          <Text {...bodyProps}>
            각 수탁자 법인명, 처리 국가, 이전 일시·방법, 보유기간과 연락처는
            실제 계약 및 배포 리전에 맞춰 확정해야 합니다.
          </Text>
        </PolicyInfoBox>
      </PolicySection>

      <PolicySection title="6. 정보주체의 권리와 행사 방법">
        <Text as="p" {...bodyProps}>
          정보주체는 개인정보의 열람, 정정·삭제, 처리정지 및 동의 철회를 요청할
          수 있습니다. 계정 정보와 알림 설정은 마이페이지에서 변경할 수 있고, 그
          밖의 요청은 개인정보 고충처리 연락처로 접수할 수 있습니다. 회사는 본인
          확인 후 관련 법령이 정한 절차와 기간에 따라 처리합니다.
        </Text>
      </PolicySection>

      <PolicySection title="7. 개인정보의 파기 및 안전성 확보조치">
        <Text as="p" {...bodyProps}>
          전자적 파일은 복구하기 어려운 방법으로 삭제하고, 출력물은 분쇄하거나
          소각합니다. 회사는 접근권한 최소화, 인증정보 암호화, 전송구간 보호,
          접속기록 보관과 점검, 백업 및 사고 대응 절차 등 필요한 보호조치를
          적용합니다.
        </Text>
      </PolicySection>

      <PolicySection title="8. 개인정보 보호책임자 및 고충처리">
        <Text as="p" {...bodyProps}>
          개인정보 처리와 관련한 문의, 불만 처리와 피해구제 요청은 아래 담당
          창구로 접수할 수 있습니다.
        </Text>
        <PolicyInfoBox>
          <Text textStyle="labelSm">개인정보 보호책임자</Text>
          <Text {...bodyProps}>이름·직책: [운영 확정 필요]</Text>
          <Text {...bodyProps}>이메일: biblecookie@naver.com</Text>
          <Text {...bodyProps}>전화번호: 042-626-9055</Text>
        </PolicyInfoBox>
      </PolicySection>

      <PolicySection title="9. 개인정보처리방침의 변경">
        <Text as="p" {...bodyProps}>
          이 방침의 내용이 변경되면 시행일과 주요 변경사항을 공지사항을 통해
          안내합니다.
        </Text>
        <PolicyInfoBox>
          <Text textStyle="labelSm">시행일: [운영 확정 필요]</Text>
        </PolicyInfoBox>
      </PolicySection>
    </PolicyDocument>
  );
}

export function PrivacyPolicyPage() {
  return (
    <>
      <title>개인정보처리방침 | ESSE SION</title>
      <meta
        name="description"
        content="ESSE SION의 개인정보 처리 목적, 항목, 보유기간과 정보주체의 권리를 안내합니다."
      />
      <ContentLayout
        breadcrumbs={[
          { label: "홈", href: "/" },
          { label: "개인정보처리방침" },
        ]}
      >
        <VStack gap="x8" alignItems="stretch">
          <VStack gap="x2" alignItems="stretch">
            <Text as="h1" textStyle="title1">
              개인정보처리방침
            </Text>
            <Text as="p" textStyle="body" color="fg.neutral-muted">
              개인정보의 수집·이용과 보호 기준을 안내합니다.
            </Text>
          </VStack>
          <PrivacyPolicyContent />
        </VStack>
      </ContentLayout>
    </>
  );
}
