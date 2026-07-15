# Admin UI semantic contract

This contract is the implementation and review baseline for admin-only navigation, data tables, pagination, route transitions, and mutations. Visual primitives still come from `@essesion/shared`; these semantic compositions stay in `apps/admin` until a second app has the same need.

## Application shell

- The document exposes one skip link targeting the protected page `<main>`.
- The shell uses `header`, labelled `nav`, and `main` landmarks. The desktop sidebar is 240px and the current link has `aria-current="page"`.
- Mobile navigation is opened from the shared header and closes after navigation. It is keyboard reachable and restores focus to its trigger when dismissed.
- Session bootstrap finishes before protected navigation or data is rendered. Logout and confirmed role loss clear the in-memory access token and query cache.
- Every route sets a distinct document title. After navigation, the page `h1` receives programmatic focus without entering the normal tab order.

## Native data table

- Data grids use native `table`, `caption`, `thead`, `tbody`, `tr`, `th`, and `td` semantics. Every column header uses `scope="col"`.
- A sortable header owns one button and reports `aria-sort` on its `th`. Sorting always adds the stable server-side `id` tie-breaker.
- A row itself is never clickable. The primary identifier cell contains an explicit detail link; every row action names its target.
- Numeric, money, quantity, and date columns use tabular numbers. Lower-priority columns hide before the table requires horizontal movement.
- The table container has `min-width: 0`. Remaining horizontal overflow is provided only by `ScrollFog direction="horizontal"` as documented in [`docs/foundation/scroll.md`](foundation/scroll.md). Its region is focusable and has a purpose-specific accessible name.
- Loading, first-use empty, filtered empty, error, and background refetch are distinct states. `aria-busy` and a polite live region announce result updates while stale rows remain non-actionable.

## Pagination and filters

- Pagination is a labelled `nav`. The current page has `aria-current="page"`; previous and next controls are disabled at the range boundaries.
- Status, date, sort, and page are URL state. Names, email addresses, and phone numbers stay only in component memory and are sent in a request body.
- Changing a filter resets the page. A new request cancels the superseded request, while a background refresh keeps the previous result visible and marked busy.
- Desktop filters use the list toolbar. Mobile filters use the shared responsive modal or bottom sheet and report the active-filter count.

## Forms and mutations

- Every field has a visible label and an associated error description. A failed submit focuses an error summary and then the first invalid field.
- Destructive or financial changes use `AlertDialog` and show target, change, impact, and required reason. Closing restores focus to the invoking control.
- Pending mutations disable duplicate submission. Financial and state-changing requests are not automatically retried; retry keeps the same operation/idempotency identifier.
- Successful mutations refetch the authoritative read model. Stale-write `409` keeps local input and offers server comparison and explicit reload.
- Product, coupon, quote, pricing, and settings forms register both a route blocker and `beforeunload` protection while dirty.
- Success and asynchronous failure use the global snackbar live region. Reduced-motion preferences are honored.

## Query invalidation map

| Mutation | Required invalidation |
|---|---|
| Order action or tracking | order detail, order list, dashboard summary/recent orders, linked claim |
| Claim action, tracking, or notification retry | claim detail/list, order detail, dashboard summary, linked payment incident |
| Payment reconciliation or resolution | incident detail/list, dashboard summary, linked order/claim |
| Customer token adjustment | customer detail, token ledger, customer list, operation log |
| Coupon update, issue, or revoke | coupon detail/list/history, affected customer coupon pages |
| Product save | product detail/list and public product queries |
| Quote save or action | quote detail/list, dashboard recent quotes |
| Inquiry answer | inquiry detail/list and dashboard summary |
| Pricing or settings batch save | the corresponding complete allowlist query |

## Verification matrix

Keyboard and visual checks cover 390, 767, 768, 1024, and 1440 CSS pixels plus 200% browser zoom. At minimum verify skip navigation, mobile-menu focus restoration, table horizontal keyboard scrolling, sortable headers, pagination, dialog cancellation and completion, dirty-form navigation, and error-summary focus.
