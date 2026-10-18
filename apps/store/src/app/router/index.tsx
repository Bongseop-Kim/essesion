import { createBrowserRouter, redirect } from "react-router";

import { AppLayout } from "@/app/layout/app-layout";
import { ProtectedRoute } from "@/app/router/protected-route";
import { RouteErrorBoundary } from "@/app/router/route-error";
import { Home } from "@/pages/home";
import { NotFoundPage } from "@/pages/not-found";

// route별 lazy() → 자동 코드스플리팅. 데이터는 TanStack Query가 소유하므로 loader는 두지 않는다.

export const storeRouteObjects = [
  {
    element: <AppLayout />,
    errorElement: <RouteErrorBoundary />,
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
          Component: (await import("@/pages/design/templates"))
            .DesignTemplatesPage,
        }),
      },
      {
        path: "sample-order",
        lazy: async () => ({
          Component: (await import("@/pages/sample-order")).SampleOrderPage,
        }),
      },
      {
        // 디자인 토큰 판매 종료(2026-10-19) — 옛 링크 보존
        path: "token/*",
        loader: () => redirect("/"),
      },
      {
        path: "my-page/token-history",
        loader: () => redirect("/"),
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
      {
        element: <ProtectedRoute />,
        children: [
          {
            // 옛 주소(색·로고가 나뉘던 시절) 링크 보존
            path: "design/sessions/:id/color",
            loader: ({ params }) =>
              redirect(`/design/sessions/${params.id}/customize`),
          },
          {
            path: "design/sessions/:id/customize",
            lazy: async () => ({
              Component: (await import("@/pages/design/customize"))
                .DesignCustomizePage,
            }),
          },
          {
            // 실사화 결과 화면은 없어졌다 — 옛 링크는 색·로고로
            path: "design/sessions/:id/result",
            loader: ({ params }) =>
              redirect(`/design/sessions/${params.id}/customize`),
          },
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
            path: "my-page/inquiry",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/inquiry")).InquiryPage,
            }),
          },
          {
            path: "my-page/quote-request",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/quote-request"))
                .QuoteRequestPage,
            }),
          },
          {
            path: "my-page/quote-request/:quoteId",
            lazy: async () => ({
              Component: (await import("@/pages/my-page/quote-request-detail"))
                .QuoteRequestDetailPage,
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
      { path: "*", element: <NotFoundPage /> },
    ],
  },
] satisfies Parameters<typeof createBrowserRouter>[0];

export const router = createBrowserRouter(storeRouteObjects);
