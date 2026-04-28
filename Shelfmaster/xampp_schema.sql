CREATE DATABASE IF NOT EXISTS shelfmaster CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shelfmaster;

CREATE TABLE IF NOT EXISTS auth_users (
  id VARCHAR(36) PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(36) PRIMARY KEY,
  auth_id VARCHAR(36),
  name VARCHAR(255),
  student_id VARCHAR(100),
  course_year VARCHAR(255),
  role VARCHAR(50) DEFAULT 'student',
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (auth_id)
);

CREATE TABLE IF NOT EXISTS books (
  id VARCHAR(36) PRIMARY KEY,
  accession_num VARCHAR(100),
  barcode VARCHAR(100),
  title VARCHAR(255) NOT NULL,
  authors VARCHAR(255),
  quantity INT DEFAULT 1,
  date_acquired DATE NULL,
  edition VARCHAR(100),
  pages INT NULL,
  book_type VARCHAR(100),
  subject_class VARCHAR(255),
  category VARCHAR(255),
  cost_price DECIMAL(10,2) NULL,
  publisher VARCHAR(255),
  isbn VARCHAR(100),
  copyright VARCHAR(100),
  source TEXT,
  remark TEXT,
  status VARCHAR(50) DEFAULT 'active',
  cover_image TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (status),
  INDEX (book_type)
);

CREATE TABLE IF NOT EXISTS book_copies (
  id VARCHAR(36) PRIMARY KEY,
  book_id VARCHAR(36) NOT NULL,
  copy_number INT NOT NULL DEFAULT 1,
  accession_id VARCHAR(100) NOT NULL UNIQUE,
  status VARCHAR(50) NOT NULL DEFAULT 'available',
  date_acquired DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (book_id),
  CONSTRAINT fk_book_copies_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS transactions (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36),
  book_id VARCHAR(36),
  copy_id VARCHAR(36) NULL,
  status VARCHAR(50) DEFAULT 'pending',
  borrow_date DATETIME NULL,
  due_date DATETIME NULL,
  return_date DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX (user_id),
  INDEX (book_id),
  INDEX (copy_id),
  INDEX (status)
);

CREATE TABLE IF NOT EXISTS site_content (
  id INT PRIMARY KEY,
  hero_banner_url TEXT,
  tagline VARCHAR(255),
  about_text TEXT,
  mission TEXT,
  vision TEXT,
  contact_email VARCHAR(255),
  contact_phone VARCHAR(100),
  contact_location VARCHAR(255),
  footer_text TEXT
);

INSERT INTO site_content (
  id,
  tagline,
  about_text,
  contact_email,
  contact_phone,
  contact_location,
  footer_text
) VALUES (
  1,
  'Master Every Shelf',
  'ShelfMaster provides smart and reliable library management tools for organizing books, students, and borrowing records.',
  'ShelfMaster@wmsu.edu.ph',
  '0912-345-6789',
  'Normal Road, Zamboanga City',
  '© 2026 ShelfMaster Library. All rights reserved.'
) ON DUPLICATE KEY UPDATE id = id;
