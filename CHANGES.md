# CNW — Version v2.0 (Multi-Page Architecture) — Change Log

**Date:** 9 September 2026
**Scope:** Frontend architecture (SPA → multi-page), Contact page (new page + security), user/admin page separation, admin dashboard professional charts, backend contact hardening.

---

## 1. Summary

The frontend was converted from a single-page hash-router app (`index.html` + `src/router.js`)
into a professional **multi-page site** — the same structure used by the reference projects
`D:\Tohama Website\Tohama_Website` (user pages + info-card contact design) and
`D:\freelance--main` (separate HTML/CSS/JS folders, user vs. admin separation).

- Every route is now a **real HTML page** with its own SEO title/description.
- **User pages live in `/user`, admin pages live in `/admin`** (fully separated folders).
- **Contact Us is now its own page** with dedicated CSS + hardened JS.
- The **admin dashboard got professional SVG graphics** (charts) in the Overview/info section.
- Old `#/route` links still work — they are auto-redirected to the real pages.

---

## 2. New page structure (16 HTML pages)

```
frontend/
├── index.html                 → Home (3D hero) — user area
├── user/                      → ★ USER PAGES (separated)
│   ├── about.html
│   ├── contact.html           → NEW dedicated Contact Us page
│   ├── designs.html
│   ├── design-detail.html     (?design=formal|3d|3d-animation|interactive)
│   ├── pricing.html
│   ├── cart.html
│   ├── payment.html
│   ├── login.html
│   ├── register.html
│   ├── forgot.html            (supports ?token= and #/reset?token=)
│   ├── dashboard.html         → user account dashboard
│   └── architect.html         → visual architecture builder
└── admin/                     → ★ ADMIN PAGES (separated)
    ├── index.html             → admin dashboard (charts, sections)
    ├── ai-builder.html        → admin-only AI website builder
    └── editor.html            → admin-only visual design editor
```

Dashboard **sections** (users/products/orders/payments/pages/designs/projects/plugins/ai/security/settings)
switch inside the dashboard page via `#section` hash links — no full page reloads needed.

---

## 3. New files

| File | Purpose |
|---|---|
| `frontend/user/*.html` (12 files) | User pages (about, contact, designs, design-detail, pricing, cart, payment, login, register, forgot, dashboard, architect) |
| `frontend/admin/*.html` (3 files) | Admin pages (dashboard, ai-builder, editor) — separated from user pages |
| `frontend/src/links.js` | Central route map: `href('/designs/3d')` → `/user/design-detail.html?design=3d`; `go()` for JS navigation; legacy `#/hash` resolver |
| `frontend/src/lifecycle.js` | Shared cleanup registry (Three.js scenes, listeners) — replaces `router.js` |
| `frontend/src/styles/contact.css` | Dedicated Contact page stylesheet (Tohama-inspired hero + info cards + FAQ) |
| `frontend/src/components/charts.js` | Dependency-free SVG charts: `lineChart`, `barChart`, `donutChart` |
| `CHANGES.md` | This document |

## 4. Changed files

| File | Change |
|---|---|
| `frontend/src/main.js` | Rewritten as shared bootstrap `startApp(render)` used by every HTML page (session restore, i18n, header/footer, smooth scroll, error reporting, legacy-hash redirect) |
| `frontend/vite.config.js` | MPA build: 16 `rollupOptions.input` entries (user/ + admin/ folders) |
| `frontend/index.html` | Now boots the home page module directly (MPA entry) |
| `frontend/src/layouts/header.js` / `footer.js` | All links use `href()` real-page URLs; active link detection by pathname |
| `frontend/src/pages/*.js` (home, designs, design-detail, pricing, cart, payment, login, register, forgot, contact, dashboard, ai-builder, editor, dashboard-content) | Converted to real-page navigation (`href()` / `go()`), params via `?query` |
| `frontend/src/pages/dashboard.js` | Shared user/admin shell (`isAdminArea` flag), admin area requires admin role, in-page section hash navigation |
| `frontend/src/pages/contact.js` | Full redesign + security hardening (see §5) |
| `frontend/src/pages/dashboard-sections.js` | Overview now renders 3 professional charts from real data |
| `frontend/src/styles/main.css` | Added chart styles (`.charts-grid`, `.chart-card`, legend, responsive) |
| `backend/src/routes/index.js` | Added optional validators for `honeypot` / `elapsedMs` on `POST /api/contact` |
| `backend/src/controllers/contact.controller.js` | Silent spam drop (honeypot filled or submitted < 2s → fake 201, nothing stored) |
| `backend/src/services/password-flow.service.js` | Reset link now points to `/user/forgot.html` |
| `README.md` | Section 10 updated for the multi-page structure |
| `frontend/src/router.js` | **Deleted** (replaced by real pages + `links.js`) |

---

## 5. Contact Us page — new design + security

**Design** (inspired by `D:\Tohama Website\Tohama_Website\user\html\main\contact-us.html`):
- Hero band with kicker, gradient title and security badges.
- 6 info cards: Phone, WhatsApp, Email, GitHub, LinkedIn, Location.
- Secure inquiry form + aside with response-time card, FAQ accordion and AI assistant note.
- Fully responsive (own `contact.css`, `cu-*` classes).

**Security ("join to security"):**

| Layer | Protection |
|---|---|
| Client | HTML5 validation + inline `.invalid` highlighting; message char counter (0/4000); trimmed inputs |
| Client | **Honeypot field** (`company_website`, visually hidden) and **time-trap** (`elapsedMs` measured from page render) |
| Backend | **Silent spam drop**: honeypot filled or `elapsedMs < 2000` → fake `201`, nothing stored, bots get no signal |
| Backend | Rate limiter `contactLimiter` — 10 submissions / hour / IP (existing, unchanged) |
| Backend | `express-validator` chains re-validate every field; inputs sliced to safe lengths |
| Backend | Message stored encrypted-at-rest, IP recorded, owner notified via email + SMS |

---

## 6. Admin dashboard — professional graphics

`Overview` info section now renders **dependency-free SVG charts** (`src/components/charts.js`):

1. **📈 Revenue — last 14 days** (area/line chart with gradient fill, grid, dots, axis labels) — built from real recent-order totals.
2. **🍩 Orders by status** (donut chart with legend + center total) — from real order statuses (paid/pending/failed/refunded).
3. **📊 Orders per day — last 14 days** (gradient bar chart).

All charts are responsive (`viewBox`), accessible (`role="img"` + aria-labels), show friendly
empty-state messages when there is no data yet, and collapse to one column on mobile.

---

## 7. How to run

```powershell
# backend
cd backend
npm install
npm run dev          # http://localhost:5000

# frontend (dev, any page directly, e.g. /user/contact.html)
cd frontend
npm install
npm run dev          # http://localhost:5173

# frontend (production build)
npm run build
```

## 8. Migration notes

- Old SPA links (`#/designs/3d`, `#/dashboard/users`, `#/admin`, …) still work: the shared
  bootstrap resolves them and redirects to the correct real page.
- Password-reset emails now link to `/user/forgot.html#/reset?token=…`.
- `/admin/*` pages require an admin role; regular users are redirected to `/user/dashboard.html`.
- `frontend/dist/` contains the last production build (16 pages, code-split assets).

---

# Version v2.1 — Tohama Logic + Freelance Store + AI Split + Chat + Subscriptions

**Date:** 9 September 2026

## 1. Summary

- **Code Store** (design from `D:\freelance--main`): cards with price + add-to-cart, but the products are CODE (CSS/HTML/JS) — every card opens the code AND a live iframe preview of the result.
- **WhatsApp-style in-site chat** (logic/UI from `D:\Tohama Website\Tohama_Website\user\html\main\chat.html`): user ↔ user AND user ↔ admin/support, 3-second polling, unread badges, read receipts (✓✓).
- **AI chat split**: User AI (search the whole site + any question, new `search_site` tool) and Admin AI (live payments/orders/users/subscriptions data + report generation).
- **Admin reports in Excel (xls) / CSV / PDF** — one-click downloads for users (incl. WhatsApp & business info), orders, payments, messages, subscriptions, errors. Zero external dependencies (handcrafted PDF + Excel-compatible HTML).
- **Subscriptions**: Starter Care (weekly updates $9/wk), Pro Care (monthly $29/mo), Business Care (updates EVERY week, $99/mo) — subscribing creates real order + payment records with renewal dates.
- **Tohama-style registration & profile**: register now collects WhatsApp, business name, business type, site purpose and budget; editable from the new Profile page.
- **JSON for everything**: new `chat_messages`, `code_products`, `subscriptions` collections in `backend/database/json/` (auto-created).

## 2. New backend files

| File | Purpose |
|---|---|
| `backend/src/controllers/chat.controller.js` | Contacts, thread messages, unread counts, send (user ↔ user + support) |
| `backend/src/controllers/store.controller.js` | Code store CRUD + auto-seeded starter snippets (CSS glow card, HTML sale badge, JS counter) |
| `backend/src/controllers/subscription.controller.js` | Plan catalog, subscribe (real order+payment), my subscriptions, cancel, admin list |
| `backend/src/controllers/report.controller.js` | Excel (xls) / CSV / PDF downloads for 6 datasets + JSON summary |

## 3. New API endpoints

- `GET/POST /api/chat/contacts · /chat/messages · /chat/unread` — WhatsApp-style chat (rate limited 300/5min)
- `GET /code-products` (+`/:id`), admin `POST/PUT/DELETE` — code store
- `GET /subscriptions/plans`, `POST /subscriptions/subscribe`, `GET /subscriptions/mine`, `POST /subscriptions/:id/cancel`, `GET /admin/subscriptions`
- `GET /admin/reports` (JSON summary) and `GET /admin/reports/:dataset?format=xls|csv|pdf` (file downloads)
- `PUT /users/me/profile` — extended profile (whatsapp, business, businessType, sitePurpose, budget, bio)

## 4. New frontend pages

| Page | Route | Features |
|---|---|---|
| `user/store.html` | Code Store | language filter, code viewer, live result iframe, copy code, add to cart |
| `user/chat.html` | Messages | WhatsApp UI (#075e54/#25d366), contacts with SUPPORT badge, 3s polling, unread badges |
| `user/profile.html` | My Profile | edit all extended info |
| `user/subscriptions.html` | Subscriptions | weekly/monthly plan cards, subscribe & pay, renewal table, cancel |

Admin dashboard: new 🛒 **Code Store** section (publish/delete code products) and the AI section now includes the **Instant Reports panel** (Excel/CSV/PDF per dataset). New AI tools: `search_site`, `my_subscriptions`, `get_overview`, `get_users_info`, `get_orders_info`, `get_payments_info`, `get_subscriptions_info`, `get_messages_info`, `build_report`.

## 5. Extended registration fields (Tohama logic)

Registration now asks: Phone, **WhatsApp**, Business/brand, Business type, What do you want to build, Budget range — stored on the user record, shown in chat profiles, included in the Users Excel report.

## 6. Validation

- Backend: `node -e require(...)` syntax check OK for all new modules · 40/40 tests pass
- Live smoke test: `/api/code-products` seeds 3 items · `/api/subscriptions/plans` returns 3 plans · `/api/admin/reports/users` is protected (401 without token)
- Frontend build: 20 pages compile (4 new: store, chat, profile, subscriptions)
