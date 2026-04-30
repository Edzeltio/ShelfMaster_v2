-- ShelfMaster — Supabase schema
-- Run this once in your Supabase project: SQL Editor → New query → paste → Run.
-- Safe to re-run; every statement is idempotent.

create extension if not exists "uuid-ossp";

-- Local credential store (the Express server hashes passwords with bcrypt
-- and signs its own JWTs; it does NOT use Supabase Auth).
create table if not exists auth_users (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,
  created_at    timestamptz default now()
);

create table if not exists users (
  id           text primary key,
  auth_id      text,
  name         text,
  student_id   text,
  course_year  text,
  role         text default 'student',
  status       text default 'active',
  created_at   timestamptz default now()
);
create index if not exists users_auth_id_idx on users(auth_id);

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
create index if not exists books_status_idx on books(status);
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

create table if not exists transactions (
  id                    text primary key,
  user_id               text references users(id) on delete set null,
  book_id               text references books(id) on delete set null,
  copy_id               text references book_copies(id) on delete set null,
  status                text default 'pending',
  borrow_date           timestamptz,
  due_date              timestamptz,
  return_date           timestamptz,
  walk_in_name          text,
  walk_in_grade_section text,
  walk_in_lrn           text,
  walk_in_teacher       text,
  walk_in_employee_id   text,
  walk_in_department    text,
  walk_in_contact       text,
  created_at            timestamptz default now()
);
create index if not exists transactions_user_id_idx  on transactions(user_id);
create index if not exists transactions_book_id_idx  on transactions(book_id);
create index if not exists transactions_copy_id_idx  on transactions(copy_id);
create index if not exists transactions_status_idx   on transactions(status);

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
