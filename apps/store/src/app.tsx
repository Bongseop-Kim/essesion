import {
  ActionButton,
  Box,
  Divider,
  Footer,
  FooterLink,
  FooterSection,
  Grid,
  Header,
  type HeaderProps,
  HStack,
  Icon,
  Layout,
  Text,
  VStack,
} from "@essesion/shared";
import {
  Bars3Icon,
  ShoppingBagIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router";

import { Preview } from "./preview";

const STORE_NAV_ITEMS = [
  { href: "/", label: "홈" },
  { href: "/shop", label: "스토어" },
  { href: "/reform", label: "수선" },
  { href: "/design", label: "디자인" },
  { href: "/custom-order", label: "주문 제작" },
  { href: "/sample-order", label: "샘플 제작" },
] as const;

const SUPPORT_LINKS = [
  { href: "/faq", label: "자주 묻는 질문" },
  { href: "/my-page/inquiry", label: "문의하기" },
  { href: "/notice", label: "공지사항" },
] as const;

const POLICY_LINKS = [
  { href: "/privacy-policy", label: "개인정보처리방침" },
  { href: "/terms-of-service", label: "이용약관" },
  { href: "/refund-policy", label: "환불정책" },
] as const;

function StoreHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const renderLink: HeaderProps["renderLink"] = (item, props) => (
    <Link key={item.key ?? item.href} to={item.href} {...props} />
  );

  return (
    <Header
      brandLabel="ESSE SION"
      brandHref="/"
      brandLogoSrc="/logo/logo.png"
      navItems={[...STORE_NAV_ITEMS]}
      activePathname={location.pathname}
      renderLink={renderLink}
      menuIcon={<Icon svg={<Bars3Icon />} size={20} />}
      actions={
        <HStack gap="x1_5">
          <ActionButton
            type="button"
            variant="ghost"
            size="small"
            onClick={() => navigate("/my-page")}
          >
            마이
          </ActionButton>
          <ActionButton
            type="button"
            variant="ghost"
            size="small"
            onClick={() => navigate("/cart")}
          >
            장바구니
          </ActionButton>
          <ActionButton
            type="button"
            variant="neutralOutline"
            size="small"
            onClick={() => navigate("/login")}
          >
            로그인
          </ActionButton>
        </HStack>
      }
      mobileActions={
        <>
          <ActionButton
            type="button"
            variant="ghost"
            size="medium"
            iconOnly
            aria-label="장바구니"
            onClick={() => navigate("/cart")}
          >
            <Icon svg={<ShoppingBagIcon />} size={20} />
          </ActionButton>
          <ActionButton
            type="button"
            variant="ghost"
            size="medium"
            iconOnly
            aria-label="마이페이지"
            onClick={() => navigate("/my-page")}
          >
            <Icon svg={<UserIcon />} size={20} />
          </ActionButton>
        </>
      }
      mobileMenuFooter={
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="large"
          onClick={() => navigate("/login")}
        >
          로그인
        </ActionButton>
      }
    />
  );
}

function StoreFooter() {
  return (
    <Footer>
      <VStack gap="x8">
        <Grid columns={{ base: 2, sm: 3 }} gap="x8">
          <FooterSection title="서비스">
            {STORE_NAV_ITEMS.map((item) => (
              <FooterLink key={item.href} href={item.href}>
                {item.label}
              </FooterLink>
            ))}
          </FooterSection>
          <FooterSection title="고객지원">
            {SUPPORT_LINKS.map((item) => (
              <FooterLink key={item.href} href={item.href}>
                {item.label}
              </FooterLink>
            ))}
          </FooterSection>
          <FooterSection title="정책">
            {POLICY_LINKS.map((item) => (
              <FooterLink key={item.href} href={item.href}>
                {item.label}
              </FooterLink>
            ))}
          </FooterSection>
        </Grid>

        <VStack gap="x4">
          <Divider />
          <VStack gap="x1">
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              영선산업 | 대표: 김영선
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              주소: 대전광역시 동구 우암로246번길 9-16 (가양동) 영선산업
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              통신판매업 번호: 2017-대전동구-0353 | 전화번호: 042-626-9055
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              호스팅사업자: 영선산업 | 사업자등록번호: 305-26-32033
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted" pt="x2">
              © 2026 영선산업. All rights reserved.
            </Text>
          </VStack>
        </VStack>
      </VStack>
    </Footer>
  );
}

function Home() {
  return <Box as="main" flexGrow={1} />;
}

function StoreAppBody() {
  return (
    <Layout>
      <StoreHeader />
      <Routes>
        <Route path="/__preview" element={<Preview />} />
        <Route path="*" element={<Home />} />
      </Routes>
      <StoreFooter />
    </Layout>
  );
}

export function StoreApp() {
  return (
    <BrowserRouter>
      <StoreAppBody />
    </BrowserRouter>
  );
}
