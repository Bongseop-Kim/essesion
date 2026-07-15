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
  SnackbarHost,
  Text,
  VStack,
} from "@essesion/shared";
import {
  Bars3Icon,
  ShoppingBagIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { type ReactNode, useEffect, useRef } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router";

import { AuthGuardProvider, LogoutButton } from "@/features/auth";
import { useSession } from "@/shared/store/session";

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

function StoreFooterLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <FooterLink
      href={href}
      renderLink={({ href: to, ...props }) => (
        <Link to={to ?? "#"} {...props} />
      )}
    >
      {children}
    </FooterLink>
  );
}

function StoreHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const authed = useSession((s) => s.status) === "authenticated";
  const renderLink: HeaderProps["renderLink"] = (item, props) => (
    <Link key={item.key ?? item.href} to={item.href} {...props} />
  );

  return (
    <Header
      brandLabel="ESSE SION"
      brandHref="/"
      brandLogoSrc="/logo/logo.png"
      navItems={STORE_NAV_ITEMS.filter((item) => item.href !== "/")}
      activePathname={location.pathname}
      renderLink={renderLink}
      density="medium"
      menuIcon={<Icon svg={<Bars3Icon />} size={20} />}
      actions={
        <HStack gap="x1_5">
          <ActionButton
            type="button"
            variant="ghost"
            size="small"
            onClick={() => navigate("/cart")}
          >
            장바구니
          </ActionButton>
          {authed ? (
            <>
              <ActionButton
                type="button"
                variant="ghost"
                size="small"
                onClick={() => navigate("/my-page")}
              >
                마이
              </ActionButton>
              <LogoutButton variant="neutralOutline" size="small" />
            </>
          ) : (
            <ActionButton
              type="button"
              variant="neutralOutline"
              size="small"
              onClick={() => navigate("/login")}
            >
              로그인
            </ActionButton>
          )}
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
            aria-label={authed ? "마이페이지" : "로그인"}
            onClick={() => navigate(authed ? "/my-page" : "/login")}
          >
            <Icon svg={<UserIcon />} size={20} />
          </ActionButton>
        </>
      }
      mobileMenuFooter={(closeMenu) => (
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="large"
          onClick={() => {
            closeMenu();
            navigate(authed ? "/my-page" : "/login");
          }}
        >
          {authed ? "마이페이지" : "로그인"}
        </ActionButton>
      )}
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
              <StoreFooterLink key={item.href} href={item.href}>
                {item.label}
              </StoreFooterLink>
            ))}
          </FooterSection>
          <FooterSection title="고객지원">
            {SUPPORT_LINKS.map((item) => (
              <StoreFooterLink key={item.href} href={item.href}>
                {item.label}
              </StoreFooterLink>
            ))}
          </FooterSection>
          <FooterSection title="정책">
            {POLICY_LINKS.map((item) => (
              <StoreFooterLink key={item.href} href={item.href}>
                {item.label}
              </StoreFooterLink>
            ))}
          </FooterSection>
        </Grid>

        <VStack gap="x4">
          <Divider />
          <VStack gap="x1">
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              회사명: 영선산업 | 상호명: ESSE SION | 대표: 김영선
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              주소: 대전광역시 동구 우암로246번길 9-16 (가양동) 영선산업
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              통신판매업 번호: 2017-대전동구-0353 | 전화번호: 042-626-9055
            </Text>
            <Text as="p" textStyle="caption" color="fg.neutral-muted">
              이메일: biblecookie@naver.com
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

/** 앱 셸: Header · 페이지(Outlet) · Footer + 스낵바 호스트(루트 1회 마운트). */
export function AppLayout() {
  const location = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const isPaymentResult = location.pathname.startsWith("/order/payment/");
  const isLogin = location.pathname === "/login";
  const isImmersive =
    location.pathname === "/design" || location.pathname === "/design/";
  const isFocusedRoute = isPaymentResult || isLogin || isImmersive;

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const target =
        mainRef.current?.querySelector<HTMLElement>("h1") ?? mainRef.current;
      target?.setAttribute("tabindex", "-1");
      target?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [location.key]);

  return (
    <AuthGuardProvider>
      <Layout
        height={isImmersive ? "100dvh" : undefined}
        overflow={isImmersive ? "hidden" : undefined}
      >
        <Box
          as="a"
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-x2 focus:top-x2 focus:z-50 focus:rounded-r2 focus:bg-bg-layer-default focus:px-x3 focus:py-x2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stroke-focus-ring"
        >
          <Text as="span" textStyle="labelSm">
            본문으로 건너뛰기
          </Text>
        </Box>
        {isPaymentResult ? (
          <Box display={{ base: "none", md: "block" }}>
            <StoreHeader />
          </Box>
        ) : (
          <StoreHeader />
        )}
        {/* 항상 flex column — LayoutContent(flexGrow)가 남는 높이를 채워
            ContentLayout의 sticky 액션 바가 짧은 페이지에서도 바닥에 정착한다 */}
        <Box
          as="main"
          id="main-content"
          ref={mainRef}
          tabIndex={-1}
          flexGrow={1}
          minHeight={isImmersive ? 0 : undefined}
          overflow={isImmersive ? "hidden" : undefined}
          display="flex"
          flexDirection="column"
          className="focus:outline-none"
        >
          <Outlet />
        </Box>
        {isFocusedRoute ? null : <StoreFooter />}
        <SnackbarHost />
      </Layout>
    </AuthGuardProvider>
  );
}
