import 'dotenv/config';
import express from 'express';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';

const app = express();
const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const jwtSecret = process.env.JWT_SECRET || 'shelfmaster-local-dev-secret';

let pool;
const columnCache = new Map();

app.use(express.json({ limit: '15mb' }));

// CORS — allow LAN devices on a different origin to call this server's API
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

app.use('/uploads', express.static(uploadsDir));

function getLanAddresses() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        result.push({ name, address: iface.address });
      }
    }
  }
  return result;
}

function dbConfig(includeDatabase = true) {
  // Force IPv4 — on Windows "localhost" often resolves to ::1 (IPv6) first,
  // which then times out because XAMPP MySQL only listens on IPv4.
  let host = process.env.DB_HOST || '127.0.0.1';
  if (host.toLowerCase() === 'localhost') host = '127.0.0.1';

  const config = {
    host,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    connectTimeout: 5000,
  };

  if (includeDatabase) {
    config.database = process.env.DB_NAME || 'shelfmaster';
  }

  return config;
}

async function checkMysqlAvailable() {
  const cfg = dbConfig(false);
  try {
    const conn = await mysql.createConnection(cfg);
    await conn.ping();
    await conn.end();
    console.log(`[db] MySQL reachable at ${cfg.host}:${cfg.port} as user "${cfg.user}".`);
    return true;
  } catch (err) {
    console.error('\n========================================');
    console.error(' ❌ Cannot connect to MySQL');
    console.error('========================================');
    console.error(` Host:  ${cfg.host}:${cfg.port}`);
    console.error(` User:  ${cfg.user}`);
    console.error(` Error: ${err.code || ''} ${err.message}`);
    console.error('');
    if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
      console.error(' ➜ Open XAMPP Control Panel and START the MySQL module.');
      console.error(' ➜ Make sure MySQL is on port 3306 (XAMPP default).');
      console.error(' ➜ If you use a different port/password, create a .env file');
      console.error('    next to server.js with:');
      console.error('       DB_HOST=127.0.0.1');
      console.error('       DB_PORT=3306');
      console.error('       DB_USER=root');
      console.error('       DB_PASSWORD=');
      console.error('       DB_NAME=shelfmaster');
    } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error(' ➜ Wrong DB_USER / DB_PASSWORD. Check your .env file.');
    }
    console.error('========================================\n');
    return false;
  }
}

async function ensureDatabase() {
  if (pool) return pool;

  const databaseName = process.env.DB_NAME || 'shelfmaster';
  const adminConnection = await mysql.createConnection(dbConfig(false));
  await adminConnection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await adminConnection.end();

  pool = mysql.createPool(dbConfig(true));
  await createTables();
  return pool;
}

async function createTables() {
  const db = pool;

  await db.query(`CREATE TABLE IF NOT EXISTS auth_users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    auth_id VARCHAR(36),
    name VARCHAR(255),
    student_id VARCHAR(100),
    course_year VARCHAR(255),
    role VARCHAR(50) DEFAULT 'student',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (auth_id)
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS books (
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
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS book_copies (
    id VARCHAR(36) PRIMARY KEY,
    book_id VARCHAR(36) NOT NULL,
    copy_number INT NOT NULL DEFAULT 1,
    accession_id VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'available',
    date_acquired DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX (book_id),
    CONSTRAINT fk_book_copies_book FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
  )`);

  await db.query(`CREATE TABLE IF NOT EXISTS transactions (
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
  )`);

  // Add walk-in borrower columns (idempotent — silently skip if they exist)
  for (const alter of [
    `ALTER TABLE transactions ADD COLUMN walk_in_name VARCHAR(255) NULL`,
    `ALTER TABLE transactions ADD COLUMN walk_in_grade_section VARCHAR(100) NULL`,
    `ALTER TABLE transactions ADD COLUMN walk_in_lrn VARCHAR(50) NULL`,
    `ALTER TABLE transactions ADD COLUMN walk_in_teacher VARCHAR(255) NULL`,
    `ALTER TABLE transactions ADD COLUMN walk_in_employee_id VARCHAR(50) NULL`,
    `ALTER TABLE transactions ADD COLUMN walk_in_department VARCHAR(150) NULL`,
    `ALTER TABLE transactions ADD COLUMN walk_in_contact VARCHAR(100) NULL`,
  ]) {
    try { await db.query(alter); } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  }
  columnCache.delete('transactions');

  await db.query(`CREATE TABLE IF NOT EXISTS site_content (
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
  )`);

  await db.query(`INSERT INTO site_content (
    id,
    tagline,
    about_text,
    contact_email,
    contact_phone,
    contact_location,
    footer_text
  ) VALUES (?, ?, ?, ?, ?, ?, ?)
  ON DUPLICATE KEY UPDATE id = id`, [
    1,
    'Master Every Shelf',
    'ShelfMaster provides smart and reliable library management tools for organizing books, students, and borrowing records.',
    'ShelfMaster@wmsu.edu.ph',
    '0912-345-6789',
    'Normal Road, Zamboanga City',
    '© 2026 ShelfMaster Library. All rights reserved.',
  ]);
}

function isSafeIdentifier(value) {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value);
}

function assertTable(table) {
  const allowedTables = new Set(['users', 'books', 'book_copies', 'transactions', 'site_content']);
  if (!allowedTables.has(table)) {
    throw new Error('Table is not allowed.');
  }
}

function assertIdentifier(value) {
  if (!isSafeIdentifier(value)) {
    throw new Error('Invalid column name.');
  }
}

async function getColumns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  const db = await ensureDatabase();
  const [rows] = await db.query(`DESCRIBE \`${table}\``);
  const columns = new Set(rows.map(row => row.Field));
  columnCache.set(table, columns);
  return columns;
}

function cleanValue(value) {
  if (value === undefined || value === '') return null;
  return value;
}

async function cleanPayload(table, payload) {
  const columns = await getColumns(table);
  const cleaned = {};

  for (const [key, value] of Object.entries(payload || {})) {
    if (columns.has(key)) {
      cleaned[key] = cleanValue(value);
    }
  }

  if (table !== 'site_content' && !cleaned.id) {
    cleaned.id = uuidv4();
  }

  return cleaned;
}

function buildWhere(filters = []) {
  const clauses = [];
  const values = [];

  for (const filter of filters) {
    assertIdentifier(filter.column);
    const column = `\`${filter.column}\``;

    if (filter.op === 'eq') {
      clauses.push(`${column} = ?`);
      values.push(filter.value);
    } else if (filter.op === 'neq') {
      clauses.push(`(${column} <> ? OR ${column} IS NULL)`);
      values.push(filter.value);
    } else if (filter.op === 'gte') {
      clauses.push(`${column} >= ?`);
      values.push(filter.value);
    } else if (filter.op === 'lt') {
      clauses.push(`${column} < ?`);
      values.push(filter.value);
    } else if (filter.op === 'in') {
      const list = Array.isArray(filter.value) ? filter.value : [];
      if (list.length === 0) {
        clauses.push('1 = 0');
      } else {
        clauses.push(`${column} IN (${list.map(() => '?').join(', ')})`);
        values.push(...list);
      }
    }
  }

  return {
    sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '',
    values,
  };
}

async function attachRelations(table, rows, select = '') {
  if (!Array.isArray(rows) || rows.length === 0) return rows;
  const db = await ensureDatabase();
  const wantsBooks = select.includes('books');
  const wantsUsers = select.includes('users');
  const wantsCopies = select.includes('book_copies');
  const wantsTransactions = select.includes('transactions');

  if (table === 'transactions') {
    if (wantsBooks) {
      const ids = [...new Set(rows.map(row => row.book_id).filter(Boolean))];
      if (ids.length) {
        const [books] = await db.query(`SELECT * FROM books WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        const map = new Map(books.map(book => [book.id, book]));
        rows.forEach(row => { row.books = map.get(row.book_id) || null; });
      }
    }

    if (wantsUsers) {
      const ids = [...new Set(rows.map(row => row.user_id).filter(Boolean))];
      if (ids.length) {
        const [users] = await db.query(`SELECT * FROM users WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        const map = new Map(users.map(user => [user.id, user]));
        rows.forEach(row => { row.users = map.get(row.user_id) || null; });
      }
    }

    if (wantsCopies) {
      const ids = [...new Set(rows.map(row => row.copy_id).filter(Boolean))];
      if (ids.length) {
        const [copies] = await db.query(`SELECT * FROM book_copies WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        const map = new Map(copies.map(copy => [copy.id, copy]));
        rows.forEach(row => { row.book_copies = map.get(row.copy_id) || null; });
      }
    }
  }

  if (table === 'users' && wantsTransactions) {
    const ids = rows.map(row => row.id).filter(Boolean);
    if (ids.length) {
      const [transactions] = await db.query(`SELECT id, user_id, status FROM transactions WHERE user_id IN (${ids.map(() => '?').join(',')})`, ids);
      const grouped = new Map();
      transactions.forEach(transaction => {
        if (!grouped.has(transaction.user_id)) grouped.set(transaction.user_id, []);
        grouped.get(transaction.user_id).push(transaction);
      });
      rows.forEach(row => { row.transactions = grouped.get(row.id) || []; });
    }
  }

  return rows;
}

async function selectRows({ table, select, filters, order, limit, options, single, maybeSingle }) {
  const db = await ensureDatabase();
  const where = buildWhere(filters);

  if (options?.head) {
    const [countRows] = await db.query(`SELECT COUNT(*) AS count FROM \`${table}\`${where.sql}`, where.values);
    return { data: null, error: null, count: countRows[0]?.count || 0 };
  }

  let sql = `SELECT * FROM \`${table}\`${where.sql}`;
  const values = [...where.values];

  if (order?.column) {
    assertIdentifier(order.column);
    sql += ` ORDER BY \`${order.column}\` ${order.ascending === false ? 'DESC' : 'ASC'}`;
  }

  if (limit) {
    sql += ' LIMIT ?';
    values.push(Number(limit));
  }

  const [rows] = await db.query(sql, values);
  await attachRelations(table, rows, select || '');

  if (single || maybeSingle) {
    if (rows.length === 0) {
      return { data: null, error: maybeSingle ? null : { message: 'No rows found', code: 'PGRST116' }, count: rows.length };
    }
    return { data: rows[0], error: null, count: rows.length };
  }

  return { data: rows, error: null, count: rows.length };
}

async function insertRows({ table, payload, select, returning, single }) {
  const db = await ensureDatabase();
  const items = Array.isArray(payload) ? payload : [payload];
  const inserted = [];

  for (const item of items) {
    const cleaned = await cleanPayload(table, item);
    if (table === 'users') {
      const [[existingUsers]] = await db.query('SELECT COUNT(*) AS count FROM users');
      if ((existingUsers?.count || 0) === 0) {
        cleaned.role = 'librarian';
      }
    }
    const keys = Object.keys(cleaned);
    if (keys.length === 0) throw new Error('No valid fields to insert.');
    keys.forEach(assertIdentifier);

    await db.query(
      `INSERT INTO \`${table}\` (${keys.map(key => `\`${key}\``).join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map(key => cleaned[key])
    );
    inserted.push(cleaned);
  }

  if (returning) {
    const ids = inserted.map(item => item.id).filter(Boolean);
    if (ids.length) {
      const [rows] = await db.query(`SELECT * FROM \`${table}\` WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
      await attachRelations(table, rows, select || '');
      return { data: single ? rows[0] : rows, error: null, count: rows.length };
    }
  }

  return { data: returning ? inserted : null, error: null, count: inserted.length };
}

async function updateRows({ table, payload, filters, select, returning, single }) {
  const db = await ensureDatabase();
  const cleaned = await cleanPayload(table, payload);
  delete cleaned.id;
  const keys = Object.keys(cleaned);
  if (keys.length === 0) throw new Error('No valid fields to update.');
  keys.forEach(assertIdentifier);
  const where = buildWhere(filters);

  await db.query(
    `UPDATE \`${table}\` SET ${keys.map(key => `\`${key}\` = ?`).join(', ')}${where.sql}`,
    [...keys.map(key => cleaned[key]), ...where.values]
  );

  if (returning) {
    return selectRows({ table, select, filters, single, maybeSingle: single });
  }

  return { data: null, error: null };
}

async function getUserFromRequest(req) {
  const authHeader = req.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) return null;

  try {
    return jwt.verify(token, jwtSecret);
  } catch {
    return null;
  }
}

async function requireLibrarian(req, res) {
  const tokenUser = await getUserFromRequest(req);
  if (!tokenUser) {
    res.status(401).json({ error: 'Please sign in again before making this change.' });
    return null;
  }

  const db = await ensureDatabase();
  const [rows] = await db.query('SELECT role FROM users WHERE auth_id = ? LIMIT 1', [tokenUser.id]);
  if (!rows[0] || rows[0].role !== 'librarian') {
    res.status(403).json({ error: 'Only librarian accounts can make this change.' });
    return null;
  }

  return db;
}

app.get('/api/health', async (_req, res) => {
  try {
    await ensureDatabase();
    res.json({ ok: true, database: 'mysql' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get("/api/test", (req, res) => {
  res.json({ message: "Server OK" });
});

app.get('/api/lan-info', (_req, res) => {
  res.json({ port, addresses: getLanAddresses() });
});

app.post('/api/auth/signup', async (req, res) => {
  try {
    const db = await ensureDatabase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    await db.query('INSERT INTO auth_users (id, email, password_hash) VALUES (?, ?, ?)', [id, email, passwordHash]);
    res.json({ user: { id, email } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const db = await ensureDatabase();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const [rows] = await db.query('SELECT * FROM auth_users WHERE email = ? LIMIT 1', [email]);
    const authUser = rows[0];

    if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
      res.status(401).json({ error: 'Invalid login credentials' });
      return;
    }

    const token = jwt.sign({ id: authUser.id, email: authUser.email }, jwtSecret, { expiresIn: '7d' });
    res.json({ user: { id: authUser.id, email: authUser.email }, session: { access_token: token, user: { id: authUser.id, email: authUser.email } } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/auth/user', async (req, res) => {
  const user = await getUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Not signed in.' });
    return;
  }
  res.json({ user: { id: user.id, email: user.email } });
});

app.post('/api/db/query', async (req, res) => {
  try {
    const body = req.body || {};
    assertTable(body.table);

    let result;
    if (body.action === 'insert') {
      result = await insertRows(body);
    } else if (body.action === 'update') {
      result = await updateRows(body);
    } else {
      result = await selectRows(body);
    }

    res.json(result);
  } catch (error) {
    res.json({ data: null, error: { message: error.message }, count: 0 });
  }
});

app.post('/api/books/:id/archive', async (req, res) => {
  const db = await requireLibrarian(req, res);
  if (!db) return;

  try {
    await db.query('UPDATE books SET status = ? WHERE id = ?', ['archived', req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:id/unarchive', async (req, res) => {
  const db = await requireLibrarian(req, res);
  if (!db) return;

  try {
    await db.query('UPDATE books SET status = ? WHERE id = ?', ['active', req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  const db = await requireLibrarian(req, res);
  if (!db) return;

  try {
    await db.query('DELETE FROM books WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ebooks', async (req, res) => {
  const db = await requireLibrarian(req, res);
  if (!db) return;

  try {
    const title = String(req.body?.title || '').trim();
    const source = String(req.body?.url || '').trim();

    if (!title || !source) {
      res.status(400).json({ error: 'Please enter both an eBook title and URL.' });
      return;
    }

    const [last] = await db.query('SELECT accession_num FROM books ORDER BY accession_num DESC LIMIT 1');
    const lastNum = Number.parseInt(last[0]?.accession_num, 10) || 0;
    const nextAcc = (lastNum + 1).toString().padStart(5, '0');
    const id = uuidv4();

    await db.query(
      'INSERT INTO books (id, accession_num, title, authors, quantity, book_type, source, date_acquired, status) VALUES (?, ?, ?, ?, ?, ?, ?, CURDATE(), ?)',
      [id, nextAcc, title, 'eBook', 1, 'eBook', source, 'active']
    );

    const [rows] = await db.query('SELECT * FROM books WHERE id = ?', [id]);
    res.json({ ok: true, ebook: rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/ebooks/:id', async (req, res) => {
  const db = await requireLibrarian(req, res);
  if (!db) return;

  try {
    const title = String(req.body?.title || '').trim();
    const source = String(req.body?.url || '').trim();

    if (!title || !source) {
      res.status(400).json({ error: 'Please enter both an eBook title and URL.' });
      return;
    }

    await db.query('UPDATE books SET title = ?, source = ? WHERE id = ? AND book_type = ?', [title, source, req.params.id, 'eBook']);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/storage/upload', async (req, res) => {
  const db = await requireLibrarian(req, res);
  if (!db) return;

  try {
    const uploadPath = String(req.body?.path || '').replace(/^\/+/, '');
    const dataUrl = String(req.body?.dataUrl || '');
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);

    if (!uploadPath || !match || uploadPath.includes('..')) {
      res.status(400).json({ error: 'Invalid upload.' });
      return;
    }

    const fullPath = path.join(uploadsDir, uploadPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, Buffer.from(match[2], 'base64'));
    res.json({ ok: true, publicUrl: `/uploads/${uploadPath}` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

if (isProduction) {
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  });
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true, host: '0.0.0.0', allowedHosts: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(port, '0.0.0.0', async () => {
  console.log(`ShelfMaster running on port ${port}`);
  await checkMysqlAvailable();
});
