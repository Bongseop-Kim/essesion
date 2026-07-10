import { createBrowserRouter, type RouteObject } from "react-router";

import { AppLayout } from "@/app/layout/app-layout";
import { ProtectedRoute } from "@/app/router/protected-route";
import { Home } from "@/pages/home";

// route별 lazy() → 자동 코드스플리팅. 데이터는 TanStack Query가 소유하므로 loader는 두지 않는다.
// 나머지 라우트(shop/order/cart/design 등)는 §5-B5 라우트 인벤토리에서 채운다.
const previewRoutes: RouteObject[] = import.meta.env.DEV
  ? [
      {
        path: "__preview",
        lazy: async () => ({
          Component: (await import("@/preview")).Preview,
        }),
      },
    ]
  : [];

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
        path: "shop",
        lazy: async () => ({
          Component: (await import("@/pages/shop")).ShopPage,
        }),
      },
      {
        path: "shop/:id",
        lazy: async () => ({
          Component: (await import("@/pages/shop/detail")).ShopDetailPage,
        }),
      },
      {
        path: "cart",
        lazy: async () => ({
          Component: (await import("@/pages/cart")).CartPage,
        }),
      },
      {
        path: "reform",
        lazy: async () => ({
          Component: (await import("@/pages/reform")).ReformPage,
        }),
      },
      ...previewRoutes,
      {
        element: <ProtectedRoute />,
        children: [
          {
            path: "order/order-form",
            lazy: async () => ({
              Component: (await import("@/pages/order/order-form"))
                .OrderFormPage,
            }),
          },
          {
            path: "order/payment/success",
            lazy: async () => ({
              Component: (await import("@/pages/order/payment-success"))
                .PaymentSuccessPage,
            }),
          },
          {
            path: "order/payment/fail",
            lazy: async () => ({
              Component: (await import("@/pages/order/payment-fail"))
                .PaymentFailPage,
            }),
          },
          {
            path: "my-page",
            lazy: async () => ({
              Component: (await import("@/pages/my-page")).MyPage,
            }),
          },
          {
            path: "my-page/orders",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/orders")).OrderListPage,
            }),
          },
          {
            path: "order/:orderId",
            lazy: async () => ({
              Component: (await import("@/pages/order/detail")).OrderDetailPage,
            }),
          },
          {
            path: "order/:orderId/repair-shipping",
            lazy: async () => ({
              Component: (await import("@/pages/order/repair-shipping"))
                .RepairShippingPage,
            }),
          },
        ],
      },
      // 임시: 미구현 라우트는 홈으로(YeongSeon catch-all과 동일).
      { path: "*", element: <Home /> },
    ],
  },
]);
