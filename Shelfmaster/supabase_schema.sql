-- ShelfMaster — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- Safe to re-run; every statement is idempotent.

create extension if not exists "uuid-ossp";

-- Local credential store (the Express server hashes passwords with bcrypt
-- and signs its own JWTs; it does NOT use Supabase Auth).
create table if not exists auth_users (
  id                  text primary key,
  email               text not null unique,
  password_hash       text not null,
  verified            boolean default false,
  verification_token  text,
  created_at          timestamptz default now()
);
-- Idempotent migrations for older auth_users tables
alter table auth_users add column if not exists verified           boolean default false;
alter table auth_users add column if not exists verification_token text;

create table if not exists users (
  id            text primary key,
  auth_id       text,
  name          text,
  student_id    text,
  course_year   text,            -- legacy: kept for backwards-compat (grade_section is the canonical column)
  grade_section text,            -- e.g. "Grade 11 - STEM"
  lrn           text,            -- 12-digit Learner Reference Number
  role          text default 'student',
  status        text default 'active',
  archived_at   timestamptz,
  created_at    timestamptz default now()
);
-- Idempotent migrations for older users tables
alter table users add column if not exists grade_section text;
alter table users add column if not exists lrn           text;
alter table users add column if not exists archived_at   timestamptz;
-- Backfill grade_section from the old course_year column on first run
update users set grade_section = course_year
  where grade_section is null and course_year is not null;
create index if not exists users_auth_id_idx     on users(auth_id);
create index if not exists users_archived_at_idx on users(archived_at);

create table if not exists books (
  id             text primary key,
  accession_num  text,
  barcode        text,
  title          text not null,
  authors        text,
  quantity       integer default 1,
  date_acquired  date,
  edition        text,
  pages          integer,
  book_type      text,
  subject_class  text,
  category       text,
  cost_price     numeric(10,2),
  publisher      text,
  isbn           text,
  copyright      text,
  source         text,
  remark         text,
  status         text default 'active',
  cover_image    text,
  created_at     timestamptz default now()
);
create index if not exists books_status_idx   on books(status);
create index if not exists books_book_type_idx on books(book_type);

create table if not exists book_copies (
  id            text primary key,
  book_id       text not null references books(id) on delete cascade,
  copy_number   integer not null default 1,
  accession_id  text not null unique,
  status        text not null default 'available',
  date_acquired date,
  created_at    timestamptz default now()
);
create index if not exists book_copies_book_id_idx on book_copies(book_id);

-- Fine records created when a book is returned late.
create table if not exists fines (
  id             text primary key,
  transaction_id text references transactions(id) on delete set null,
  user_id        text references users(id) on delete set null,
  amount         numeric(10,2) not null default 0,
  overdue_days   integer default 0,
  status         text not null default 'unpaid',   -- 'unpaid' | 'paid'
  paid_at        timestamptz,
  created_at     timestamptz default now()
);
create index if not exists fines_transaction_id_idx on fines(transaction_id);
create index if not exists fines_user_id_idx        on fines(user_id);
create index if not exists fines_status_idx         on fines(status);

create table if not exists transactions (
  id                    text primary key,
  user_id               text references users(id) on delete set null,
  book_id               text references books(id) on delete set null,
  copy_id               text references book_copies(id) on delete set null,
  fine_id               text references fines(id) on delete set null,
  transaction_type      text,                        -- 'borrow' | 'return'
  status                text default 'pending',
  borrow_date           timestamptz,
  due_date              timestamptz,
  return_date           timestamptz,
  fine_amount           numeric(10,2) default 0,    -- snapshot of fine at return time
  walk_in_name          text,
  walk_in_grade_section text,
  walk_in_lrn           text,
  walk_in_teacher       text,
  walk_in_employee_id   text,
  walk_in_department    text,
  walk_in_contact       text,
  walk_in_position      text,
  created_at            timestamptz default now()
);
-- Idempotent migrations for older transactions tables
alter table transactions add column if not exists fine_amount       numeric(10,2) default 0;
alter table transactions add column if not exists walk_in_position  text;
alter table transactions add column if not exists fine_id           text references fines(id) on delete set null;
alter table transactions add column if not exists transaction_type  text;
create index if not exists transactions_user_id_idx      on transactions(user_id);
create index if not exists transactions_book_id_idx      on transactions(book_id);
create index if not exists transactions_copy_id_idx      on transactions(copy_id);
create index if not exists transactions_status_idx       on transactions(status);
create index if not exists transactions_fine_id_idx      on transactions(fine_id);
create index if not exists transactions_type_idx         on transactions(transaction_type);

-- Fine and borrow policy (always a single row with id = 1).
create table if not exists fine_policy (
  id                    integer primary key,
  fine_amount           numeric(10,2) default 5,    -- fine charged per increment
  fine_per_day          numeric(10,2) default 5,    -- legacy alias for fine_amount
  fine_increment_value  integer default 1,           -- charge once every N units
  fine_increment_type   text default 'per_day',      -- 'per_day' | 'per_hour'
  borrow_duration_value integer default 7,           -- default loan length
  borrow_duration_unit  text default 'days',         -- 'days' | 'hours'
  updated_at            timestamptz
);
-- Idempotent migrations for older fine_policy tables
alter table fine_policy add column if not exists fine_amount           numeric(10,2) default 5;
alter table fine_policy add column if not exists fine_per_day          numeric(10,2) default 5;
alter table fine_policy add column if not exists fine_increment_value  integer default 1;
alter table fine_policy add column if not exists fine_increment_type   text default 'per_day';
alter table fine_policy add column if not exists borrow_duration_value integer default 7;
alter table fine_policy add column if not exists borrow_duration_unit  text default 'days';
alter table fine_policy add column if not exists updated_at            timestamptz;
-- Seed the single policy row if it doesn't exist yet
insert into fine_policy (id, fine_amount, fine_per_day, fine_increment_value, fine_increment_type, borrow_duration_value, borrow_duration_unit)
values (1, 5, 5, 1, 'per_day', 7, 'days')
on conflict (id) do nothing;

create table if not exists site_content (
  id               integer primary key,
  hero_banner_url  text,
  tagline          text,
  about_text       text,
  mission          text,
  vision           text,
  contact_email    text,
  contact_phone    text,
  contact_location text,
  footer_text      text
);

-- In-app notifications. Email delivery is handled by the server when SMTP is
-- configured; rows live here so they're also visible in-app.
create table if not exists notifications (
  id          text primary key,
  user_id     text references users(id) on delete cascade,
  fine_id     text references fines(id) on delete set null,
  type        text not null,        -- 'request_approved' | 'request_declined' | 'due_reminder' | 'overdue' | 'fine' | 'verification' | 'general'
  title       text not null,
  body        text,
  email_sent  boolean default false,
  read        boolean default false,
  created_at  timestamptz default now()
);
-- Idempotent migrations for older notifications tables
alter table notifications add column if not exists fine_id text references fines(id) on delete set null;
create index if not exists notifications_user_id_idx on notifications(user_id);
create index if not exists notifications_read_idx    on notifications(read);
create index if not exists notifications_fine_id_idx on notifications(fine_id);

insert into site_content (
  id, tagline, about_text, contact_email, contact_phone, contact_location, footer_text
) values (
  1,
  'Master Every Shelf',
  'ShelfMaster provides smart and reliable library management tools for organizing books, students, and borrowing records.',
  'ShelfMaster@wmsu.edu.ph',
  '0912-345-6789',
  'Normal Road, Zamboanga City',
  '© 2026 ShelfMaster Library. All rights reserved.'
)
on conflict (id) do nothing;
