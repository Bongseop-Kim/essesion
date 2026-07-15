export type AdminNavigationItem = {
  key: string;
  label: string;
  href: string;
};

export type AdminNavigationGroup = {
  key: string;
  label: string | null;
  items: readonly AdminNavigationItem[];
};

export const ADMIN_NAVIGATION_GROUPS: readonly AdminNavigationGroup[] = [
  {
    key: "dashboard",
    label: null,
    items: [{ key: "dashboard", label: "대시보드", href: "/" }],
  },
  {
    key: "operations",
    label: "운영",
    items: [
      { key: "orders", label: "주문 관리", href: "/orders" },
      { key: "manual-orders", label: "수기 주문", href: "/manual-orders" },
      {
        key: "quote-requests",
        label: "견적 관리",
        href: "/quote-requests",
      },
      { key: "claims", label: "클레임 관리", href: "/claims" },
      { key: "incidents", label: "결제 이상", href: "/incidents" },
      { key: "inquiries", label: "문의 관리", href: "/inquiries" },
    ],
  },
  {
    key: "customers",
    label: "고객",
    items: [{ key: "customers", label: "고객 관리", href: "/customers" }],
  },
  {
    key: "catalog",
    label: "상품·프로모션",
    items: [
      { key: "products", label: "상품 관리", href: "/products" },
      { key: "pricing", label: "가격 관리", href: "/pricing" },
      { key: "coupons", label: "쿠폰 관리", href: "/coupons" },
    ],
  },
  {
    key: "generation-assets",
    label: "생성·에셋",
    items: [
      {
        key: "generation-logs",
        label: "생성 운영",
        href: "/generation-logs",
      },
      { key: "motifs", label: "Motif SVG", href: "/motifs" },
    ],
  },
  {
    key: "system",
    label: "시스템",
    items: [{ key: "settings", label: "설정", href: "/settings" }],
  },
] as const;

export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] =
  ADMIN_NAVIGATION_GROUPS.flatMap((group) => group.items);

export function isAdminNavigationActive(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
