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
      {
        path: "custom-order",
        lazy: async () => ({
          Component: (await import("@/pages/custom-order")).CustomOrderPage,
        }),
      },
      {
        path: "design",
        lazy: async () => ({
          Component: (await import("@/pages/design")).DesignPage,
        }),
      },
      {
        path: "sample-order",
        lazy: async () => ({
          Component: (await import("@/pages/sample-order")).SampleOrderPage,
        }),
      },
      {
        path: "token/purchase",
        lazy: async () => ({
          Component: (await import("@/pages/token-purchase")).TokenPurchasePage,
        }),
      },
      {
        path: "faq",
        lazy: async () => ({
          Component: (await import("@/pages/faq")).FaqPage,
        }),
      },
      {
        path: "notice",
        lazy: async () => ({
          Component: (await import("@/pages/notice")).NoticePage,
        }),
      },
      {
        path: "privacy-policy",
        lazy: async () => ({
          Component: (await import("@/pages/privacy-policy")).PrivacyPolicyPage,
        }),
      },
      {
        path: "terms-of-service",
        lazy: async () => ({
          Component: (await import("@/pages/terms-of-service"))
            .TermsOfServicePage,
        }),
      },
      {
        path: "refund-policy",
        lazy: async () => ({
          Component: (await import("@/pages/refund-policy")).RefundPolicyPage,
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
            path: "order/custom-payment",
            lazy: async () => ({
              Component: (await import("@/pages/order/custom-payment"))
                .CustomPaymentPage,
            }),
          },
          {
            path: "order/sample-payment",
            lazy: async () => ({
              Component: (await import("@/pages/order/sample-payment"))
                .SamplePaymentPage,
            }),
          },
          {
            path: "token/purchase/payment",
            lazy: async () => ({
              Component: (await import("@/pages/token-purchase/payment"))
                .TokenPaymentPage,
            }),
          },
          {
            path: "token/purchase/success",
            lazy: async () => ({
              Component: (await import("@/pages/token-purchase/success"))
                .TokenPurchaseSuccessPage,
            }),
          },
          {
            path: "token/purchase/fail",
            lazy: async () => ({
              Component: (await import("@/pages/token-purchase/fail"))
                .TokenPurchaseFailPage,
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
            path: "my-page/claims",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/claims")).ClaimListPage,
            }),
          },
          {
            path: "my-page/claims/:claimId",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/claim-detail"))
                .ClaimDetailPage,
            }),
          },
          {
            path: "my-page/my-info",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/my-info")).MyInfoPage,
            }),
          },
          {
            path: "my-page/my-info/notice",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/my-info/notice"))
                .NoticePage,
            }),
          },
          {
            path: "my-page/my-info/leave",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/my-info/leave"))
                .LeavePage,
            }),
          },
          {
            path: "my-page/shipping",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/shipping"))
                .ShippingPage,
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
