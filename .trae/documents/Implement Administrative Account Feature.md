## Current Architecture (What We’ll Build On)
- Frontend is Vite + React Router with no route guards yet (admin access must be added in routing).
- Backend is Supabase (Postgres + RLS) plus Edge Functions; some admin enforcement already exists via `profiles.is_admin` checks in the `credits` Edge Function.
- Core domain tables already exist for activity metrics (`stories`, `scenes`) and for credit history (`credit_transactions`, `user_credits`).

## Admin Identity Model (Meets “admin/admin + hashed password”)
- Add a dedicated `admin_accounts` table (separate from regular users) with:
  - `username` (unique), `password_hash` (bcrypt via pgcrypto), `is_protected` (true), timestamps.
- Add a `admin_sessions` table for secure session management:
  - `session_id_hash`, `admin_username`, `expires_at`, `csrf_secret`, `created_at`, `last_seen_at`, and optional `ip_hash`/`user_agent_hash`.
- Ensure “cannot be deleted/modified via standard UI” by:
  - Not exposing any UI to edit/delete the `admin` row.
  - Enforcing DB constraints/policies and using only server-side endpoints for any admin account actions.

## Admin Authentication, Middleware, Timeout, Logout
- Create a single Edge Function `api-admin` that implements all `/api/admin/*` endpoints using path routing.
- `/api/admin/login`:
  - Verify `username=admin` + password against `admin_accounts.password_hash`.
  - Issue an httpOnly `admin_session` cookie with strict settings + TTL.
  - Return a CSRF token (derived from `csrf_secret`) for the frontend to send on mutations.
- Admin-only “middleware”:
  - Edge Function validates cookie session and CSRF token for all non-GET admin actions.
  - Frontend adds `RequireAdmin` route guard for UX-only protection.
- Session timeout:
  - Absolute expiration (`expires_at`) + inactivity timeout using `last_seen_at`.
- Logout:
  - `/api/admin/logout` clears cookie + invalidates session record.

## Admin Dashboard UI (Hidden From Regular Users)
- Add admin routes in `App.tsx`:
  - `/admin/login`, `/admin` (dashboard), `/admin/users`, `/admin/users/:id`.
- Implement `RequireAdmin` wrapper:
  - Calls `/api/admin/me` (or `/api/admin/session`) to confirm active session.
  - Redirects to `/admin/login` if not authenticated.
- Update navigation so admin links render only when admin session is active.

## User Management (List + Details + Filters)
- `/api/admin/users`:
  - Server-side pagination, search, sorting.
  - Filters: status, plan type/tier, activity level.
  - Returns combined data:
    - Profile (`public.profiles`) + credits (`public.user_credits`) + activity aggregates from `stories/scenes`.
    - Last login timestamp from `auth.users` via service-role access.
- `/api/admin/users/:id`:
  - Detailed view (created date, last login, current plan/tier, credits, activity metrics).

## Credit Management (Add/Deduct/Set + History + Audit)
- Reuse/extend existing credit system tables:
  - `credit_transactions` already exists; ensure admin actions populate `created_by` + metadata including old/new balances and optional reason.
- Add an `audit_logs` table for all admin actions (beyond credits):
  - `id`, `admin_username`, `action_type`, `target_user_id`, `before`, `after`, `reason`, `created_at`.
- `/api/admin/users/:id/credits`:
  - Supports add/deduct/set.
  - Performs updates via a SECURITY DEFINER RPC that locks the user credit row (`SELECT ... FOR UPDATE`) to prevent concurrent modifications.
  - Writes both `credit_transactions` and `audit_logs` in the same transaction.
- `/api/admin/users/:id/credits/history` (or use `/api/admin/users/:id` to include):
  - Paginated credit transaction history.

## Plan Status Management (Change Tier/Status/Expiration + History)
- Add `plan_history` table:
  - Tracks changes with timestamps, admin username, optional notes, old/new plan fields, and expirations.
- `/api/admin/users/:id/plan`:
  - Upgrade/downgrade, activate/suspend, set custom expiration, apply promo plan.
  - Uses a transaction with row locks on the relevant user row(s).
  - Records to `plan_history` + `audit_logs`.

## Security & Validation
- CSRF:
  - All state-changing admin endpoints require `X-CSRF-Token` matching the server-stored session secret.
- Rate limiting:
  - Add a DB-backed limiter (per admin session + per IP hash) for login and mutations.
- Server-side validation:
  - Validate all inputs in Edge Function using `zod`-style schemas (or minimal manual validation in Deno if avoiding extra deps).
- Confirmation dialogs:
  - Frontend confirmation modals for destructive actions (deduct/set credits, suspend account).
- Authorization:
  - Every admin endpoint checks session validity; no reliance on UI-only guards.

## API Surface (As Requested)
- Implement these paths via the `api-admin` Edge Function router:
  - `POST /api/admin/login`
  - `POST /api/admin/logout`
  - `GET /api/admin/users`
  - `GET /api/admin/users/:id`
  - `PATCH /api/admin/users/:id`
  - `POST /api/admin/users/:id/credits`
  - `POST /api/admin/users/:id/plan`
  - `GET /api/admin/audit-logs`

## Database Schema Updates
- Create:
  - `admin_accounts`, `admin_sessions`, `audit_logs`, `plan_history`.
- Add indexes for pagination/search:
  - e.g., `profiles(created_at)`, `credit_transactions(user_id, created_at)`, `audit_logs(created_at)`, `plan_history(user_id, created_at)`.

## Deployment & Feature Flags
- Admin disabled in development by default:
  - `VITE_ADMIN_UI_ENABLED=false` hides admin routes UI.
  - `ADMIN_API_ENABLED=false` makes Edge Function return 404 for all admin routes.
- Vercel routing:
  - Update `vercel.json` rewrites so `/api/admin/*` proxies to the Supabase Edge Function URL.
- Monitoring:
  - Ensure all admin actions land in `audit_logs` for visibility and alerting.

## Testing Plan
- Unit tests:
  - Admin session validation, CSRF verification, and rate limiter logic (Edge Function tests).
- Integration tests:
  - Credit modification workflows: ensure balances and `credit_transactions/audit_logs` are consistent and idempotent.
- Security tests:
  - Verify regular users cannot access `/api/admin/*` and cannot trigger admin credit/plan changes.
- UI tests:
  - Admin dashboard navigation + responsiveness with Testing Library.
- Load test:
  - Add a Node-based load script using existing `node-fetch` to benchmark `/api/admin/users` pagination.

## Documentation (As Requested)
- Add docs under `docs/`:
  - Admin user manual, API reference (payloads/examples), troubleshooting guide, security best practices.

If you confirm, I’ll implement this end-to-end in the existing Supabase + Edge Function architecture, including schema migrations, admin API, UI, tests, and docs.