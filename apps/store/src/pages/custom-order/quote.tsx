import type { MeResponse, ShippingAddressOut } from "@essesion/api-client";
import {
  createQuoteMutation,
  listAddressesOptions,
  listMyQuotesQueryKey,
} from "@essesion/api-client/query";
import {
  ActionButton,
  Box,
  Callout,
  ContentPlaceholder,
  Divider,
  Grid,
  SegmentedControl,
  SegmentedControlItem,
  Skeleton,
  snackbar,
  Text,
  TextField,
  VStack,
} from "@essesion/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router";

import {
  clearCustomOrderFormDraft,
  parseCustomQuoteDraft,
} from "@/features/custom-order/model/draft";
import {
  type CustomQuoteDraft,
  customOrderApiOptions,
  customOrderSummary,
  invalidQuoteContact,
  type QuoteContact,
  type QuoteContactError,
} from "@/features/custom-order/model/options";
import { AddressSelectModal } from "@/features/shipping/ui/address-select-modal";
import { ShippingAddressCard } from "@/features/shipping/ui/shipping-address-card";
import { krw } from "@/pages/shop/constants";
import { trackEvent } from "@/shared/lib/analytics";
import { hasStateKey } from "@/shared/lib/guards";
import { useSession } from "@/shared/store/session";
import { ContentLayout } from "@/shared/ui/content-layout";
import { SummaryCard } from "@/shared/ui/summary-card";

/**
 * 견적 요청 — 주문서의 "견적하기"가 사양·참고 이미지·예상 금액을 들고 넘어온다.
 * 구매하기 → 결제 페이지(custom-payment)와 같은 구조다. 새로고침·직접 진입이면 주문서로 돌려보낸다
 * (사양은 주문서의 임시 저장에서 복원된다).
 */
export function CustomQuotePage() {
  const location = useLocation();
  const draft = hasStateKey(location.state, "customQuote")
    ? parseCustomQuoteDraft(location.state.customQuote)
    : null;
  const user = useSession((state) =>
    state.status === "authenticated" ? state.user : null,
  );

  if (!draft) return <Navigate to="/custom-order" replace />;
  // ProtectedRoute 아래라 user는 항상 있다 — 타입만 좁힌다.
  if (!user) return null;
  return <CustomQuoteForm draft={draft} user={user} />;
}

// 회원 정보에 있으면 미리 채우고 없으면 빈칸 — 전화번호가 있으면 전화, 없으면 이메일.
function profileContact(user: MeResponse): QuoteContact {
  return {
    contactName: user.name ?? "",
    businessName: "",
    contactMethod: user.phone ? "phone" : "email",
    contactValue: user.phone || user.email || "",
  };
}

function CustomQuoteForm({
  draft,
  user,
}: {
  draft: CustomQuoteDraft;
  user: MeResponse;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [contact, setContact] = useState(() => profileContact(user));
  const [contactError, setContactError] = useState<QuoteContactError | null>(
    null,
  );
  const [address, setAddress] = useState<ShippingAddressOut | null>(null);
  const [addressModalOpen, setAddressModalOpen] = useState(false);
  const contactNameRef = useRef<HTMLInputElement>(null);
  const contactValueRef = useRef<HTMLInputElement>(null);
  const addressRef = useRef<HTMLDivElement>(null);
  const addressesQuery = useQuery(listAddressesOptions());
  const createQuote = useMutation(createQuoteMutation());

  useEffect(() => {
    if (!address && addressesQuery.data?.[0])
      setAddress(addressesQuery.data[0]);
  }, [address, addressesQuery.data]);

  const updateContact = <K extends keyof QuoteContact>(
    key: K,
    value: QuoteContact[K],
  ) => {
    setContactError(null);
    setContact((current) => ({ ...current, [key]: value }));
  };

  const submit = async () => {
    if (createQuote.isPending) return;
    const invalid = invalidQuoteContact(contact);
    if (invalid) {
      // 문구는 해당 칸에 붙고 포커스도 옮긴다 — 사라지는 알림으로 중복하지 않는다.
      setContactError(invalid);
      (invalid.field === "contactName"
        ? contactNameRef
        : contactValueRef
      ).current?.focus();
      return;
    }
    if (!address) {
      // 배송지 카드가 "등록해 주세요"를 상주로 말하고 있다 — 그 자리로 데려간다.
      addressRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
      return;
    }
    try {
      await createQuote.mutateAsync({
        body: {
          shipping_address_id: address.id,
          // 초안에는 화면 값이 들어 있다 — 서버용 정리는 결제 페이지와 같은 함수가 한다.
          options: customOrderApiOptions(draft.options),
          quantity: draft.options.quantity,
          contact_name: contact.contactName.trim(),
          business_name: contact.businessName.trim(),
          contact_method: contact.contactMethod,
          contact_value: contact.contactValue.trim(),
          additional_notes: draft.options.additionalNotes.trim(),
          reference_images: draft.imageRefs,
        },
      });
      // contact_* 등 연락처 정보는 절대 넣지 않는다
      trackEvent("quote_request", { quantity: draft.options.quantity });
      await queryClient.invalidateQueries({
        queryKey: listMyQuotesQueryKey(),
        refetchType: "all",
      });
      snackbar("견적 요청이 접수되었습니다.");
      clearCustomOrderFormDraft(user.id);
      navigate("/my-page/quote-request");
    } catch (error) {
      snackbar(
        error instanceof Error
          ? error.message
          : "견적 요청을 접수하지 못했습니다.",
      );
    }
  };

  const notes = draft.options.additionalNotes.trim();

  return (
    <>
      <title>견적 요청 | 영선산업</title>
      <meta name="robots" content="noindex" />
      <ContentLayout
        breadcrumbs={[
          { label: "홈", href: "/" },
          { label: "주문 제작", href: "/custom-order" },
          { label: "견적 요청" },
        ]}
        sidebar={
          <SummaryCard.Root>
            <SummaryCard.Section
              title="견적 요약"
              description="주문서에서 고른 사양입니다. 고치려면 주문 제작으로 돌아가 주세요."
            />
            <Divider />
            {customOrderSummary(draft.options).map((row) => (
              <SummaryCard.Row
                key={row.label}
                label={row.label}
                value={row.value}
              />
            ))}
            {notes ? <SummaryCard.Row label="추가 요청" value={notes} /> : null}
            <SummaryCard.Row
              label="참고 이미지"
              value={`${draft.imageRefs.length}개`}
            />
            <SummaryCard.Total
              label="예상 견적"
              value={`${krw.format(draft.totalCost)}원`}
            />
            <Callout
              title="견적 요청 안내"
              description="담당자가 사양을 확인한 뒤 최종 견적을 안내합니다. 계좌이체·세금계산서로 결제할 수 있어요."
            />
          </SummaryCard.Root>
        }
        actionBar={
          <Box
            as={ActionButton}
            type="button"
            size="large"
            width="full"
            loading={createQuote.isPending}
            onClick={() => void submit()}
          >
            견적 요청하기
          </Box>
        }
      >
        <VStack gap="x6" alignItems="stretch">
          <VStack gap="x2">
            <Text as="h1" textStyle="title1">
              견적 요청
            </Text>
            <Text textStyle="body" color="fg.neutral-muted">
              연락처와 배송지를 확인해 주세요.
            </Text>
          </VStack>

          <VStack gap="x2" alignItems="stretch">
            <Text as="h2" textStyle="title3">
              연락처
            </Text>
            <Grid columns={{ base: 1, md: 2 }} gap="x4">
              <TextField
                ref={contactNameRef}
                label="담당자 성함"
                required
                value={contact.contactName}
                errorMessage={
                  contactError?.field === "contactName"
                    ? contactError.message
                    : undefined
                }
                onChange={(event) =>
                  updateContact("contactName", event.currentTarget.value)
                }
              />
              <TextField
                label="상호명"
                value={contact.businessName}
                onChange={(event) =>
                  updateContact("businessName", event.currentTarget.value)
                }
              />
              <VStack gap="x2" alignItems="stretch">
                <Text textStyle="labelSm">연락 방법</Text>
                <SegmentedControl
                  value={contact.contactMethod}
                  onValueChange={(value) =>
                    updateContact(
                      "contactMethod",
                      value as QuoteContact["contactMethod"],
                    )
                  }
                  aria-label="연락 방법"
                >
                  <SegmentedControlItem value="phone">
                    전화
                  </SegmentedControlItem>
                  <SegmentedControlItem value="email">
                    이메일
                  </SegmentedControlItem>
                </SegmentedControl>
              </VStack>
              <TextField
                ref={contactValueRef}
                label={
                  contact.contactMethod === "email" ? "이메일 주소" : "연락처"
                }
                required
                value={contact.contactValue}
                errorMessage={
                  contactError?.field === "contactValue"
                    ? contactError.message
                    : undefined
                }
                onChange={(event) =>
                  updateContact("contactValue", event.currentTarget.value)
                }
              />
            </Grid>
          </VStack>

          {addressesQuery.isPending ? (
            <Skeleton width="100%" height={120} />
          ) : addressesQuery.isError ? (
            <ContentPlaceholder
              title="배송지를 불러오지 못했습니다"
              description="잠시 후 다시 시도해 주세요."
            />
          ) : (
            <Box ref={addressRef}>
              <ShippingAddressCard
                address={address}
                onChange={() => setAddressModalOpen(true)}
              />
            </Box>
          )}
        </VStack>

        <AddressSelectModal
          open={addressModalOpen}
          selected={address}
          onOpenChange={setAddressModalOpen}
          onSelect={setAddress}
        />
      </ContentLayout>
    </>
  );
}
