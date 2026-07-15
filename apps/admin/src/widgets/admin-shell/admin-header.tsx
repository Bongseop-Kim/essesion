import {
  ActionButton,
  Header,
  type HeaderProps,
  Icon,
  snackbar,
} from "@essesion/shared";
import {
  ArrowRightStartOnRectangleIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import { Link, useLocation } from "react-router";

import { ADMIN_NAVIGATION } from "../../shared/config/navigation";
import { useAdminSession } from "../../shared/session/admin-session";

export function AdminHeader() {
  const location = useLocation();
  const { logout } = useAdminSession();

  const handleLogout = () => {
    void logout().catch(() => {
      snackbar("서버 로그아웃 확인에 실패해 현재 화면의 세션만 정리했습니다.");
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
      mobileActions={
        <ActionButton
          type="button"
          variant="ghost"
          size="medium"
          iconOnly
          aria-label="로그아웃"
          onClick={handleLogout}
        >
          <Icon svg={<ArrowRightStartOnRectangleIcon />} size={20} />
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
