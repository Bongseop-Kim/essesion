export type AdminNavigationItem = {
  key: string;
  label: string;
  href: string;
};

export const ADMIN_NAVIGATION: readonly AdminNavigationItem[] = [
  { key: "dashboard", label: "대시보드", href: "/" },
  { key: "incidents", label: "결제 이상", href: "/incidents" },
  { key: "orders", label: "주문 관리", href: "/orders" },
  { key: "manual-orders", label: "수기 주문", href: "/manual-orders" },
  { key: "products", label: "상품 관리", href: "/products" },
  { key: "coupons", label: "쿠폰 관리", href: "/coupons" },
  { key: "quote-requests", label: "견적 관리", href: "/quote-requests" },
  { key: "claims", label: "클레임 관리", href: "/claims" },
  { key: "customers", label: "고객 관리", href: "/customers" },
  { key: "inquiries", label: "문의 관리", href: "/inquiries" },
  { key: "pricing", label: "가격 관리", href: "/pricing" },
  {
    key: "generation-logs",
    label: "생성 운영",
    href: "/generation-logs",
  },
  { key: "motifs", label: "Motif SVG", href: "/motifs" },
  { key: "settings", label: "설정", href: "/settings" },
] as const;

export function isAdminNavigationActive(pathname: string, href: string) {
  if (href === "/") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}
