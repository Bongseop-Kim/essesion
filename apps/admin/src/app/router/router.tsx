import { Box, Text } from "@essesion/shared";
import type { ComponentType } from "react";
import {
  createBrowserRouter,
  Navigate,
  type Params,
  type RouteObject,
  useParams,
} from "react-router";

import { AdminShell } from "../../widgets/admin-shell/admin-shell";
import { ProtectedRoute } from "./protected-route";
import { RouteErrorBoundary } from "./route-error";

function RouteHydrationFallback() {
  return (
    <Box
      as="main"
      aria-busy="true"
      display="flex"
      alignItems="center"
      justifyContent="center"
      minHeight="100dvh"
      px="x6"
    >
      <Text as="p" color="fg.neutral-muted">
        관리자 화면을 불러오고 있습니다.
      </Text>
    </Box>
  );
}

const pageRoutes: RouteObject[] = [
  {
    index: true,
    lazy: async () => {
      const { DashboardPage } = await import("../../pages/dashboard");
      return { Component: DashboardPage };
    },
  },
  {
    path: "incidents",
    lazy: async () => {
      const { IncidentsPage } = await import("../../pages/incidents/list");
      return { Component: IncidentsPage };
    },
  },
  {
    path: "incidents/:incidentId",
    lazy: async () => {
      const { IncidentDetailPage } = await import(
        "../../pages/incidents/detail"
      );
      return { Component: IncidentDetailPage };
    },
  },
  {
    path: "orders",
    lazy: async () => {
      const { OrdersPage } = await import("../../pages/orders/list");
      return { Component: OrdersPage };
    },
  },
  {
    path: "orders/:orderId",
    lazy: async () => {
      const { OrderDetailPage } = await import("../../pages/orders/detail");
      return { Component: OrderDetailPage };
    },
  },
  {
    path: "manual-orders",
    lazy: async () => {
      const { ManualOrdersPage } = await import(
        "../../pages/manual-orders/list"
      );
      return { Component: ManualOrdersPage };
    },
  },
  {
    path: "manual-orders/new",
    lazy: async () => {
      const { ManualOrderNewPage } = await import(
        "../../pages/manual-orders/new"
      );
      return { Component: ManualOrderNewPage };
    },
  },
  {
    path: "manual-orders/:manualOrderId",
    lazy: async () => {
      const { ManualOrderDetailPage } = await import(
        "../../pages/manual-orders/detail"
      );
      return { Component: ManualOrderDetailPage };
    },
  },
  {
    path: "manual-orders/:manualOrderId/edit",
    lazy: async () => {
      const { ManualOrderEditPage } = await import(
        "../../pages/manual-orders/edit"
      );
      return { Component: ManualOrderEditPage };
    },
  },
  {
    path: "products",
    lazy: async () => {
      const { ProductsPage } = await import("../../pages/products/list");
      return { Component: ProductsPage };
    },
  },
  {
    path: "products/new",
    lazy: async () => {
      const { ProductNewPage } = await import("../../pages/products/new");
      return { Component: ProductNewPage };
    },
  },
  {
    path: "products/:productId",
    lazy: async () => {
      const { ProductDetailPage } = await import("../../pages/products/detail");
      return { Component: ProductDetailPage };
    },
  },
  {
    path: "products/:productId/edit",
    lazy: async () => {
      const { ProductEditPage } = await import("../../pages/products/edit");
      return { Component: ProductEditPage };
    },
  },
  {
    path: "coupons",
    lazy: async () => {
      const { CouponsPage } = await import("../../pages/coupons/list");
      return { Component: CouponsPage };
    },
  },
  {
    path: "coupons/new",
    lazy: async () => {
      const { CouponNewPage } = await import("../../pages/coupons/new");
      return { Component: CouponNewPage };
    },
  },
  {
    path: "coupons/:couponId",
    lazy: async () => {
      const { CouponDetailPage } = await import("../../pages/coupons/detail");
      return { Component: CouponDetailPage };
    },
  },
  {
    path: "coupons/:couponId/edit",
    lazy: async () => {
      const { CouponEditPage } = await import("../../pages/coupons/edit");
      return { Component: CouponEditPage };
    },
  },
  {
    path: "quote-requests",
    lazy: async () => {
      const { QuotesPage } = await import("../../pages/quotes/list");
      return { Component: QuotesPage };
    },
  },
  {
    path: "quote-requests/:quoteId",
    lazy: async () => {
      const { QuoteDetailPage } = await import("../../pages/quotes/detail");
      return { Component: QuoteDetailPage };
    },
  },
  {
    path: "claims",
    lazy: async () => {
      const { ClaimsPage } = await import("../../pages/claims/list");
      return { Component: ClaimsPage };
    },
  },
  {
    path: "claims/:claimId",
    lazy: async () => {
      const { ClaimDetailPage } = await import("../../pages/claims/detail");
      return { Component: ClaimDetailPage };
    },
  },
  {
    path: "customers",
    lazy: async () => {
      const { CustomersPage } = await import("../../pages/customers/list");
      return { Component: CustomersPage };
    },
  },
  {
    path: "customers/:userId",
    lazy: async () => {
      const { CustomerDetailPage } = await import(
        "../../pages/customers/detail"
      );
      return { Component: CustomerDetailPage };
    },
  },
  {
    path: "inquiries",
    lazy: async () => {
      const { InquiriesPage } = await import("../../pages/inquiries/list");
      return { Component: InquiriesPage };
    },
  },
  {
    path: "inquiries/:inquiryId",
    lazy: async () => {
      const { InquiryDetailPage } = await import(
        "../../pages/inquiries/detail"
      );
      return { Component: InquiryDetailPage };
    },
  },
  {
    path: "pricing",
    lazy: async () => {
      const { PricingPage } = await import("../../pages/pricing");
      return { Component: PricingPage };
    },
  },
  {
    path: "generation-logs",
    lazy: async () => {
      const { GenerationOperationsPage } = await import(
        "../../pages/generation/list"
      );
      return { Component: GenerationOperationsPage };
    },
  },
  {
    path: "generation-logs/jobs/:jobId",
    lazy: async () => {
      const { GenerationJobDetailPage } = await import(
        "../../pages/generation/job-detail"
      );
      return { Component: GenerationJobDetailPage };
    },
  },
  {
    path: "generation-logs/seamless/:logId",
    lazy: async () => {
      const { SeamlessLogDetailPage } = await import(
        "../../pages/generation/seamless-detail"
      );
      return { Component: SeamlessLogDetailPage };
    },
  },
  {
    path: "motifs",
    lazy: async () => {
      const { MotifsPage } = await import("../../pages/motifs/list");
      return { Component: MotifsPage };
    },
  },
  {
    path: "motifs/:motifId",
    lazy: async () => {
      const { MotifDetailPage } = await import("../../pages/motifs/detail");
      return { Component: MotifDetailPage };
    },
  },
  {
    path: "settings",
    lazy: async () => {
      const { SettingsPage } = await import("../../pages/settings");
      return { Component: SettingsPage };
    },
  },
  {
    path: "*",
    lazy: async () => {
      const { NotFoundPage } = await import("../../pages/not-found");
      return { Component: NotFoundPage };
    },
  },
];

function createLegacyRedirect(
  buildTarget: (params: Readonly<Params<string>>) => string,
): ComponentType {
  return function LegacyRedirect() {
    const params = useParams();
    return <Navigate to={buildTarget(params)} replace />;
  };
}

const legacyRoutes: RouteObject[] = [
  {
    path: "/orders/show/:id",
    Component: createLegacyRedirect(({ id }) => `/orders/${id ?? ""}`),
  },
  {
    path: "/products/create",
    Component: createLegacyRedirect(() => "/products/new"),
  },
  {
    path: "/products/edit/:id",
    Component: createLegacyRedirect(({ id }) => `/products/${id ?? ""}/edit`),
  },
  {
    path: "/coupons/create",
    Component: createLegacyRedirect(() => "/coupons/new"),
  },
  {
    path: "/coupons/edit/:id",
    Component: createLegacyRedirect(({ id }) => `/coupons/${id ?? ""}`),
  },
  {
    path: "/quote-requests/show/:id",
    Component: createLegacyRedirect(({ id }) => `/quote-requests/${id ?? ""}`),
  },
  {
    path: "/claims/show/:id",
    Component: createLegacyRedirect(({ id }) => `/claims/${id ?? ""}`),
  },
  {
    path: "/customers/show/:id",
    Component: createLegacyRedirect(({ id }) => `/customers/${id ?? ""}`),
  },
  {
    path: "/inquiries/show/:id",
    Component: createLegacyRedirect(({ id }) => `/inquiries/${id ?? ""}`),
  },
  {
    path: "/seamless-logs",
    Component: createLegacyRedirect(() => "/generation-logs?tab=seamless"),
  },
  {
    path: "/seamless-logs/:id",
    Component: createLegacyRedirect(
      ({ id }) => `/generation-logs/seamless/${id ?? ""}`,
    ),
  },
  {
    path: "/generation-logs/:legacyId",
    Component: createLegacyRedirect(() => "/generation-logs"),
  },
];

export const adminRouteObjects: RouteObject[] = [
  {
    HydrateFallback: RouteHydrationFallback,
    errorElement: <RouteErrorBoundary />,
    children: [
      {
        path: "/login",
        lazy: async () => {
          const { LoginPage } = await import("../../pages/login");
          return { Component: LoginPage };
        },
      },
      ...legacyRoutes,
      {
        path: "/",
        element: (
          <ProtectedRoute allowedRoles={["admin", "manager"]}>
            <AdminShell />
          </ProtectedRoute>
        ),
        children: pageRoutes,
      },
    ],
  },
];

export function createAdminBrowserRouter() {
  return createBrowserRouter(adminRouteObjects);
}
