import {
  ActionButton,
  Box,
  Header,
  type HeaderProps,
  Icon,
  Layout,
  LayoutContent,
  Text,
  VStack,
} from "@essesion/shared";
import {
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import { BrowserRouter, Link, useLocation, useNavigate } from "react-router";

const ADMIN_NAV_ITEMS = [
  { key: "dashboard", label: "대시보드", href: "/" },
  { key: "orders", label: "주문 관리", href: "/orders" },
  { key: "products", label: "상품 관리", href: "/products" },
  { key: "coupons", label: "쿠폰 관리", href: "/coupons" },
  { key: "quote-requests", label: "견적 관리", href: "/quote-requests" },
  { key: "claims", label: "클레임 관리", href: "/claims" },
  { key: "customers", label: "고객 관리", href: "/customers" },
  { key: "inquiries", label: "문의 관리", href: "/inquiries" },
  { key: "pricing", label: "가격 관리", href: "/pricing" },
  { key: "generation-logs", label: "AI 생성 로그", href: "/generation-logs" },
  {
    key: "seamless-logs",
    label: "Seamless 생성 로그",
    href: "/seamless-logs",
  },
  { key: "motifs", label: "Motif SVG", href: "/motifs" },
  { key: "settings", label: "설정", href: "/settings" },
] as const;

function AdminHeader() {
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
      navItems={[...ADMIN_NAV_ITEMS]}
      activePathname={location.pathname}
      renderLink={renderLink}
      menuIcon={<Icon svg={<Bars3Icon />} size={20} />}
      actions={
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="small"
          onClick={() => navigate("/login")}
        >
          로그아웃
        </ActionButton>
      }
      mobileActions={
        <ActionButton
          type="button"
          variant="ghost"
          size="medium"
          iconOnly
          aria-label="로그아웃"
          onClick={() => navigate("/login")}
        >
          <Icon svg={<ArrowRightStartOnRectangleIcon />} size={20} />
        </ActionButton>
      }
      mobileMenuFooter={
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="large"
          onClick={() => navigate("/login")}
        >
          로그아웃
        </ActionButton>
      }
    />
  );
}

function AdminAppBody() {
  return (
    <Layout bg="bg.layer-basement">
      <AdminHeader />
      <LayoutContent density="high" py="x8">
        <Box bg="bg.layer-default" borderRadius="r3" boxShadow="s1" p="x6">
          <VStack gap="x2">
            <Text as="h1" textStyle="title1">
              essesion admin
            </Text>
            <Text textStyle="bodySm" color="fg.neutral-muted">
              관리자 화면 재작성 전 임시 본문입니다.
            </Text>
          </VStack>
        </Box>
      </LayoutContent>
    </Layout>
  );
}

export function AdminApp() {
  return (
    <BrowserRouter>
      <AdminAppBody />
    </BrowserRouter>
  );
}
