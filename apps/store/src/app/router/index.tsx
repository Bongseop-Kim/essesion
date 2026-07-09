import { createBrowserRouter } from "react-router";

import { AppLayout } from "@/app/layout/app-layout";
import { ProtectedRoute } from "@/app/router/protected-route";
import { Home } from "@/pages/home";

// route별 lazy() → 자동 코드스플리팅. 데이터는 TanStack Query가 소유하므로 loader는 두지 않는다.
// 나머지 라우트(shop/order/cart/design 등)는 §5-B5 라우트 인벤토리에서 채운다.
export const router = createBrowserRouter([
  {
    element: <AppLayout />,
    children: [
      { index: true, element: <Home /> },
      {
        path: "login",
        lazy: async () => ({
          Component: (await import("@/pages/auth/login")).LoginPage,
        }),
      },
      {
        path: "auth/callback",
        lazy: async () => ({
          Component: (await import("@/pages/auth/callback")).AuthCallbackPage,
        }),
      },
      {
        path: "__preview",
        lazy: async () => ({
          Component: (await import("@/preview")).Preview,
        }),
      },
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "my-page",
            lazy: async () => ({
              Component: (await import("@/pages/my-page")).MyPage,
            }),
          },
        ],
      },
      // 임시: 미구현 라우트는 홈으로(YeongSeon catch-all과 동일).
      { path: "*", element: <Home /> },
    ],
  },
]);
