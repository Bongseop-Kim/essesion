export default {
  forbidden: [
    {
      name: "frontend-no-server-internals",
      severity: "error",
      comment:
        "Store/Admin may depend on generated api-client and shared UI, never API, worker, DB, or Python libs.",
      from: { path: "(^|/)apps/(admin|store)/src" },
      to: { path: "(^|/)(apps/(api|worker)|db|libs)/" },
    },
    {
      name: "admin-no-store",
      severity: "error",
      comment:
        "Admin and Store are sibling clients; move shared UI to packages/shared.",
      from: { path: "(^|/)apps/admin/src" },
      to: { path: "(^|/)apps/store/src" },
    },
    {
      name: "store-no-admin",
      severity: "error",
      comment:
        "Store and Admin are sibling clients; move shared UI to packages/shared.",
      from: { path: "(^|/)apps/store/src" },
      to: { path: "(^|/)apps/admin/src" },
    },
    {
      name: "shared-no-apps",
      severity: "error",
      comment:
        "packages/shared is a lower UI layer and must not depend on either application.",
      from: { path: "(^|/)packages/shared/src" },
      to: { path: "(^|/)apps/" },
    },
    {
      name: "proxy-no-application-code",
      severity: "error",
      comment:
        "The Cloudflare API proxy is an isolated edge boundary and must not import app code.",
      from: { path: "(^|/)infra/cloudflare/api-proxy/src" },
      to: { path: "(^|/)(apps|packages|db|libs)/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      conditionNames: ["import", "types", "default"],
      exportsFields: ["exports"],
    },
  },
};
