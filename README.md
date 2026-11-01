# CNW — Create New Website

A complete, professional full-stack website platform: Express (Node.js) backend with a secure, switchable database layer; a Vite + Three.js + GSAP + Lenis frontend; authentication, admin dashboard, cart & payments, AI agents, and a permission-based plugin system.

> **Security note:** Defense in depth is implemented, but no system is "100% secure" or unhackable. Follow the hardening checklist in this README for production.

---

## 1. Project structure

```
CNW/
├── backend/
│   ├── src/
│   │   ├── ai/               # AI service, user/admin agents, prompt guard
│   │   ├── config/           # env config, roles & permissions
│   │   ├── controllers/      # HTTP layer (auth, cart, orders, CRUD, admin, AI, plugins)
│   │   ├── middleware/       # auth, validation, rate limiting, errors
│   │   ├── models/           # storage-agnostic model definitions
│   │   ├── plugins/          # plugin registry / validator / sandbox / manager
│   │   ├── routes/           # route registry
│   │   ├── security/         # password (Argon2id), AES-256-GCM, key manager, JWT, sanitizer
│   │   ├── services/         # db abstraction, auth, audit, backups, stores (json/mongo)
│   │   └── utils/            # logger (redacting), errors, async handler
│   ├── database/
│   │   ├── json/             # local JSON database (dev/fallback)
│   │   ├── migrations/       # DB migrations
│   │   └── backups/          # encrypted backups
│   ├── server.js
│   ├── package.json
│   ├── .env.example          # copy to .env — never commit .env
│   └── tests/                # Node built-in test-runner suite (40 tests)
├── frontend/
│   ├── src/                  # ai, api, auth, animations, interactions, layouts,
│   │                         # pages, three, styles, utils
│   ├── index.html  vite.config.js  package.json
├── scripts/dev.js            # runs backend + frontend together
├── .gitignore                # .env and database data are excluded
└── package.json              # root scripts
```

## 2. Installation

```bash
# Backend
cd backend
npm install            # express argon2 helmet express-rate-limit express-validator
                       # cors dotenv jsonwebtoken cookie-parser hpp nanoid mongoose
npm install -D nodemon

# Frontend
cd ../frontend
npm install            # three gsap lenis postprocessing lucide vite
```

## 3. Environment variables

Copy `backend/.env.example` → `backend/.env` and fill values. **Never commit `.env`.**

| Variable | Purpose |
|---|---|
| `PORT`, `NODE_ENV` | Server port / mode |
| `MONGODB_URI`, `MONGODB_DB_NAME` | MongoDB Atlas (leave `DB_TYPE=json` for local dev) |
| `DB_TYPE` | `json` (dev/fallback) or `mongodb` |
| `JWT_SECRET`, `SESSION_SECRET` | Token signing / cookie signing |
| `PASSWORD_PEPPER` | Optional server-side pepper (never stored in DB) |
| `ENCRYPTION_KEY_CURRENT` / `_PREVIOUS` | AES-256-GCM key versions (rotation) |
| `BACKUP_ENCRYPTION_KEY` | Dedicated backup key |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | AI agents (backend only — never sent to the browser) |
| `CORS_ORIGINS` | Comma-separated allowed frontend origins (never `*` in prod) |
| `CLIENT_URL` | Frontend URL for reset links |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Optional first super-admin bootstrap |

Generate strong secrets:
```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## 4. Running

### Option A — Everything from the backend (single server, recommended)

The Express server can serve BOTH the API and the built website from one port.
`server.js` is the main file of the whole application.

```bash
# One-time: build the frontend into frontend/dist
cd "frontend" && npm run build

# Then serve the entire website (frontend + API) from the backend:
cd "../backend" && npm start      # http://localhost:5000  (auto-falls back to 5001+ if 5000 is busy)

# Or build + start in one command:
cd backend && npm run start:all
```

`server.js` detects `frontend/dist/index.html` and serves:
- `/` and any page → the website
- `/api/...` → the REST API

### Option B — Frontend + backend separately (development)

```bash
cd backend  && npm run dev  # API on http://localhost:5000
cd frontend && npm run dev  # App on http://localhost:5173 (proxies /api → :5000)
```

Production: `npm run build` (frontend) and `npm start` (backend). **Use HTTPS in production** (HSTS is enabled automatically when `NODE_ENV=production`).

## 5. Database setup

- **Development:** nothing to do — the JSON store persists to `backend/database/json/`.
- **MongoDB Atlas:** set `DB_TYPE=mongodb`, `MONGODB_URI=mongodb+srv://<user>:<pass>@...`, `MONGODB_DB_NAME=cnw`. Use a least-privilege database user. First boot seeds a super-admin, starter products, designs and example plugins.
- **Migrations:** `node database/migrations/001_initial_schema.js`
- **Backups:** created from Dashboard → Security (AES-256-GCM encrypted, restorable).

## 6. Security architecture (defense in depth)

```
HTTPS/TLS → Helmet headers (CSP, HSTS, frame-deny, no-sniff, referrer policy)
→ CORS allow-list → rate limiting (global + strict on auth/reset/AI)
→ progressive brute-force guard → input validation (express-validator) + HPP
→ auth (JWT access token + revocable session, opaque rotating refresh token)
→ authorization (role + permission matrix, admin/super-admin separation)
→ Argon2id password hashing (memory 19 MiB, t=2) + optional pepper (env only)
→ AES-256-GCM for sensitive fields (unique IV, tag, key version)
→ key manager (versioned keys, rotation, old-key compatibility)
→ DB never exposed to the frontend (Frontend → API → services → store)
→ encrypted backups with separate key → security audit logs (secrets redacted)
```

- Reset tokens: `crypto.randomBytes`, stored only as SHA-256 hashes, expiring, single-use; all sessions revoked after reset.
- The frontend never sees password hashes, secrets, or raw card data. Card data is never accepted or stored at all.
- Centralized error handler never leaks stack traces, paths, or credentials (stacks only in local dev responses).

## 7. AI architecture

- `backend/src/ai/ai.service.js` — OpenAI chat completions using `OPENAI_API_KEY` from env; automatic offline fallback assistant when no key is set.
- **User agent** (`use:user-ai` permission): site navigation, product info, design suggestions.
- **Admin agent** (`use:admin-ai` permission): planning, page/design concepts, architecture, content, system analysis.
- Prompt guard blocks injection patterns; agents cannot bypass authorization (permissions enforced at routes; the AI never executes code).
- **AI Builder workflow:** Prompt → AI → structured plan → validation → preview → admin approval → page/project generation (drafts only).

## 8. Plugin architecture

```
Plugin Manager
├── Registry        (in-memory manifest + status)
├── Loader          (install / activate / deactivate / uninstall)
├── Validator       (manifest schema, semver, explicit permission list)
├── Permissions     (whitelist: read:products, storage:plugin, ai:request, http:route…)
├── Sandbox         (PluginContext — every call permission-gated)
├── API             (scoped data access, namespaced storage, route registration)
├── Version Manager (semver + dependency resolution)
└── Security Manager (prototype-stripped manifests, deny-by-default)
```

Plugins never receive the db, `process`, request objects, or secrets. Scaling to 4, 8 or 20+ plugins requires only new manifests — no core changes.

## 9. Tests

```bash
cd backend
npm test          # 40 tests: hashing, verification, wrong password, encryption,
                  # tampering, key rotation, register/login/logout, reset flow,
                  # expired tokens, authorization, admin checks, cart/checkout,
                  # validation, plugin permissions, AI guard, plan validation
```

## 10. Frontend pages (multi-page architecture — v2.0)

Real HTML pages, user and admin areas separated:

- **User** — `/` home (3D hero) · `/user/about.html` · `/user/contact.html` (dedicated contact page) · `/user/designs.html` + `/user/design-detail.html?design=formal|3d|3d-animation|interactive` · `/user/pricing.html` · `/user/cart.html` · `/user/payment.html` · `/user/login.html` · `/user/register.html` · `/user/forgot.html` · `/user/dashboard.html` (user account) · `/user/architect.html`
- **Admin** — `/admin/index.html` (dashboard with SVG charts) · `/admin/ai-builder.html` · `/admin/editor.html` (visual canvas editor, admins only)
- Dashboard sections (users, products, orders, payments, pages, designs, projects, plugins, ai, security, settings) switch inside the dashboard via `#section`.
- Legacy `#/route` hash links from the old SPA are auto-redirected by `src/links.js`.

Performance: code-split pages, lazy 3D init, animation/scene disposal on navigation, debounced JSON writes, reduced-motion support, responsive layouts (desktop/laptop/tablet/mobile).

> 📄 Full v2.0 change log (new files, security additions, admin charts): see [CHANGES.md](./CHANGES.md).

## 11. Remaining risks / hardening checklist

- In-memory rate-limit/brute-force state — swap for Redis when running multiple instances.
- JSON store is single-process; use MongoDB in production.
- Add email delivery (SMTP/provider) for password-reset links (dev mode returns the token locally).
- Add a real payment provider (Stripe/PayPal) — see the provider registry in `order.controller.js`.
- Run behind TLS (reverse proxy), set secure cookies (automatic in production mode), and configure CSP for your final asset host.
- Schedule automated off-site backups and test restores.

## 12. npm audit

```bash
cd backend  && npm audit
cd frontend && npm audit
```
