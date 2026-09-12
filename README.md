# Velozity Client Project Dashboard

Role-aware project tracking with persisted audit events, notifications and Socket.io updates.

## Run locally

1. Copy `.env.example` to `.env` and set production-strength secrets.
2. `docker compose up -d`
3. `npm install`
4. `npm run db:push && npm run db:seed`
5. `npm run dev`

Open `http://localhost:5173`. Seeded passwords are `Password123!`; users include `admin@velocity.dev`, `pm1@velocity.dev`, and `dev1@velocity.dev`.

## Architecture

The API uses Express pluAs Prisma: controllers delegate authorization decisions to a policy layer, so protected routes never rely on client-side hiding. Access tokens are short-lived bearer JWTs; refresh tokens are long-lived JWTs in a `HttpOnly`, `SameSite=Lax` cookie and are rotated when refreshed. Socket.io was selected for room membership, acknowledgement semantics and a robust browser client. A socket is authenticated with the same access token and joins only policy-approved project rooms; user rooms power notification counts.

`node-cron` marks open tasks overdue every five minutes. This is adequate for one API instance; a distributed deployment should replace it with BullMQ/Redis so only one worker runs. The schema indexes foreign keys and main list predicates (`projectId`, `assigneeId`, status, due date, created time) to keep scoped dashboards and activity catch-up queries fast.

## Schema

`User` creates `Project`; a `Project` belongs to a `Client` and has `Task`s. A task has one optional developer assignee, persisted `Activity` records and `Notification`s. The `RefreshToken` table supports server-side revocation/rotation.

## API highlights

All errors follow `{ error: { code, message, details? } }`. Task filters are query parameters (`status`, `priority`, `dueFrom`, `dueTo`). `GET /api/activities?since=<ISO>` returns the most recent 20 visible events after an offline cursor.

## Known limitations

Presence is process-local and thus needs a Socket.io Redis adapter for multi-instance hosting. The included compose file runs Postgres only; deploy the API separately from a static Vite frontend, or use a persistent Node host for WebSockets.

## Assessment explanation 

The hardest part was treating real-time delivery as an authorization problem rather than a broadcasting problem. An activity can be visible to an admin, the owning project manager, and an assigned developer, but not to every connected user. I made the database the source of truth: a task-status transaction first updates the task, inserts its activity row, and creates any notification. Only after that transaction succeeds does the service emit an event. This prevents clients from receiving events that cannot be recovered after a failed write.

Socket connections authenticate with a normal access token. At connection time the server joins a personal user room. When a client opens a project, it asks to join that project room; the server repeats the same project-access policy used by HTTP routes before admitting it. Activity delivery additionally checks the persisted event audience, so a developer only receives an event for an assigned task. On reconnect, the client supplies its last seen timestamp to the activity endpoint, which queries the database for the last 20 events it is entitled to see.

I would use BullMQ with Redis and Socket.io's Redis adapter in a horizontally scaled deployment. The included cron job and in-memory presence set are deliberately simple for a single API process.



## A problem i face 

The application currently has a session persistence issue after a browser refresh.

During login, the backend successfully authenticates the user and returns an access token. The frontend stores the authenticated user in React state. However, React state exists only for the current browser session and is reset when the page is refreshed.

As a result, when the user presses F5:

The React application is reinitialized.
user is initialized as null.
The application assumes that the user is unauthenticated.
The login screen is rendered again.
Although the user may still have a valid refresh token stored in the browser's HttpOnly cookie, the frontend does not use it to restore the authenticated session.

Therefore, the issue is not that login authentication is failing. The issue is that the application does not currently perform session restoration during application initialization.



### Root Cause

The frontend currently follows this logic:

Application starts
      ↓
user = null
      ↓
if (!user)
      ↓
Show Login Page

There is no startup request such as:

POST /api/auth/refresh

to determine whether an existing authenticated session can be restored.

The backend already contains the required refresh-token infrastructure, including:

Refresh token generation
Refresh token persistence
HttpOnly refresh cookie
Refresh-token expiry

Therefore, the missing part is primarily the frontend session restoration flow and verification that the refresh endpoint/cookie is correctly wired.

### Proposed Solution

Implement a refresh-token-based session restoration mechanism.

Expected authentication flow
                    LOGIN
                      │
                      ▼
              Backend authenticates
                      │
             ┌────────┴────────┐
             ▼                 ▼
       Access Token       Refresh Token
       (short-lived)      (HttpOnly Cookie)
             │                 │
             ▼                 ▼
        React State       Browser Cookie

When the user refreshes the page:

                    F5
                     │
                     ▼
             React application
                initializes
                     │
                     ▼
          POST /api/auth/refresh
                     │
                     ▼
       Browser sends HttpOnly cookie
                     │
                     ▼
          Backend validates token
                     │
                     ▼
        New access token + user
                     │
                     ▼
          Restore React state
                     │
                     ▼
                  Dashboard

### Required changes

1. Frontend — App.tsx

Add an initialization process that calls:

POST /auth/refresh

when the application starts.

If successful:

setAccess(data.accessToken)
setUser(data.user)

This restores the authenticated state after F5.

2. Frontend — api.ts

Ensure Axios sends cookies with requests:

withCredentials: true

This is necessary because the refresh token is stored in an HttpOnly cookie and therefore cannot be accessed directly through JavaScript.

3. Backend — Auth routes

Ensure the backend exposes:

POST /api/auth/refresh

### The endpoint should:

Read the refresh token from the cookie.
Validate the refresh token.
Verify it against the persisted refresh-token record.
Generate a new access token.
Return the authenticated user and new access token.
Final Result

After implementation, the authentication lifecycle will be:

        Login
        ↓
        Access Token → application memory
        Refresh Token → HttpOnly cookie
        ↓
        User works normally
        ↓
        F5 / Browser refresh
        ↓
        Refresh endpoint
        ↓
        New Access Token
        ↓
        Restore User State
        ↓
        Dashboard remains accessible
