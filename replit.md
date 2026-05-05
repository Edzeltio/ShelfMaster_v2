# ShelfMaster

## Overview

ShelfMaster is a web-based Library Management System (LMS) built for managing books, borrowers, transactions, and library operations. It supports features like inventory management, book borrowing/returns, barcode scanning, PDF report generation, email notifications, and a librarian/admin dashboard. The system can run as a web app or be packaged as a desktop application via Electron.

**Core capabilities:**
- Book inventory management with barcode support
- Member/borrower management
- Transaction tracking (checkouts, returns, pending requests)
- PDF report generation
- Email notifications (verification, alerts)
- Role-based access (librarian vs. regular user)
- LAN-accessible from multiple devices via IP-based connection manager

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend (React + Vite)
- **Framework:** React 19 with React Router DOM v7 for client-side routing
- **Build tool:** Vite 8, configured to serve on port 5000
- **Styling:** Plain CSS with CSS custom properties (design tokens for colors, fonts, spacing) — no CSS framework
- **Typography:** Google Fonts (Cormorant Garamond + DM Sans) for a library aesthetic
- **State/session:** JWT stored in `sessionStorage` via `localDbClient.js`
- **Responsive design:** Custom `useResponsive` hook tracking mobile/tablet/desktop breakpoints
- **Deployment:** Web-only (Electron removed)

### Backend (Express.js)
- **Server:** `server.js` — a single Express.js server that:
  - Serves the Vite dev server (development) or built `dist/` (production) on port 5000
  - Exposes REST API routes under `/api/`
  - Proxies allowed database queries to Supabase using a service-role key
  - Handles file uploads (book covers) to `public/uploads/`
  - Issues and validates JWT tokens for authentication
- **Table allow-list:** Only specific tables (`users`, `books`, `book_copies`, `transactions`, `site_content`, `notifications`) can be queried through the `/api/db/query` endpoint to prevent unauthorized access

### Database (Supabase / PostgreSQL)
- **Provider:** Supabase (PostgreSQL) accessed via `@supabase/supabase-js` with the service-role key — only on the server side, never exposed to the browser
- **Schema:** Defined in `supabase_schema.sql` (run once in Supabase SQL Editor)
- **Key tables:** `users`, `books`, `book_copies`, `transactions`, `site_content`, `notifications`, `auth_users`
- **Note:** Supabase Auth is NOT used. Authentication is handled by a custom `auth_users` table with bcrypt-hashed passwords

### Authentication
- **Mechanism:** Custom JWT-based auth issued by the Express server
- **Password hashing:** bcryptjs
- **Token storage:** Browser `sessionStorage`
- **Role system:** First registered user is automatically promoted to librarian; role is embedded in JWT claims
- **Flow:** Login → Express verifies credentials against `auth_users` table → issues JWT → client attaches JWT as Bearer token on all API requests

### Client-to-Server Communication
- **`localDbClient.js`:** A browser-side client that mimics the Supabase JS API surface but actually routes all calls through the Express REST API (not directly to Supabase)
- **`localDbAdmin.js`:** Re-export of `localDbClient` used by librarian/admin screens
- **`connectionManager.js`:** Stores server IP/port in `localStorage` so LAN devices can point to a specific server instance — supports multi-device library setups

### Email
- **Library:** nodemailer
- **Config:** SMTP credentials via environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`)
- **Fallback:** If SMTP is not configured, emails are logged to the console — the app works without email setup

### PDF & Barcodes
- **PDF:** jsPDF + jspdf-autotable for report generation
- **Barcodes:** react-barcode and jsbarcode for display; @zxing/browser + @zxing/library for scanning via camera

### Charts
- **Library:** Recharts for dashboard analytics and statistics

## External Dependencies

| Dependency | Purpose |
|---|---|
| **Supabase** | PostgreSQL database hosting. Requires `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` secrets |
| **SMTP Server** | Outbound email for verification and notifications. Optional — falls back to console logging if not set. Supports Gmail, Outlook, Resend, Mailtrap, etc. |
| **Google Fonts** | Cormorant Garamond and DM Sans loaded via CSS `@import` |

### Required Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `SUPABASE_URL` | ✅ Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ Yes | Service-role key for server-side DB access |
| `JWT_SECRET` | No | JWT signing secret (defaults to dev secret) |
| `PORT` | No | Server port (defaults to 5000) |
| `SMTP_HOST` | No | SMTP server hostname |
| `SMTP_PORT` | No | SMTP port (defaults to 587) |
| `SMTP_USER` | No | SMTP username/email |
| `SMTP_PASS` | No | SMTP password |
| `SMTP_FROM` | No | From address for outbound email |
| `SMTP_SECURE` | No | Use TLS (true for port 465) |
| `APP_BASE_URL` | No | Public URL used in email links (e.g. your Replit app URL) |