import {
  ActionButton,
  Header,
  type HeaderProps,
  Icon,
  snackbar,
} from "@essesion/shared";
import { Bars3Icon } from "@heroicons/react/24/outline";
import { Link, useLocation } from "react-router";

import {
  ADMIN_NAVIGATION,
  ADMIN_NAVIGATION_GROUPS,
} from "../../shared/config/navigation";
import { useAdminSession } from "../../shared/session/admin-session";

export function AdminHeader() {
  const location = useLocation();
  const { logout } = useAdminSession();

  const handleLogout = () => {
    void logout().catch(() => {
      snackbar(
        "이 브라우저에서 로그아웃했습니다. 서버 로그아웃은 확인하지 못했습니다.",
      );
    });
  };

  const renderLink: HeaderProps["renderLink"] = (item, props) => (
    <Link key={item.key ?? item.href} to={item.href} {...props} />
  );

  return (
    <Header
      brandLabel="ESSE SION 관리자"
      brandHref="/"
      brandLogoSrc="/logo/logo.png"
      navItems={[...ADMIN_NAVIGATION]}
      mobileNavGroups={ADMIN_NAVIGATION_GROUPS}
      activePathname={location.pathname}
      renderLink={renderLink}
      menuIcon={<Icon svg={<Bars3Icon />} size={20} />}
      showDesktopNavigation={false}
      actions={
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="small"
          onClick={handleLogout}
        >
          로그아웃
        </ActionButton>
      }
      mobileMenuFooter={
        <ActionButton
          type="button"
          variant="neutralOutline"
          size="large"
          onClick={handleLogout}
        >
          로그아웃
        </ActionButton>
      }
    />
  );
}
