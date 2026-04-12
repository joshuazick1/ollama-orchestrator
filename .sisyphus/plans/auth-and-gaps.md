# Multi-Tenant Auth + Operational Gap Fixes

## TL;DR

> **Quick Summary**: Add user authentication with per-user server/model access scoping, fix 4 operational gaps (admin route auth, metrics loss, probe pollution, ban jitter), and add config import/export.
>
> **Deliverables**:
> - User auth system: SQLite UserStore, bcrypt passwords, JWT httpOnly cookies, login/logout/refresh endpoints
> - Frontend auth: LoginPage, AuthContext, ProtectedRoute, Users tab in Settings
> - Per-user scoping: LoadBalancer filtering by user's allowed servers/models
> - Operational fixes: auth on admin routes, probe filtering, batch flush, ban decay, config import/export
>
> **Estimated Effort**: XL (50+ tasks across 5 waves)
> **Parallel Execution**: YES — 5 waves
> **Critical Path**: Schema → UserStore → JWT → Auth routes → Inference auth → Frontend auth → User scoping → Integration

---

## Context

### Original Request
Add user authentication to the ollama orchestrator frontend, with per-user limitations on which servers/models are accessible. Also address all identified operational gaps.

### Interview Summary
**Key Decisions**:
- Token storage: httpOnly cookie (more secure, requires CSRF protection)
- Inference endpoints: YES, require auth
- Default admin: Auto-created from ADMIN_USERNAME + ADMIN_PASSWORD env vars on startup
- Model access: Exact model name match (no glob/regex)
- Auth toggle: ORCHESTRATOR_AUTH_ENABLED env var (default false = dev mode, wide open)

### Metis Review
**Identified Gaps (addressed)**:
- Concurrent admin edits: SQLite UNIQUE constraints + atomic operations handle this
- Orphaned sessions: JWT validation checks user.is_active before allowing requests
- JWT secret validation: Refuse to start if JWT_SECRET env var is missing or < 32 chars
- Migration atomicity: Schema v4 is additive-only (new tables, no column deletions)
- Backward compat: Existing API key auth continues working alongside JWT during transition

**Auto-Resolved**:
- AdaptiveWeightTuner DOES call updateConfig() (line 215) — NOT a gap, removed from scope

---

## Work Objectives

### Core Objective
Add multi-tenant user authentication with per-user server/model access restrictions, and fix 4 operational gaps in the orchestrator.

### Concrete Deliverables
- `src/storage/schema.ts` — SCHEMA_V4 with users, user_server_access, user_model_access tables
- `src/storage/user-store.ts` — New UserStore class with CRUD, bcrypt hashing, access management
- `src/middleware/auth.ts` — Updated to validate JWT cookies + user DB + API keys
- `src/routes/auth.routes.ts` — New auth routes: login, logout, refresh, user CRUD
- `src/controllers/user-controller.ts` — User management controller
- `src/routes/admin.routes.ts` — requireAuth applied to all admin routes
- `src/routes/monitoring.routes.ts` — requireAuth on monitoring routes (except /metrics, /health)
- `src/routes/inference.routes.ts` — requireAuth on inference routes
- `src/routes/v1.routes.ts` — requireAuth on v1 routes
- `src/load-balancer/load-balancer.ts` — Candidate filtering by user access
- `frontend/src/contexts/AuthContext.tsx` — New AuthContext + useAuth hook
- `frontend/src/components/ProtectedRoute.tsx` — Route guard component
- `frontend/src/pages/LoginPage.tsx` — Login form + auth disabled bypass
- `frontend/src/pages/settings/UsersTab.tsx` — User management UI
- `frontend/src/pages/settings/ConfigImportExport.tsx` — Config download/upload
- `src/utils/ban-manager.ts` — Failure count decay (jitter)
- `src/analytics/analytics-engine.ts` — Filter is_probe from queries
- `src/metrics/metrics-persistence.ts` — Reduced flush interval + sync shutdown
- `src/config/config-manager.ts` — Config import/export API

### Definition of Done
- [ ] `ORCHESTRATOR_AUTH_ENABLED=false` → inference returns 200 without any auth
- [ ] `ORCHESTRATOR_AUTH_ENABLED=true` + no JWT → inference returns 401
- [ ] Valid JWT + user with model access → inference returns 200
- [ ] Valid JWT + user WITHOUT model access → inference returns 403
- [ ] Login with correct credentials → JWT cookie set, redirect to app
- [ ] Login with wrong password → 401, no cookie
- [ ] Admin creates new user → user can login
- [ ] Admin deletes user → user cannot login, sessions invalidated
- [ ] ADMIN_USERNAME/PASSWORD creates admin on startup if no admins exist
- [ ] Admin routes return 401 without valid admin JWT
- [ ] is_probe=true requests excluded from analytics
- [ ] After crash, buffered metrics flushed to disk
- [ ] After idle period, temporary bans auto-expire
- [ ] Config export produces valid JSON; import restores config

### Must Have
- All inference/admin routes protected when auth enabled
- httpOnly cookie JWT with CSRF protection (SameSite=Strict)
- bcrypt password hashing with configurable rounds
- Per-user server/model allowlist filtering in LoadBalancer
- Admin users bypass all scoping restrictions
- Graceful degradation: if SQLite is unavailable, inference continues
- Default admin from env vars on first startup

### Must NOT Have (Guardrails)
- **No password reset flow** — admin creates/-resets passwords only
- **No OAuth/SAML** — local users only
- **No user profile pages** — name/role/password only
- **No per-user rate limiting** — global rate limits apply
- **No config encryption** — import/export is plain JSON
- **No API key management UI** — CLI-only for key rotation
- **No multi-org/tenant isolation** — single organization
- **No LDAP/AD integration**
- **No MFA/2FA**
- **No user activity dashboard**
- **No email notifications**
- **No backward migration** — schema v4 is additive only

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES
- **Automated tests**: YES (tests-after for auth, TDD for logic)
- **Framework**: bun test + Playwright

### QA Policy
Every task includes agent-executed QA scenarios. Evidence saved to `.sisyphus/evidence/`.

**Backend**: Bash (curl) — Send requests, assert status + response fields
**Frontend**: Playwright — Navigate, interact, assert DOM, screenshot
**Unit**: Bash (bun test) — Import modules, call functions, compare output

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — schema, store, auth middleware wiring):
├── Task 1: Schema v4 migration (users, user_server_access, user_model_access) [quick]
├── Task 2: UserStore class (CRUD, bcrypt, access management) [deep]
└── Task 3: Wire requireAuth/requireAdmin to all admin routes [quick]

Wave 2 (Backend auth flow — JWT, auth routes, inference protection):
├── Task 4: JWT implementation (sign/verify, httpOnly cookie, refresh) [deep]
├── Task 5: Auth routes (login, logout, refresh, user CRUD) [deep]
├── Task 6: Auth on inference routes (/api/*, /v1/*, /anthropic/*) [deep]
└── Task 7: Default admin from env vars on startup [deep]

Wave 3 (Frontend auth UI — context, login, settings):
├── Task 8: AuthContext + ProtectedRoute component [visual-engineering]
├── Task 9: LoginPage (form + auth disabled bypass) [visual-engineering]
├── Task 10: Users tab in Settings (list, add, edit, delete, roles, access) [visual-engineering]
└── Task 11: Config import/export UI in Settings [visual-engineering]

Wave 4 (User scoping + operational fixes):
├── Task 12: LoadBalancer user scoping filter [deep]
├── Task 13: Filter is_probe from analytics + metrics aggregations [quick]
├── Task 14: Metrics batch flush reduction + sync on shutdown [deep]
└── Task 15: BanManager failure count decay [deep]

Wave 5 (Integration + final):
├── Task 16: CSRF protection (SameSite=Strict cookie) [deep]
└── Task 17: End-to-end smoke tests (Playwright) [unspecified-high]

Critical Path: 1 → 2 → 4 → 5 → 6 → 8 → 9 → 10 → 12 → 17
Max Parallel per Wave: 4-4 tasks (Waves 2 and 3)
```

### Dependency Matrix

| Task | Depends | Blocks |
|------|---------|--------|
| 1 (Schema v4) | — | 2, 3, 7 |
| 2 (UserStore) | 1 | 3, 4, 5, 7, 12 |
| 3 (Wire auth) | 1 | 5 |
| 4 (JWT) | 2 | 5, 6, 12 |
| 5 (Auth routes) | 3, 4 | 6, 8, 16 |
| 6 (Inference auth) | 4, 5 | 12 |
| 7 (Default admin) | 1, 2 | — |
| 8 (AuthContext) | 5 | 9, 10 |
| 9 (LoginPage) | 8 | — |
| 10 (Users tab) | 8 | — |
| 11 (Config imp/exp) | — | — |
| 12 (LB scoping) | 2, 6 | — |
| 13 (Probe filter) | — | — |
| 14 (Batch flush) | — | — |
| 15 (Ban decay) | — | — |
| 16 (CSRF) | 5 | — |
| 17 (E2E tests) | 1-16 | — |

---

## TODOs

- [x] 1. Schema v4 Migration

  **What to do**:
  - Add `SCHEMA_V4_MIGRATION` to `src/storage/schema.ts` with three new tables:
    - `users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', api_key TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_login_at INTEGER, is_active INTEGER NOT NULL DEFAULT 1)`
    - `user_server_access(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, server_id TEXT NOT NULL, UNIQUE(user_id, server_id))`
    - `user_model_access(id INTEGER PRIMARY KEY, user_id TEXT NOT NULL, server_id TEXT NOT NULL, model TEXT NOT NULL, UNIQUE(user_id, server_id, model))`
  - Add indexes: `idx_users_username`, `idx_users_email`, `idx_user_server_access_user`, `idx_user_model_access_user`
  - Add migration `MIGRATIONS[4] = SCHEMA_V4_MIGRATION`
  - Bump `CURRENT_SCHEMA_VERSION` to 4
  - Add `UserRow`, `UserServerAccessRow`, `UserModelAccessRow` types to `src/storage/types.ts`
  - Add `applyUserSchema()` helper if needed (or integrate into existing `applySchema()`)

  **Must NOT do**:
  - Do NOT modify any existing tables or columns
  - Do NOT delete any existing data
  - Do NOT add migrations that depend on existing user data

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: SQLite schema changes require careful migration logic
  - **Skills**: []
    - `sqlite-migrations`: Schema versioning patterns

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 2, 3, 7
  - **Blocked By**: None

  **References**:
  - `src/storage/schema.ts` — Existing migration pattern, CURRENT_SCHEMA_VERSION = 3, MIGRATIONS record
  - `src/storage/types.ts` — Existing row type definitions for reference
  - `src/storage/operational-store.ts:runStartupMigrations()` — How JSON→SQLite migrations run

  **Acceptance Criteria**:
  - [ ] `CURRENT_SCHEMA_VERSION === 4` in schema.ts
  - [ ] `MIGRATIONS[4]` exists and equals SCHEMA_V4_MIGRATION
  - [ ] `sqlite3 data/orchestrator.db ".schema"` shows users, user_server_access, user_model_access tables
  - [ ] `SELECT * FROM users` returns empty (no default users)

  **QA Scenarios**:

  Scenario: Fresh database schema creation
    Tool: Bash
    Preconditions: No existing database
    Steps:
      1. `rm -f /tmp/test-auth.db`
      2. Apply schema: `cd /root/ollama-orchestrator && node -e "
        const { Database } = require('better-sqlite3');
        const db = new Database('/tmp/test-auth.db');
        const schema = require('./src/storage/schema');
        schema.applySchema(db);
        console.log('Schema applied, version:', db.pragma('user_version', { simple: true }));
        console.log('Tables:', db.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all());
      "`
    Expected Result: user_version = 4, tables include users, user_server_access, user_model_access
    Evidence: .sisyphus/evidence/task-1-schema-create.log

  Scenario: Existing database migrates cleanly to v4
    Tool: Bash
    Preconditions: Existing v3 schema with data
    Steps:
      1. Create test db with v3 schema
      2. Apply migrations
      3. Verify new tables exist AND existing data intact
    Expected Result: All existing tables preserved, new tables created
    Evidence: .sisyphus/evidence/task-1-schema-migrate.log

- [x] 2. UserStore Class

  **What to do**:
  - Create `src/storage/user-store.ts` with singleton UserStore class
  - CRUD operations:
    - `createUser(username, email, password, role)` — hash password with bcrypt (12 rounds), insert, return user (no hash)
    - `getUserById(id)` / `getUserByUsername(username)` / `getUserByEmail(email)` / `getUserByApiKey(key)`
    - `validatePassword(user, password)` — bcrypt compare
    - `updateUser(id, updates)` — update fields, re-hash password if changed
    - `deleteUser(id)` — soft delete (is_active = 0) OR hard delete
    - `listUsers()` — all active users
    - `listUsersByRole(role)` — filter by admin/user
    - `generateApiKey(userId)` — generate random API key, store hash
    - `revokeApiKey(userId)` — clear api_key field
  - Access management:
    - `grantServerAccess(userId, serverId)` / `revokeServerAccess(userId, serverId)` / `listServerAccess(userId)`
    - `grantModelAccess(userId, serverId, model)` / `revokeModelAccess(userId, serverId, model)` / `listModelAccess(userId)`
    - `hasServerAccess(userId, serverId)` — returns boolean
    - `hasModelAccess(userId, serverId, model)` — returns boolean (exact match)
    - `clearUserAccess(userId)` — remove all access for user
  - Session invalidation:
    - `invalidateUserSessions(userId)` — called when user is deleted/deactivated
  - Use OperationalStore pattern (singleton, WAL mode, prepared statements)
  - Import bcrypt (install if needed — verify it's in package.json first)

  **Must NOT do**:
  - Do NOT store plaintext passwords (must bcrypt hash)
  - Do NOT return password_hash in any public method
  - Do NOT allow listing all users' password hashes (obviously)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: UserStore is the core data layer for auth — must be correct
  - **Skills**: [`auth-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 3, 4, 5, 7
  - **Blocked By**: Task 1 (schema must exist first)

  **References**:
  - `src/storage/operational-store.ts` — Singleton pattern, prepared statements, WAL mode
  - `src/storage/types.ts` — Row type pattern
  - `src/storage/schema.ts` — UserRow type will be added in Task 1

  **Acceptance Criteria**:
  - [ ] `createUser('admin', 'admin@test.com', 'password123', 'admin')` creates user with bcrypt hash
  - [ ] `validatePassword(user, 'password123')` returns true
  - [ ] `validatePassword(user, 'wrong')` returns false
  - [ ] `grantServerAccess(user.id, 'server-1')` creates access row
  - [ ] `hasModelAccess(user.id, 'server-1', 'llama3')` returns true after grant
  - [ ] `listUsers()` returns only is_active=1 users

  **QA Scenarios**:

  Scenario: Create user with hashed password
    Tool: Bash
    Preconditions: Schema v4 applied, UserStore initialized
    Steps:
      1. `cd /root/ollama-orchestrator && node -e "
        const { getUserStore } = require('./src/storage/user-store');
        const store = getUserStore();
        const user = store.createUser('testuser', 'test@test.com', 'secret123', 'user');
        console.log('Created:', user.username, '| hash length:', user.password_hash.length);
        console.log('Validate correct:', store.validatePassword(user, 'secret123'));
        console.log('Validate wrong:', store.validatePassword(user, 'wrongpass'));
      "`
    Expected Result: Hash is 60 chars (bcrypt), correct password passes, wrong fails
    Evidence: .sisyphus/evidence/task-2-create-user.log

  Scenario: Server and model access management
    Tool: Bash
    Preconditions: User created
    Steps:
      1. Grant server access, verify
      2. Grant model access, verify exact match
      3. Revoke model access, verify denied
    Expected Result: Access checks return correct booleans
    Evidence: .sisyphus/evidence/task-2-access-mgmt.log

  Scenario: API key generation
    Tool: Bash
    Preconditions: User created
    Steps:
      1. `const store = getUserStore(); const key = store.generateApiKey(user.id);`
      2. Verify key is returned and `getUserByApiKey(key)` finds the user
    Expected Result: Key is random, retrievable by hash lookup
    Evidence: .sisyphus/evidence/task-2-api-key.log

- [x] 3. Wire Auth Middleware to Admin Routes

  **What to do**:
  - Read all route files: `admin.routes.ts`, `monitoring.routes.ts`, `inference.routes.ts`, `v1.routes.ts`, `anthropic.routes.ts`
  - Apply `requireAuth` middleware to ALL routes in `admin.routes.ts` (server management, bans, config, recovery failures)
  - Apply `requireAdmin` middleware to routes that modify state in `admin.routes.ts` (add/delete/reset/force operations)
  - Apply `requireAuth` to monitoring routes that expose sensitive data (analytics, logs) — NOT /metrics and /health
  - Apply `requireAuth` to inference routes: `/api/generate`, `/api/chat`, `/api/embeddings`, `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings`, `/messages`
  - Keep `/api/tags`, `/api/ps`, `/api/version`, `/health`, `/metrics`, `/api/orchestrator/health`, `/api/orchestrator/stats` publicly accessible
  - For `inference.routes.ts`: add `optionalAuth` to GET endpoints (tags, ps) — attaches user if token present but doesn't require it; add `requireAuth` to POST endpoints
  - Verify all routes compile correctly after changes
  - Add a comment above each route showing its auth requirement

  **Must NOT do**:
  - Do NOT change any route paths or handler logic
  - Do NOT add auth to `/metrics` or `/health` (Prometheus needs /metrics)
  - Do NOT add auth to Ollama-compatible GET endpoints that are purely informational

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical middleware additions to existing routes
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Task 5
  - **Blocked By**: Task 1 (schema needed for auth flow)

  **References**:
  - `src/routes/admin.routes.ts` — All admin route definitions
  - `src/routes/monitoring.routes.ts` — All monitoring route definitions
  - `src/routes/inference.routes.ts` — All inference route definitions
  - `src/routes/v1.routes.ts` — All OpenAI-compatible route definitions
  - `src/routes/anthropic.routes.ts` — Anthropic routes
  - `src/middleware/auth.ts` — requireAuth, requireAdmin, optionalAuth signatures

  **Acceptance Criteria**:
  - [ ] `curl -X POST /api/orchestrator/servers/add` without auth returns 401
  - [ ] `curl -X GET /api/orchestrator/servers` without auth returns 401
  - [ ] `curl -X GET /metrics` without auth returns 200 (Prometheus unaffected)
  - [ ] `curl -X GET /api/orchestrator/analytics/top-models` without auth returns 401

  **QA Scenarios**:

  Scenario: Admin routes reject unauthenticated requests
    Tool: Bash
    Preconditions: Orchestrator running, auth enabled
    Steps:
      1. `curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/api/orchestrator/servers`
      2. `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5100/api/orchestrator/config`
      3. `curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/api/orchestrator/analytics/top-models`
    Expected Result: All return 401
    Evidence: .sisyphus/evidence/task-3-admin-401.log

  Scenario: Public endpoints remain accessible
    Tool: Bash
    Preconditions: Orchestrator running
    Steps:
      1. `curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/metrics`
      2. `curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/health`
      3. `curl -s -o /dev/null -w "%{http_code}" http://localhost:5100/api/tags`
    Expected Result: All return 200
    Evidence: .sisyphus/evidence/task-3-public-200.log

- [x] 4. JWT Implementation

  **What to do**:
  - Create `src/utils/jwt.ts` with JWT utilities:
    - `signToken(userId, role, expiresIn)` — signs JWT with HMAC-SHA256, payload: { userId, role, iat, exp }
    - `verifyToken(token)` — verifies and returns payload or throws
    - `getTokenFromCookie(request)` — extracts JWT from httpOnly cookie
    - `setTokenCookie(response, token, maxAge)` — sets httpOnly, SameSite=Strict, Secure cookie
    - `clearTokenCookie(response)` — sets cookie with maxAge=0
    - `generateRefreshToken(userId)` — separate refresh token (7d expiry), stored in DB or just signed differently
  - Token payload: `{ userId: string, role: 'admin'|'user', type: 'access'|'refresh', iat: number, exp: number }`
  - Use `jsonwebtoken` package (check if installed, install if not)
  - Validate `JWT_SECRET` env var on startup — reject if < 32 chars or missing
  - Access token expiry: 15 minutes
  - Refresh token expiry: 7 days
  - Refresh token stored in DB (user record has `refresh_token_hash` field or separate `refresh_tokens` table — simplest: add `refresh_token_hash` to users table)

  **Must NOT do**:
  - Do NOT store JWT secret in code — must come from env var
  - Do NOT use asymmetric keys (RS256) unless needed — HMAC-SHA256 (HS256) is fine for single-service
  - Do NOT put password_hash or sensitive data in JWT payload

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: JWT security is critical — must be implemented correctly
  - **Skills**: [`auth-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 2

  **References**:
  - `src/middleware/auth.ts` — Current auth middleware for reference
  - `src/storage/user-store.ts` — UserStore from Task 2
  - `src/routes/auth.routes.ts` — Will use these JWT utilities

  **Acceptance Criteria**:
  - [ ] `signToken('user-123', 'user', '15m')` returns a valid JWT string
  - [ ] `verifyToken(validToken)` returns { userId, role }
  - [ ] `verifyToken(tamperedToken)` throws error
  - [ ] `verifyToken(expiredToken)` throws error
  - [ ] Cookie set with httpOnly, SameSite=Strict, Secure

  **QA Scenarios**:

  Scenario: JWT sign and verify roundtrip
    Tool: Bash
    Preconditions: Node.js REPL
    Steps:
      1. `cd /root/ollama-orchestrator && node -e "
        process.env.JWT_SECRET = 'test-secret-key-that-is-at-least-32-chars!!';
        const { signToken, verifyToken } = require('./src/utils/jwt');
        const token = signToken('user-123', 'admin', '15m');
        console.log('Token:', token.substring(0, 50) + '...');
        const payload = verifyToken(token);
        console.log('Payload:', JSON.stringify(payload));
      "`
    Expected Result: Token is valid JWT, payload.userId='user-123', payload.role='admin'
    Evidence: .sisyphus/evidence/task-4-jwt-sign-verify.log

  Scenario: Expired and tampered tokens rejected
    Tool: Bash
    Preconditions: JWT utilities loaded
    Steps:
      1. Create token with 1ms expiry, wait 2ms, verify → should throw
      2. Modify last character of token, verify → should throw
    Expected Result: Both throw specific errors
    Evidence: .sisyphus/evidence/task-4-jwt-rejection.log

  Scenario: Cookie roundtrip
    Tool: Bash
    Preconditions: Mock Express response object
    Steps:
      1. `const { setTokenCookie, getTokenFromCookie } = require('./src/utils/jwt');`
      2. Create mock req/res, set cookie, extract → verify token matches
    Expected Result: Cookie is httpOnly, SameSite=Strict
    Evidence: .sisyphus/evidence/task-4-cookie.log

- [x] 5. Auth Routes (login, logout, refresh, user CRUD)

  **What to do**:
  - Create `src/routes/auth.routes.ts`:
    - `POST /auth/login` — validate email+password against UserStore, generate access+refresh tokens, set cookies, return user info (no password)
    - `POST /auth/logout` — clear cookies, optionally invalidate refresh token in DB
    - `POST /auth/refresh` — accept refresh token cookie, verify, issue new access token cookie
    - `GET /auth/me` — return current user info (requires access token)
  - Create `src/routes/user.routes.ts` (admin-only):
    - `GET /users` — list all users (admin only)
    - `POST /users` — create user (admin only): `{ username, email, password, role }`
    - `GET /users/:id` — get user by id (admin or self)
    - `PUT /users/:id` — update user (admin or self for password, admin for role)
    - `DELETE /users/:id` — delete/deactivate user (admin only)
    - `POST /users/:id/access/server` — grant server access (admin or self with admin override)
    - `DELETE /users/:id/access/server/:serverId` — revoke server access
    - `POST /users/:id/access/model` — grant model access
    - `DELETE /users/:id/access/model/:serverId/:model` — revoke model access
    - `GET /users/:id/access` — list all access for user
    - `POST /users/:id/rotate-api-key` — regenerate API key
  - Register routes in `src/routes/orchestrator.ts` barrel file
  - All routes return proper HTTP status codes: 200, 201, 400, 401, 403, 404
  - Zod validation on all POST/PUT bodies

  **Must NOT do**:
  - Do NOT allow non-admin users to create other admins
  - Do NOT allow non-admin users to modify their own role
  - Do NOT return password_hash in any response
  - Do NOT allow user to grant more access than they themselves have (admin bypass)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Auth routes are the primary attack surface — must be correct
  - **Skills**: [`auth-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 6, 7)
  - **Blocks**: Tasks 8, 16
  - **Blocked By**: Tasks 3, 4

  **References**:
  - `src/routes/admin.routes.ts` — Route registration pattern
  - `src/middleware/auth.ts` — requireAuth, requireAdmin middleware
  - `src/middleware/validation.ts` — Zod validation pattern
  - `src/storage/user-store.ts` — UserStore from Task 2
  - `src/utils/jwt.ts` — JWT utilities from Task 4

  **Acceptance Criteria**:
  - [ ] `POST /auth/login` with valid creds returns 200 + sets cookies + user info
  - [ ] `POST /auth/login` with invalid creds returns 401 + no cookies
  - [ ] `POST /auth/logout` clears cookies
  - [ ] `POST /auth/refresh` with valid refresh token returns new access cookie
  - [ ] `GET /users` without admin token returns 403
  - [ ] `POST /users` by admin creates user
  - [ ] `DELETE /users/:id` by admin deactivates user

  **QA Scenarios**:

  Scenario: Full login/logout/refresh cycle
    Tool: Bash
    Preconditions: Default admin created (Task 7), orchestrator running
    Steps:
      1. `curl -s -c /tmp/cookies.txt -X POST http://localhost:5100/auth/login -H "Content-Type: application/json" -d '{"email":"admin@test.com","password":"adminpassword"}'`
      2. Check cookies saved
      3. `curl -s -b /tmp/cookies.txt http://localhost:5100/auth/me`
      4. `curl -s -b /tmp/cookies.txt -X POST http://localhost:5100/auth/refresh`
      5. `curl -s -b /tmp/cookies.txt -X POST http://localhost:5100/auth/logout`
    Expected Result: Login returns user info, me returns user, refresh returns new cookie, logout clears
    Evidence: .sisyphus/evidence/task-5-auth-cycle.log

  Scenario: Non-admin cannot access user management
    Tool: Bash
    Preconditions: Non-admin user created, logged in as non-admin
    Steps:
      1. Login as non-admin user
      2. `curl -s -b cookies.txt http://localhost:5100/users` → expect 403
      3. `curl -s -b cookies.txt -X POST http://localhost:5100/users -d '{"username":"hacker","email":"h@h.com","password":"x","role":"admin"}'` → expect 403
    Expected Result: Both return 403 Forbidden
    Evidence: .sisyphus/evidence/task-5-nonadmin-blocked.log

- [x] 6. Auth on Inference Routes

  **What to do**:
  - Update `src/routes/inference.routes.ts`:
    - `POST /api/generate` — add `requireAuth`
    - `POST /api/chat` — add `requireAuth`
    - `POST /api/embeddings` — add `requireAuth`
    - `GET /api/tags` — keep public (used by health checks and LB)
    - `GET /api/ps` — keep public (informational)
    - `GET /api/version` — keep public
    - Direct routes (`/api/generate--:serverId`, etc.) — also require auth
  - Update `src/routes/v1.routes.ts`:
    - `POST /v1/chat/completions` — add `requireAuth`
    - `POST /v1/completions` — add `requireAuth`
    - `POST /v1/embeddings` — add `requireAuth`
    - `GET /v1/models` — keep public (informational)
    - Direct routes — also require auth
  - Update `src/routes/anthropic.routes.ts`:
    - `POST /messages` — add `requireAuth`
  - When auth is DISABLED (`ORCHESTRATOR_AUTH_ENABLED=false`): skip auth middleware entirely on inference routes (no 401)
  - Auth check in middleware: if `ORCHESTRATOR_AUTH_ENABLED=false`, call `next()` immediately for inference routes
  - After auth succeeds, attach `user` and `userAccess` (hasServerAccess, hasModelAccess) to `req` for downstream use

  **Must NOT do**:
  - Do NOT change request/response shapes of any inference endpoint
  - Do NOT add auth to GET endpoints that are informational

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Affects all inference traffic
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 7)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 4, 5

  **References**:
  - `src/routes/inference.routes.ts` — Inference routes
  - `src/routes/v1.routes.ts` — OpenAI-compatible routes
  - `src/routes/anthropic.routes.ts` — Anthropic routes
  - `src/middleware/auth.ts` — Auth middleware with ORCHESTRATOR_AUTH_ENABLED check

  **Acceptance Criteria**:
  - [ ] `POST /api/generate` without auth when enabled → 401
  - [ ] `POST /api/generate` without auth when disabled (ORCHESTRATOR_AUTH_ENABLED=false) → 200
  - [ ] `GET /api/tags` without auth → 200 (always)
  - [ ] `POST /v1/chat/completions` without auth → 401

  **QA Scenarios**:

  Scenario: Inference requires auth when enabled
    Tool: Bash
    Preconditions: Auth enabled, no cookies
    Steps:
      1. `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5100/api/generate -H "Content-Type: application/json" -d '{"model":"llama3","prompt":"hi"}'`
      2. `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5100/v1/chat/completions -H "Content-Type: application/json" -d '{"model":"llama3","messages":[{"role":"user","content":"hi"}]}'`
    Expected Result: Both return 401
    Evidence: .sisyphus/evidence/task-6-inference-401.log

  Scenario: Inference open when auth disabled
    Tool: Bash
    Preconditions: ORCHESTRATOR_AUTH_ENABLED=false, orchestrator restarted
    Steps:
      1. `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5100/api/generate -H "Content-Type: application/json" -d '{"model":"llama3","prompt":"hi"}'`
    Expected Result: Returns 200 (no auth required)
    Evidence: .sisyphus/evidence/task-6-inference-open.log

- [x] 7. Default Admin from Env Vars

  **What to do**:
  - In `src/orchestrator/orchestrator-instance.ts` (or `src/index.ts`), after schema migration and store initialization:
    - Check if any admin users exist: `getUserStore().listUsersByRole('admin')`
    - If no admins exist AND `ADMIN_USERNAME` + `ADMIN_PASSWORD` env vars are set:
      - Create admin user: `getUserStore().createUser(ADMIN_USERNAME, '${ADMIN_USERNAME}@local', ADMIN_PASSWORD, 'admin')`
      - Log the creation: `logger.info('Default admin user created from env vars')`
    - If no admins exist AND env vars NOT set:
      - Log a FATAL warning: `logger.error('No admin users exist and ADMIN_USERNAME/ADMIN_PASSWORD not set. Cannot start.')`
      - Exit process: `process.exit(1)` with code 1
    - If admins exist: continue normally (env vars are ignored if admin already exists)
  - Validate `ADMIN_USERNAME` format (non-empty, no @ unless intended for email)
  - Validate `ADMIN_PASSWORD` minimum length (8 chars) — if too short, exit with error
  - Log admin creation (not the password) for audit trail
  - This runs during `getOrchestratorInstance()` before any servers start accepting traffic

  **Must NOT do**:
  - Do NOT create admin if any admin already exists (idempotent)
  - Do NOT use default password if env var not set — must fail loudly
  - Do NOT log the password

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Startup security — must fail clearly if misconfigured
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5, 6)
  - **Blocks**: None
  - **Blocked By**: Tasks 1, 2

  **References**:
  - `src/orchestrator/orchestrator-instance.ts` — Orchestrator initialization
  - `src/index.ts` — App entry point
  - `src/storage/user-store.ts` — UserStore from Task 2

  **Acceptance Criteria**:
  - [ ] Fresh DB + ADMIN_USERNAME + ADMIN_PASSWORD → admin created, startup succeeds
  - [ ] Fresh DB + missing ADMIN_USERNAME → process.exit(1) with clear error
  - [ ] Fresh DB + ADMIN_PASSWORD < 8 chars → process.exit(1) with password too short error
  - [ ] Existing DB with admin → startup succeeds, env vars ignored
  - [ ] `GET /auth/me` with admin credentials → returns admin user info

  **QA Scenarios**:

  Scenario: Fresh DB creates admin from env vars
    Tool: Bash
    Preconditions: Fresh database, env vars set
    Steps:
      1. `rm -f data/orchestrator.db && ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpassword123 node dist/index.js &`
      2. Wait 3s, check logs for "Default admin user created"
      3. `curl -s -X POST http://localhost:5100/auth/login -H "Content-Type: application/json" -d '{"email":"admin@local","password":"adminpassword123"}'`
    Expected Result: Admin created, login succeeds
    Evidence: .sisyphus/evidence/task-7-admin-created.log

  Scenario: Missing env vars causes fatal exit
    Tool: Bash
    Preconditions: Fresh database, no env vars
    Steps:
      1. `rm -f data/orchestrator.db && node dist/index.js 2>&1 | head -20`
    Expected Result: Process exits with code 1 and "ADMIN_USERNAME/ADMIN_PASSWORD not set" error
    Evidence: .sisyphus/evidence/task-7-missing-env.log

- [x] 8. AuthContext + ProtectedRoute

  **What to do**:
  - Create `frontend/src/contexts/AuthContext.tsx`:
    - Context value: `{ user, isAuthenticated, isLoading, login(email, password), logout(), refreshToken() }`
    - `login()`: POST /auth/login, store tokens in httpOnly cookies (handled by backend), set user state
    - `logout()`: POST /auth/logout, clear user state
    - `refreshToken()`: POST /auth/refresh, called on 401 interceptors
    - `isLoading`: true while checking existing session (on app load)
    - `isAuthenticated`: true when user is set
    - On mount: call GET /auth/me to restore session from cookie
    - If /auth/me returns 401: set isAuthenticated=false, user=null
  - Create `frontend/src/components/ProtectedRoute.tsx`:
    - Props: `children`, `adminOnly?: boolean`
    - If `isLoading`: show loading spinner (use existing skeleton pattern)
    - If `!isAuthenticated`: redirect to /login
    - If `adminOnly && user?.role !== 'admin'`: redirect to / or show 403
    - Otherwise: render children
  - Create `frontend/src/hooks/useAuth.ts` — thin wrapper around `useContext(AuthContext)`
  - Update `frontend/src/App.tsx`:
    - Wrap app in `<AuthProvider>`
    - Add `/login` route BEFORE other routes
    - Wrap protected routes in `<ProtectedRoute>`: Dashboard, Servers, Models, Analytics, CircuitBreakers, Logs, Settings, InFlight
    - Keep `/login` unprotected
  - Update `frontend/src/components/Layout.tsx`:
    - If `!isAuthenticated`: redirect to /login (or show minimal nav)
    - Conditionally render nav items based on `user?.role`
  - Update `frontend/src/api.ts`:
    - Response interceptor: if status === 401, call `logout()` and redirect to /login
    - Request interceptor: cookies are automatic with httpOnly, but if using Authorization header: inject Bearer token from cookie
    - Actually: httpOnly cookies mean browser sends automatically — just need 401 handler

  **Must NOT do**:
  - Do NOT store JWT in localStorage (use httpOnly cookies)
  - Do NOT render protected content while isLoading=true
  - Do NOT redirect to /login when already on /login (infinite loop)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: React context and routing changes
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 10, 11)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Task 5

  **References**:
  - `frontend/src/App.tsx` — Existing route structure
  - `frontend/src/components/Layout.tsx` — Existing layout with nav
  - `frontend/src/api.ts` — Axios interceptors
  - `frontend/src/pages/settings/index.tsx` — Settings page structure

  **Acceptance Criteria**:
  - [ ] Unauthenticated user visiting / → redirected to /login
  - [ ] Authenticated user visiting / → redirected to Dashboard
  - [ ] Login with valid creds → redirected to app
  - [ ] API 401 → logout called, redirect to /login
  - [ ] Non-admin user visiting /settings → allowed (can see their own settings)
  - [ ] Admin-only routes protected from non-admin

  **QA Scenarios**:

  Scenario: Unauthenticated redirect
    Tool: Playwright
    Preconditions: No auth cookies, app loaded
    Steps:
      1. Open http://localhost:3000 (or frontend dev server)
      2. Verify current URL is /login
    Expected Result: Redirected from / to /login
    Evidence: .sisyphus/evidence/task-8-redirect.png

  Scenario: Login flow
    Tool: Playwright
    Preconditions: On /login page
    Steps:
      1. Fill email: "admin@local"
      2. Fill password: "adminpassword123"
      3. Click login button
      4. Verify URL changes from /login to /
      5. Verify Dashboard content is visible
    Expected Result: Login succeeds, redirected to app
    Evidence: .sisyphus/evidence/task-8-login-flow.png

  Scenario: 401 triggers logout
    Tool: Playwright
    Preconditions: Logged in, session expired on backend
    Steps:
      1. Make API call that returns 401
      2. Verify logout called
      3. Verify redirected to /login
    Expected Result: Automatic logout + redirect
    Evidence: .sisyphus/evidence/task-8-401-logout.png

- [x] 9. LoginPage

  **What to do**:
  - Create `frontend/src/pages/LoginPage.tsx`:
    - Full-page centered form: email + password inputs, login button
    - Show error message on failed login (from API error)
    - Show loading state on submit (button disabled, spinner)
    - Logo/brand at top (reuse existing branding)
    - When `ORCHESTRATOR_AUTH_ENABLED=false`: show "Development Mode — Auth Disabled" banner + "Continue to Dashboard" link that goes to /
    - When `ORCHESTRATOR_AUTH_ENABLED=true`: show normal login form
    - How to check: make a lightweight request (GET /api/orchestrator/health or GET /auth/me) — if it returns without 401, auth might be disabled; OR check a frontend env var
    - Actually: just always show the login form, and add a "Continue without auth" link when in dev mode
    - Better: call GET /api/orchestrator/config first to check security settings (or add a `/auth/status` endpoint that returns { authEnabled: boolean })
    - Add "Forgot password?" link that says "Contact your administrator" (no reset flow)
  - Style consistently with existing dashboard (dark theme, same card styles)
  - On successful login: redirect to intended URL (from `useLocation` state) or `/`
  - On failed login: show inline error below form

  **Must NOT do**:
  - Do NOT implement password reset (admin resets only)
  - Do NOT store credentials in localStorage

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: New page component with form
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 10, 11)
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:
  - `frontend/src/components/Card.tsx` — Card styling
  - `frontend/src/components/Modal.tsx` — Form styling reference
  - `frontend/src/pages/Dashboard.tsx` — Dark theme usage

  **Acceptance Criteria**:
  - [ ] Login form renders with email + password + submit button
  - [ ] Invalid credentials → error message displayed
  - [ ] Valid credentials → redirect to app
  - [ ] When auth disabled: banner shown + "Continue without auth" link visible
  - [ ] Loading state while submitting

  **QA Scenarios**:

  Scenario: Login form renders correctly
    Tool: Playwright
    Preconditions: App running, on /login
    Steps:
      1. Open /login
      2. Verify email input visible
      3. Verify password input visible
      4. Verify login button visible
    Expected Result: All form elements visible
    Evidence: .sisyphus/evidence/task-9-form-renders.png

  Scenario: Dev mode banner
    Tool: Playwright
    Preconditions: ORCHESTRATOR_AUTH_ENABLED=false
    Steps:
      1. Open /login
      2. Verify "Continue to Dashboard" link visible
    Expected Result: Banner or link visible
    Evidence: .sisyphus/evidence/task-9-dev-mode.png

- [x] 10. Users Tab in Settings

  **What to do**:
  - Create `frontend/src/pages/settings/UsersTab.tsx`:
    - Admin only — redirect non-admin to general settings
    - Table of users: username, email, role (badge), API key present (yes/no), last login, is_active
    - "Add User" button → opens modal/form
    - Edit button per row → opens modal
    - Delete button per row → confirmation modal → soft delete
    - Role badge: admin (red), user (blue)
    - Server access section: expand user → list granted servers, add/remove server access
    - Model access section: expand user → list granted models per server, add/remove
    - "Generate API Key" button per user → generates key, shows in modal, copy button
  - Add API functions to `frontend/src/api.ts`:
    - `getUsers()` → GET /users
    - `createUser(data)` → POST /users
    - `updateUser(id, data)` → PUT /users/:id
    - `deleteUser(id)` → DELETE /users/:id
    - `grantServerAccess(userId, serverId)` → POST /users/:id/access/server
    - `revokeServerAccess(userId, serverId)` → DELETE /users/:id/access/server/:serverId
    - `grantModelAccess(userId, serverId, model)` → POST /users/:id/access/model
    - `revokeModelAccess(userId, serverId, model)` → DELETE /users/:id/access/model/:serverId/:model
    - `getUserAccess(userId)` → GET /users/:id/access
    - `rotateApiKey(userId)` → POST /users/:id/rotate-api-key
  - Server list for dropdown: `getServers()` → GET /api/orchestrator/servers
  - Model list per server: `getServerModels(serverId)` → GET /api/orchestrator/servers/:id/models
  - Admin-only: `requireAdmin` on all these API calls
  - Integrate into existing Settings page (`frontend/src/pages/settings/index.tsx`) as new tab

  **Must NOT do**:
  - Do NOT allow non-admin to access this tab
  - Do NOT show password hashes anywhere
  - Do NOT allow self-demotion (admin cannot remove their own admin role)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Complex settings tab with modals and tables
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9, 11)
  - **Blocks**: None
  - **Blocked By**: Task 8

  **References**:
  - `frontend/src/pages/settings/index.tsx` — Settings page structure with tabs
  - `frontend/src/pages/Servers.tsx` — Table with expand rows pattern
  - `frontend/src/components/DataToolbar.tsx` — Search/filter toolbar
  - `frontend/src/api.ts` — API function pattern
  - `frontend/src/components/ConfirmationModal.tsx` — Confirmation modal pattern

  **Acceptance Criteria**:
  - [ ] Admin can see Users tab in Settings
  - [ ] Non-admin redirected away from Users tab
  - [ ] Admin can create user with username/email/password/role
  - [ ] Admin can grant/revoke server access for a user
  - [ ] Admin can grant/revoke model access for a user
  - [ ] New user can login with credentials

  **QA Scenarios**:

  Scenario: Admin sees Users tab
    Tool: Playwright
    Preconditions: Logged in as admin
    Steps:
      1. Navigate to Settings
      2. Click "Users" tab
      3. Verify user table visible
    Expected Result: Users tab shows table with existing users
    Evidence: .sisyphus/evidence/task-10-users-tab.png

  Scenario: Non-admin cannot access Users tab
    Tool: Playwright
    Preconditions: Logged in as non-admin user
    Steps:
      1. Navigate to /settings/users directly
      2. Verify redirected or 403 shown
    Expected Result: Access denied
    Evidence: .sisyphus/evidence/task-10-access-denied.png

  Scenario: Admin creates user and grants access
    Tool: Playwright
    Preconditions: Logged in as admin
    Steps:
      1. Click "Add User"
      2. Fill: username="testuser", email="test@test.com", password="test123", role="user"
      3. Submit
      4. Find testuser in table, click expand
      5. Grant server "node-1" access
      6. Grant model "llama3" on server "node-1"
    Expected Result: User created, can expand and see access
    Evidence: .sisyphus/evidence/task-10-create-grant-access.png

- [x] 11. Config Import/Export

  **What to do**:
  - Backend: Add to `src/controllers/config-controller.ts`:
    - `exportConfig(req, res)` → GET /api/orchestrator/config/export — returns full config JSON with `exportedAt` timestamp, `version` field
    - `importConfig(req, res)` → POST /api/orchestrator/config/import — accepts JSON body, validates against schema, merges or replaces (query param: `?mode=merge|replace`), returns applied config
  - Export format:
    ```json
    {
      "exportedAt": "2024-01-01T00:00:00Z",
      "version": 1,
      "config": { ... full config object ... }
    }
    ```
  - Import validation: Zod parse against config schema, reject if invalid with field-level errors
  - Merge mode: deep merge with existing config, overwrite arrays
  - Replace mode: replace entire config
  - Frontend: Add to Settings page:
    - New section or tab: "Config Management"
    - "Download Config" button → triggers download of JSON file
    - "Upload Config" button → file picker for JSON, preview changes, confirm
    - Show validation errors before applying
  - Add API functions to `frontend/src/api.ts`:
    - `exportConfig()` → GET /api/orchestrator/config/export
    - `importConfig(json, mode)` → POST /api/orchestrator/config/import
  - Config import requires admin role

  **Must NOT do**:
  - Do NOT encrypt sensitive values in export (warn user instead)
  - Do NOT allow partial validation — all required fields must pass

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Settings UI with file upload/download
  - **Skills**: [`frontend-ui-ux`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 8, 9, 10)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `frontend/src/pages/settings/index.tsx` — Settings structure
  - `src/controllers/config-controller.ts` — Existing config controller
  - `src/config/schema.ts` — Config Zod schema for validation

  **Acceptance Criteria**:
  - [ ] Export produces valid JSON with all config sections
  - [ ] Import with valid JSON replaces/merges config correctly
  - [ ] Import with invalid JSON returns 400 with field errors
  - [ ] Download button triggers file download
  - [ ] Upload button allows selecting JSON file

  **QA Scenarios**:

  Scenario: Export produces valid config JSON
    Tool: Bash
    Preconditions: Admin logged in (cookies)
    Steps:
      1. `curl -s -b cookies.txt http://localhost:5100/api/orchestrator/config/export -o /tmp/config-export.json`
      2. `cat /tmp/config-export.json | python3 -m json.tool > /dev/null`
    Expected Result: Valid JSON with exportedAt, version, config fields
    Evidence: .sisyphus/evidence/task-11-export.json

  Scenario: Config import validates and applies
    Tool: Bash
    Preconditions: Valid config JSON file
    Steps:
      1. `curl -s -b cookies.txt -X POST http://localhost:5100/api/orchestrator/config/import -H "Content-Type: application/json" -d @/tmp/config-export.json`
    Expected Result: Returns 200 with applied config
    Evidence: .sisyphus/evidence/task-11-import.log

- [x] 12. LoadBalancer User Scoping

  **What to do**:
  - In `src/load-balancer/load-balancer.ts`:
    - `select()` method receives `userId?: string` parameter
    - When `userId` is provided and user is NOT admin:
      - Get user's allowed servers: `getUserStore().listServerAccess(userId)` → Set of serverIds
      - Get user's allowed models per server: `getUserStore().listModelAccess(userId)` → Map<serverId, Set<model>>
      - Filter candidates BEFORE scoring:
        - Remove any candidate where `serverId NOT IN userServers`
        - For remaining candidates, remove models NOT IN userModels[serverId]
        - If all candidates filtered out → throw "Access denied" or return null
      - Admin users: bypass all filtering (return all candidates)
    - How to get userId in LB: `req.user?.id` attached by auth middleware in inference routes
    - Need to pass user context from controller → orchestrator → load balancer
    - Modify `AIOrchestrator.getBestServerForModel(model, userId?)` signature to accept optional userId
    - Pass userId through: controller → orchestrator → loadBalancer.select(userId)
  - In `src/orchestrator/orchestrator.ts`:
    - `getBestServerForModel(model, userId?: string)` → passes userId to loadBalancer.select(userId)
  - In inference controllers:
    - After auth middleware validates JWT, `req.user` has userId + role
    - Pass `req.user.id` to `orchestrator.getBestServerForModel(model, req.user.id)`
  - Error handling: if user has no access to model → return 403 "Access denied to model X on server Y"
  - If user has no servers at all → return 403 "No servers assigned"

  **Must NOT do**:
  - Do NOT change load balancing algorithm — only filter candidates
  - Do NOT affect inference when userId is null (unauthenticated dev mode)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Cross-cutting concern affecting request routing
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 13, 14, 15)
  - **Blocks**: None
  - **Blocked By**: Tasks 2, 6

  **References**:
  - `src/load-balancer/load-balancer.ts` — select() and getCandidates()
  - `src/orchestrator/orchestrator.ts` — getBestServerForModel()
  - `src/controllers/ollama-controller.ts` — handleGenerate() calls orchestrator
  - `src/storage/user-store.ts` — hasServerAccess(), listServerAccess(), listModelAccess()

  **Acceptance Criteria**:
  - [ ] User with server-1 access only → cannot route to server-2
  - [ ] User with llama3 on server-1 only → cannot route to llama3 on server-2
  - [ ] Admin user → sees all servers/models
  - [ ] Unauthenticated dev mode (auth disabled) → all servers visible
  - [ ] Access denied returns 403

  **QA Scenarios**:

  Scenario: User restricted to single server
    Tool: Bash
    Preconditions: User "bob" has access to server-1 only, logged in as bob
    Steps:
      1. Bob calls POST /api/generate with model "llama3"
      2. Verify request goes to server-1
      3. Bob calls POST /api/generate with model "gpt4" (only on server-2) → expect 403
    Expected Result: Only server-1 is used, model on server-2 is denied
    Evidence: .sisyphus/evidence/task-12-user-scoped.log

  Scenario: Admin bypasses scoping
    Tool: Bash
    Preconditions: Admin user, multiple servers available
    Steps:
      1. Admin calls POST /api/generate with any model on any server
      2. Verify LB selects based on scoring, not access
    Expected Result: Admin has full access
    Evidence: .sisyphus/evidence/task-12-admin-bypass.log

- [x] 13. Filter is_probe from Analytics

  **What to do**:
  - In `src/analytics/analytics-engine.ts`:
    - All queries that read from `requests` table should add `WHERE is_probe = 0`
    - Specifically: `getTopModels()`, `getServerPerformance()`, `getErrorAnalysis()`, `getCapacityAnalysis()`, `analyzeTrend()`
    - Add `WHERE is_probe = 0` to all SQL queries against `requests` table
  - In `src/metrics/metrics-aggregator.ts`:
    - When `recordRequest()` is called, check if this is a probe request
    - If `is_probe === true`: do NOT update the sliding window metrics for analytics
    - Probe requests should still be recorded to SQLite (for debugging) but NOT aggregated into the main metrics
    - The `MetricsAggregator` already has a `recordRequest(RequestContext)` — add `isProbe` to RequestContext if not present
  - In `src/metrics/metrics-persistence.ts`:
    - `INSERT INTO requests` already has `is_probe` column — ensure it's always set correctly (false for user requests)
  - Verify: `src/inference-probe-scheduler.ts` marks probe requests as `is_probe: true` when recording

  **Must NOT do**:
  - Do NOT delete existing probe rows from SQLite
  - Do NOT change the is_probe column type or values

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: SQL WHERE clause additions
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 12, 14, 15)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/analytics/analytics-engine.ts` — All analytics query methods
  - `src/storage/metrics-store.ts` — Request INSERT with is_probe
  - `src/inference-probe-scheduler.ts` — Where probe requests originate

  **Acceptance Criteria**:
  - [ ] `getTopModels()` returns 0 probe requests
  - [ ] `getServerPerformance()` excludes probe requests
  - [ ] Dashboard charts show only real user traffic
  - [ ] Direct SQLite query: `SELECT COUNT(*) FROM requests WHERE is_probe=1` returns probe count

  **QA Scenarios**:

  Scenario: Analytics excludes probe requests
    Tool: Bash
    Preconditions: Orchestrator with probe requests in DB
    Steps:
      1. `curl -s -b cookies.txt http://localhost:5100/api/orchestrator/analytics/top-models`
      2. Check response — should not include probe request counts
      3. `sqlite3 data/orchestrator.db "SELECT COUNT(*) FROM requests WHERE is_probe=1"`
    Expected Result: Analytics JSON has no probe data, SQLite shows probe rows exist
    Evidence: .sisyphus/evidence/task-13-probe-filter.log

- [x] 14. Metrics Batch Flush Reduction + Sync Shutdown

  **What to do**:
  - In `src/config/schema.ts`:
    - Add `batchFlushIntervalMs` to metrics config section with default: `100` (was 1000ms)
    - Document that lower values = less data loss on crash but higher I/O
  - In `src/storage/metrics-store.ts`:
    - Use `config.performance.batchFlushIntervalMs` for flush interval (already references it)
    - Change default in `types.ts`: `batchFlushIntervalMs: 100` (was 1000)
    - Add `flushSync()` method: calls `flushBatch()` synchronously
  - In `src/index.ts` (Express app):
    - Register SIGTERM handler: `process.on('SIGTERM', async () => { await metricsStore.flushSync(); await operationalStore.close(); process.exit(0); })`
    - Register SIGINT (Ctrl+C) similarly
    - Also handle `beforeExit` event
  - In `src/orchestrator/orchestrator.ts` or `orchestrator-instance.ts`:
    - On orchestrator shutdown: call `metricsStore.flushSync()`
  - Verify graceful shutdown completes within 5 seconds (SIGTERM timeout)

  **Must NOT do**:
  - Do NOT block the event loop with synchronous flush (keep it async where possible)
  - Do NOT change default for existing deployments without warning

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Shutdown handling and performance tuning
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 12, 13, 15)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/storage/metrics-store.ts` — flushBatch() and timer logic
  - `src/storage/types.ts` — PerformanceConfig with batchFlushIntervalMs
  - `src/index.ts` — Express app setup and graceful shutdown
  - `src/config/schema.ts` — Config schema

  **Acceptance Criteria**:
  - [ ] Batch flush interval is 100ms (not 1000ms)
  - [ ] SIGTERM triggers synchronous flush
  - [ ] After SIGTERM, metrics buffer is empty (flushed)
  - [ ] Restart after SIGTERM preserves metrics

  **QA Scenarios**:

  Scenario: Metrics flushed on shutdown
    Tool: Bash
    Preconditions: Orchestrator running, some requests processed
    Steps:
      1. `curl -s -X POST http://localhost:5100/api/generate -d '{"model":"llama3","prompt":"hi"}'`
      2. Check buffer: `sqlite3 data/orchestrator.db "SELECT COUNT(*) FROM requests"`
      3. Send SIGTERM: `kill -15 $(pgrep -f 'node.*index.js')`
      4. Wait for restart
      5. `sqlite3 data/orchestrator.db "SELECT COUNT(*) FROM requests WHERE created_at > (SELECT MAX(created_at) - 1000 FROM requests)"`
    Expected Result: Request appears in SQLite (flushed before shutdown)
    Evidence: .sisyphus/evidence/task-14-shutdown-flush.log

- [x] 15. BanManager Failure Count Decay

  **What to do**:
  - In `src/utils/ban-manager.ts`:
    - Add `decayIntervalMs` config (default: 60000 = 1 minute)
    - Add `decayFactor` config (default: 0.5 = halve count each interval)
    - Add `decayTimer` with setInterval
    - `applyDecay()` method: for each entry in `modelFailureTracker`, multiply count by `decayFactor`; if count < 1, remove entry
    - When `markFailure()` is called: reset decay timer for that key (so decay doesn't apply until idle)
    - Add `getFailureCount(serverId, model)` → returns current count with decay applied
    - Replace direct `currentCount >= 10` check with `getFailureCount() >= 10` (so idle time reduces count)
    - The cooldown period before permanent ban: first failure starts cooldown timer; permanent ban only if 10 failures within cooldown window
    - Add config: `failureCountDecayMinutes` (default: 15) — if 10 failures are spaced > 15min apart, they don't accumulate to permanent ban
    - Implementation: instead of simple counter, track failures with timestamps in an array; on each failure check: how many failures in last `failureCountDecayMinutes`? If < 10, don't promote to permanent ban
    - Simpler: rolling window of timestamps per key; if window has < 10 entries, don't permanent ban

  **Must NOT do**:
  - Do NOT affect temporary cooldown logic (2-minute cooldown still applies)
  - Do NOT prevent permanent ban if 10 failures happen RAPIDLY (within minutes of each other)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Timer-based state decay
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Tasks 12, 13, 14)
  - **Blocks**: None
  - **Blocked By**: None

  **References**:
  - `src/utils/ban-manager.ts` — markFailure(), permanentBan logic
  - `src/storage/operational-store.ts` — BanManager persistence

  **Acceptance Criteria**:
  - [ ] 10 rapid failures → permanent ban (within minutes)
  - [ ] 10 failures spread over 30 minutes → no permanent ban (count decayed)
  - [ ] After 15 minutes idle, failure count is reduced
  - [ ] Temporary cooldown (2min) still works independently

  **QA Scenarios**:

  Scenario: Rapid failures cause permanent ban
    Tool: Bash
    Preconditions: Fresh server, trigger failures rapidly
    Steps:
      1. Make 10 rapid requests that fail (e.g., invalid model)
      2. Check: `GET /api/orchestrator/bans` shows permanent ban
    Expected Result: Permanent ban after 10 rapid failures
    Evidence: .sisyphus/evidence/task-15-rapid-ban.log

  Scenario: Spread failures avoid permanent ban
    Tool: Bash
    Preconditions: Fresh server
    Steps:
      1. Make 5 failures, wait 10 minutes, make 5 more failures
      2. Check bans → should NOT have permanent ban
    Expected Result: No permanent ban (count decayed between batches)
    Evidence: .sisyphus/evidence/task-15-spread-no-ban.log

- [x] 16. CSRF Protection

  **What to do**:
  - Since we're using httpOnly cookies (not Authorization header), we need CSRF protection for browser-based requests
  - Strategy: Double Submit Cookie pattern
    - On login: set an additional `csrf-token` cookie (httpOnly=false, Secure, SameSite=Strict) with a random value
    - Client JS reads this cookie and sends it as `X-CSRF-Token` header on state-changing requests (POST/PUT/DELETE)
    - Server validates: `csrf-token` cookie value === `X-CSRF-Token` header value
  - Implement `src/middleware/csrf.ts`:
    - `generateCsrfToken(req, res)` — creates random token, sets httpOnly=false cookie
    - `validateCsrfToken(req, res)` — checks header vs cookie match; returns 403 on mismatch
    - Apply `validateCsrfToken` to all state-changing routes: login (already has session), user CRUD, config import, server management
  - Add `CSRF_TOKEN_SECRET` env var validation (similar to JWT_SECRET)
  - Update auth routes (`/auth/login`, `/auth/logout`, `/users/*`) to set and validate CSRF token
  - Frontend: api.ts response interceptor: after login, extract `csrf-token` from response cookies and store in a non-httpOnly cookie OR in React state to send on subsequent requests
  - Actually: CSRF token should be set on the login page GET and validated on POST
  - LoginPage: on mount, GET /auth/csrf-token → stores token → sends as header on POST /auth/login
  - GET /auth/csrf-token: sets CSRF cookie without requiring auth

  **Must NOT do**:
  - Do NOT apply CSRF to GET requests (only state-changing)
  - Do NOT apply CSRF to inference endpoints (they use auth tokens, not cookies in browser)
  - Do NOT store CSRF token in localStorage (XSS risk)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Security-critical middleware
  - **Skills**: [`auth-best-practices`]

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 5 (with Task 17)
  - **Blocks**: None
  - **Blocked By**: Task 5

  **References**:
  - `src/middleware/auth.ts` — Middleware pattern
  - `src/routes/auth.routes.ts` — Auth routes from Task 5
  - `frontend/src/api.ts` — Axios interceptors from Task 8

  **Acceptance Criteria**:
  - [ ] POST /auth/login without X-CSRF-Token header → 403
  - [ ] POST /auth/login with valid X-CSRF-Token → 200
  - [ ] GET /auth/csrf-token sets cookie
  - [ ] Browser automatic cookie-send works (SameSite=Strict)

  **QA Scenarios**:

  Scenario: CSRF token required on state-changing endpoints
    Tool: Bash
    Preconditions: CSRF cookie set
    Steps:
      1. `curl -s -b cookies.txt -X POST http://localhost:5100/auth/logout` (no CSRF header) → expect 403
      2. `curl -s -b cookies.txt -X POST http://localhost:5100/auth/logout -H "X-CSRF-Token: $(curl -s -c cookies.txt http://localhost:5100/auth/csrf-token | grep csrf-token)"` → expect 200
    Expected Result: Without token = 403, with token = 200
    Evidence: .sisyphus/evidence/task-16-csrf.log

---

## Final Verification Wave

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists. For each "Must NOT Have": search codebase for forbidden patterns. Check evidence files exist.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `tsc --noEmit` + linter + `bun test`. Review for `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task. Test cross-task integration (features working together). Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | VERDICT`

---

## Commit Strategy

- **1**: `feat(auth): schema v4 — users, user_server_access, user_model_access tables`
- **2**: `feat(auth): add UserStore class with CRUD and bcrypt hashing`
- **3**: `feat(auth): wire requireAuth/requireAdmin to all sensitive routes`
- **4**: `feat(auth): JWT implementation with httpOnly cookie support`
- **5**: `feat(auth): add auth routes — login, logout, refresh, user CRUD`
- **6**: `feat(auth): protect inference endpoints with auth middleware`
- **7**: `feat(auth): default admin from ADMIN_USERNAME/ADMIN_PASSWORD env vars`
- **8**: `feat(frontend): add AuthContext and ProtectedRoute`
- **9**: `feat(frontend): add LoginPage with auth disabled bypass`
- **10**: `feat(frontend): add Users tab in Settings`
- **11**: `feat(settings): add config import/export functionality`
- **12**: `feat(loadbalancer): filter candidates by user server/model access`
- **13**: `fix(metrics): filter is_probe from analytics queries`
- **14**: `fix(metrics): reduce batch flush interval and add sync shutdown`
- **15**: `fix(banmanager): add failure count decay to prevent permanent bans`
- **16**: `feat(auth): add CSRF protection middleware`

---

## Success Criteria

### Verification Commands
```bash
# Auth disabled mode
ORCHESTRATOR_AUTH_ENABLED=false npm start
curl http://localhost:5100/api/generate -d '{"model":"llama3","prompt":"hi"}'  # expect 200

# Auth enabled mode
ORCHESTRATOR_AUTH_ENABLED=true ADMIN_USERNAME=admin ADMIN_PASSWORD=adminpass123 npm start
curl -c /tmp/cookies.txt -X POST http://localhost:5100/auth/login -H "Content-Type: application/json" -d '{"email":"admin@local","password":"adminpass123"}'  # expect 200
curl -b /tmp/cookies.txt http://localhost:5100/auth/me  # expect user info

# Admin route protection
curl -X POST http://localhost:5100/api/orchestrator/servers/add  # expect 401 without cookie

# User scoping
curl -b /tmp/cookies.txt -X POST http://localhost:5100/api/generate -d '{"model":"llama3","prompt":"hi"}'  # user with access → 200

# Analytics excludes probes
sqlite3 data/orchestrator.db "SELECT COUNT(*) FROM requests WHERE is_probe=1"  # should be > 0
curl -b /tmp/cookies.txt http://localhost:5100/api/orchestrator/analytics/top-models  # should show 0 probe requests

# Config export/import
curl -b /tmp/cookies.txt http://localhost:5100/api/orchestrator/config/export -o config.json  # valid JSON
```

### Final Checklist
- [ ] All Must Have items present
- [ ] All Must NOT Have items absent
- [ ] All tests pass (bun test)
- [ ] Build succeeds (tsc --noEmit)
- [ ] Playwright E2E passes

---

## Commit Strategy

---

## Success Criteria