# ShelfMaster

A web-based library management system (LMS) built with React + Vite, an Express.js API, and a Supabase (PostgreSQL) database.

## Tech Stack

- **Frontend:** React 19, React Router DOM v7
- **Build Tool:** Vite 8 served through an Express server on port 5000
- **Backend:** Express.js API (`server.js`)
- **Database:** Supabase (PostgreSQL) via `@supabase/supabase-js`
- **Auth:** JWT + bcrypt issued by the Express server (Supabase Auth is **not** used; the `auth_users` table holds email + bcrypt hash)
- **Charts:** Recharts
- **Barcodes:** react-barcode, jsbarcode
- **PDF:** jsPDF + jspdf-autotable
- **Package Manager:** npm

## Project Structure

- `server.js` — Express server. Hosts Vite in development (and the built `dist` in production), proxies database requests to Supabase, handles auth (JWT + bcrypt), uploads, and a few librarian-only endpoints.
- `supabase_schema.sql` — One-time schema to paste into Supabase → SQL Editor.
- `electron/main.cjs` — Electron main process (spawns the Express server).
- `electron/preload.cjs` — Electron preload (exposes `window.shelfmaster`).
- `src/` — React source (flat layout)
  - `localDbClient.js` — Browser client mimicking the Supabase API; routes calls through the Express server.
  - `localDbAdmin.js` — Re-export used by librarian/admin screens.
  - …feature components (Inventory, ProcessReturns, PendingRequests, etc.)
- `public/` — Static assets, including `public/uploads/` for cover images and other uploads.

## Required Environment Variables

| Name | Where | Purpose |
| --- | --- | --- |
| `SUPABASE_URL` | Replit Secrets | Your Supabase project URL (e.g. `https://xxxx.supabase.co`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Replit Secrets | Service-role key from Supabase → Settings → API. **Server-only** — never sent to the browser. |
| `JWT_SECRET` *(optional)* | Replit Secrets | Override the dev JWT secret. Defaults to `shelfmaster-local-dev-secret`. |
| `PORT` *(optional)* | env | Defaults to `5000`. |

`server.js` loads `.env` automatically if present, but on Replit these come from Secrets.

## One-Time Supabase Setup

1. Open your Supabase project → **SQL Editor → New query**.
2. Paste the contents of [`supabase_schema.sql`](./supabase_schema.sql).
3. Click **Run**. The script is idempotent — safe to run again later.
4. Restart the workflow. The server log should print `[db] Supabase reachable at <your URL>`.

The first user account that registers through the app is automatically promoted to **librarian**, so a fresh database is administrable immediately.

## Database Schema (created by `supabase_schema.sql`)

### `auth_users`
`id`, `email` (unique), `password_hash` (bcrypt), `created_at`. Used by the Express server's JWT auth.

### `users`
Application profiles. `id`, `auth_id`, `name`, `student_id`, `course_year`, `role` (`student` / `librarian`), `status`, `created_at`.

### `books`
Title-level book record. `quantity` = number of currently available copies.

### `book_copies`
One row per physical copy.
`id`, `book_id` (FK→books, cascade), `copy_number`, `accession_id` (e.g. `LIB-2026-000001`, unique), `status` (available/borrowed/damaged/lost), `date_acquired`.

### `transactions`
`id`, `user_id`, `book_id`, `copy_id`, `status`, `borrow_date`, `due_date`, `return_date`, plus walk-in borrower columns (`walk_in_*`).

### `site_content`
Single-row (`id = 1`) site configuration: hero banner, tagline, about/mission/vision, contact info, footer.

## Per-Copy Barcode System

- **Accession ID format:** `LIB-YYYY-NNNNNN` (6-digit global counter, e.g. `LIB-2026-000001`).
- Adding a book with qty=5 auto-generates 5 copies with sequential accession IDs.
- Each copy's barcode label is printed separately (Code 128).
- **Borrow:** Librarian approves → system assigns the next available copy → links `copy_id` to the transaction.
- **Return:** Staff scans copy barcode → exact copy found → marked available → student's loan closed.

## API Surface

- `POST /api/auth/signup`, `POST /api/auth/login`, `GET /api/auth/user`
- `POST /api/db/query` — Generic table query proxy used by `localDbClient.js`. Supports `select`, `insert`, `update` against the allow-listed tables (`users`, `books`, `book_copies`, `transactions`, `site_content`). The `select` string is passed straight through to PostgREST, so Supabase relation syntax like `'*, books(*), users(*)'` works.
- `POST /api/books/:id/archive`, `POST /api/books/:id/unarchive`, `DELETE /api/books/:id` *(librarian-only)*
- `POST /api/ebooks`, `PATCH /api/ebooks/:id` *(librarian-only)*
- `POST /api/storage/upload` *(librarian-only)* — saves files under `public/uploads/`, served at `/uploads/...`
- `GET /api/health`, `GET /api/test`, `GET /api/lan-info`

Librarian-only endpoints verify the caller's role by joining the JWT subject (`auth_id`) to the `users` table.

## Development

```bash
npm install
npm run dev   # starts Express + Vite on port 5000
```

The Replit workflow `Start application` runs `cd Shelfmaster && npm run dev` and exposes port 5000 in the webview.
