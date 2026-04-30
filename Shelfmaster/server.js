import 'dotenv/config';
import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { createClient } from '@supabase/supabase-js';
import { createServer as createViteServer } from 'vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import { sendMail, htmlEmail, getMailerMode } from './mailer.js';

const app = express();
const port = Number(process.env.PORT || 5000);
const isProduction = process.env.NODE_ENV === 'production';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uploadsDir = path.join(__dirname, 'public', 'uploads');
const jwtSecret = process.env.JWT_SECRET || 'shelfmaster-local-dev-secret';
const APP_BASE_URL = (process.env.APP_BASE_URL || '').replace(/\/+$/, '');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n========================================');
  console.error(' ❌ Missing Supabase configuration');
  console.error('========================================');
  console.error(' Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in your environment.');
  console.error(' Find both values in your Supabase dashboard → Settings → API.');
  console.error('========================================\n');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Allow-list of tables clients may query through /api/db/query.
const ALLOWED_TABLES = new Set(['users', 'books', 'book_copies', 'transactions', 'site_content', 'notifications']);

app.use(express.json({ limit: '15mb' }));

// CORS — allow LAN devices on a different origin to call this server's API.
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

function assertTable(table) {
  if (!ALLOWED_TABLES.has(table)) {
    throw new Error('Table is not allowed.');
  }
}

function cleanValue(value) {
  if (value === undefined || value === '') return null;
  return value;
}

function cleanPayload(table, payload) {
  const cleaned = {};
  for (const [key, value] of Object.entries(payload || {})) {
    cleaned[key] = cleanValue(value);
  }
  if (table !== 'site_content' && !cleaned.id) {
    cleaned.id = uuidv4();
  }
  return cleaned;
}

function applyFilters(query, filters = []) {
  for (const filter of filters) {
    if (!filter || !filter.column) continue;
    switch (filter.op) {
      case 'eq':
        query = query.eq(filter.column, filter.value);
        break;
      case 'neq':
        query = query.neq(filter.column, filter.value);
        break;
      case 'gte':
        query = query.gte(filter.column, filter.value);
        break;
      case 'lt':
        query = query.lt(filter.column, filter.value);
        break;
      case 'in': {
        const list = Array.isArray(filter.value) ? filter.value : [];
        query = query.in(filter.column, list);
        break;
      }
      default:
        break;
    }
  }
  return query;
}

async function selectRows({ table, select, filters, order, limit, options, single, maybeSingle }) {
  const wantsCount = options?.count;
  const headOnly = !!options?.head;
  const selectArgs = [select && select.length ? select : '*'];
  if (wantsCount || headOnly) {
    selectArgs.push({ count: wantsCount || 'exact', head: headOnly });
  }

  let query = supabase.from(table).select(...selectArgs);
  query = applyFilters(query, filters);

  if (order?.column) {
    query = query.order(order.column, { ascending: order.ascending !== false });
  }
  if (limit) {
    query = query.limit(Number(limit));
  }
  if (single) query = query.single();
  else if (maybeSingle) query = query.maybeSingle();

  const { data, error, count } = await query;
  return { data: data ?? null, error: error || null, count: count ?? (Array.isArray(data) ? data.length : data ? 1 : 0) };
}

async function insertRows({ table, payload, select, returning, single }) {
  const items = Array.isArray(payload) ? payload : [payload];
  const cleanedItems = items.map(item => cleanPayload(table, item));

  // Preserve old behaviour: the very first user account becomes a librarian
  // so a fresh database is administrable without manual SQL.
  if (table === 'users') {
    const { count, error: countError } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true });
    if (countError) {
      return { data: null, error: countError, count: 0 };
    }
    if ((count || 0) === 0) {
      cleanedItems.forEach(item => { item.role = 'librarian'; });
    }
  }

  let query = supabase.from(table).insert(cleanedItems);
  if (returning) {
    query = query.select(select && select.length ? select : '*');
    if (single) query = query.single();
  }

  const { data, error, count } = await query;
  return { data: data ?? null, error: error || null, count: count ?? (Array.isArray(data) ? data.length : 0) };
}

async function updateRows({ table, payload, filters, select, returning, single }) {
  const cleaned = cleanPayload(table, payload);
  delete cleaned.id;

  let query = supabase.from(table).update(cleaned);
  query = applyFilters(query, filters);

  if (returning) {
    query = query.select(select && select.length ? select : '*');
    if (single) query = query.single();
  }

  const { data, error, count } = await query;
  return { data: data ?? null, error: error || null, count: count ?? 0 };
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

  const { data, error } = await supabase
    .from('users')
    .select('role')
    .eq('auth_id', tokenUser.id)
    .maybeSingle();

  if (error || !data || data.role !== 'librarian') {
    res.status(403).json({ error: 'Only librarian accounts can make this change.' });
    return null;
  }
  return tokenUser;
}

app.get('/api/health', async (_req, res) => {
  try {
    const { error } = await supabase.from('site_content').select('id').limit(1);
    if (error && error.code !== 'PGRST116') throw error;
    res.json({ ok: true, database: 'supabase' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/test', (_req, res) => {
  res.json({ message: 'Server OK' });
});

app.get('/api/lan-info', (_req, res) => {
  res.json({ port, addresses: getLanAddresses() });
});

function buildVerifyUrl(req, token) {
  const base = APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/verify?token=${encodeURIComponent(token)}`;
}

app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const { data: existing } = await supabase
      .from('auth_users')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (existing) {
      res.status(400).json({ error: 'An account with that email already exists.' });
      return;
    }

    // First account ever created is auto-verified AND becomes a librarian once
    // its profile row is inserted — keeps the system administrable from a
    // fresh database without anyone having to manually click an email link.
    const { count: existingCount } = await supabase
      .from('auth_users')
      .select('id', { count: 'exact', head: true });
    const isFirstAccount = (existingCount || 0) === 0;

    const id = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const verificationToken = isFirstAccount ? null : crypto.randomBytes(24).toString('hex');

    const { error } = await supabase
      .from('auth_users')
      .insert({
        id,
        email,
        password_hash: passwordHash,
        verified: isFirstAccount ? true : false,
        verification_token: verificationToken,
      });
    if (error) throw error;

    let verifyUrl = null;
    if (!isFirstAccount) {
      verifyUrl = buildVerifyUrl(req, verificationToken);
      await sendMail({
        to: email,
        subject: 'Confirm your ShelfMaster account',
        html: htmlEmail({
          heading: 'Welcome to ShelfMaster!',
          body: `Tap the button below to confirm your email address and finish setting up your account.<br><br><span style="color:#64748b;font-size:13px">If the button doesn't work, copy and paste this link:<br><code style="word-break:break-all">${verifyUrl}</code></span>`,
          ctaUrl: verifyUrl,
          ctaLabel: 'Confirm my email',
        }),
        text: `Welcome to ShelfMaster! Confirm your email by visiting:\n${verifyUrl}`,
      });
    }

    res.json({
      user: { id, email },
      verified: isFirstAccount,
      mailer: getMailerMode(),
      // Only echoed when the mailer is in console mode so devs can finish signup
      // without an SMTP server. In SMTP mode the link is null and only goes via email.
      verifyUrl: getMailerMode() === 'console' ? verifyUrl : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');

    const { data: authUser, error } = await supabase
      .from('auth_users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (error) throw error;

    if (!authUser || !(await bcrypt.compare(password, authUser.password_hash))) {
      res.status(401).json({ error: 'Invalid login credentials' });
      return;
    }

    if (authUser.verified === false) {
      res.status(403).json({
        error: 'Please verify your email address before signing in. Check your inbox for the confirmation link.',
        code: 'email_not_verified',
      });
      return;
    }

    // Reject login for archived user accounts.
    const { data: profile } = await supabase
      .from('users')
      .select('archived_at')
      .eq('auth_id', authUser.id)
      .maybeSingle();
    if (profile?.archived_at) {
      res.status(403).json({ error: 'This account has been archived. Please contact a librarian.' });
      return;
    }

    const token = jwt.sign({ id: authUser.id, email: authUser.email }, jwtSecret, { expiresIn: '7d' });
    res.json({
      user: { id: authUser.id, email: authUser.email },
      session: { access_token: token, user: { id: authUser.id, email: authUser.email } },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Consumes the verification token sent in the signup email.
app.post('/api/auth/verify', async (req, res) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) { res.status(400).json({ error: 'Missing token.' }); return; }

    const { data: row, error } = await supabase
      .from('auth_users')
      .select('id, email, verified')
      .eq('verification_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) { res.status(400).json({ error: 'Invalid or expired verification link.' }); return; }
    if (row.verified) { res.json({ ok: true, alreadyVerified: true, email: row.email }); return; }

    const { error: updErr } = await supabase
      .from('auth_users')
      .update({ verified: true, verification_token: null })
      .eq('id', row.id);
    if (updErr) throw updErr;

    res.json({ ok: true, email: row.email });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Re-sends the verification email if the user lost it.
app.post('/api/auth/resend-verification', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) { res.status(400).json({ error: 'Email required.' }); return; }

    const { data: row } = await supabase
      .from('auth_users')
      .select('id, email, verified, verification_token')
      .eq('email', email)
      .maybeSingle();
    if (!row) { res.json({ ok: true }); return; } // don't leak existence
    if (row.verified) { res.json({ ok: true, alreadyVerified: true }); return; }

    const token = row.verification_token || crypto.randomBytes(24).toString('hex');
    if (!row.verification_token) {
      await supabase.from('auth_users').update({ verification_token: token }).eq('id', row.id);
    }

    const verifyUrl = buildVerifyUrl(req, token);
    await sendMail({
      to: email,
      subject: 'Confirm your ShelfMaster account',
      html: htmlEmail({
        heading: 'Confirm your email',
        body: `Tap the button below to confirm your email address.<br><br><span style="color:#64748b;font-size:13px">Or open this link:<br><code style="word-break:break-all">${verifyUrl}</code></span>`,
        ctaUrl: verifyUrl,
        ctaLabel: 'Confirm my email',
      }),
      text: `Confirm your ShelfMaster email at:\n${verifyUrl}`,
    });

    res.json({ ok: true, mailer: getMailerMode(), verifyUrl: getMailerMode() === 'console' ? verifyUrl : null });
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
  if (!(await requireLibrarian(req, res))) return;
  try {
    const { error } = await supabase.from('books').update({ status: 'archived' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/books/:id/unarchive', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;
  try {
    const { error } = await supabase.from('books').update({ status: 'active' }).eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/books/:id', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;
  try {
    const { error } = await supabase.from('books').delete().eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- User management (librarian-only) ---------------------------------------
app.post('/api/users/:id/archive', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;
  try {
    const { error } = await supabase
      .from('users')
      .update({ archived_at: new Date().toISOString(), status: 'archived' })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/users/:id/unarchive', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;
  try {
    const { error } = await supabase
      .from('users')
      .update({ archived_at: null, status: 'active' })
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Hard-delete a user (and their auth row). Cascades to transactions via the
// FK on transactions.user_id (set null) and removes their auth credentials.
app.delete('/api/users/:id', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;
  try {
    const { data: u, error: fetchErr } = await supabase
      .from('users')
      .select('id, auth_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!u) { res.json({ ok: true, deleted: 0 }); return; }

    const { error: delProfile } = await supabase.from('users').delete().eq('id', u.id);
    if (delProfile) throw delProfile;
    if (u.auth_id) {
      await supabase.from('auth_users').delete().eq('id', u.auth_id);
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Notifications -----------------------------------------------------------
// Insert an in-app notification AND send an email (if SMTP configured).
// Used by the librarian portal when approving/declining/charging fines.
app.post('/api/notifications', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;
  try {
    const userId = String(req.body?.user_id || '').trim();
    const type   = String(req.body?.type || 'general').trim();
    const title  = String(req.body?.title || '').trim();
    const body   = String(req.body?.body || '').trim();
    if (!userId || !title) { res.status(400).json({ error: 'user_id and title are required.' }); return; }

    // Look up the recipient's email address.
    const { data: recipient } = await supabase
      .from('users')
      .select('id, name, auth_id')
      .eq('id', userId)
      .maybeSingle();
    let email = null;
    if (recipient?.auth_id) {
      const { data: au } = await supabase
        .from('auth_users')
        .select('email')
        .eq('id', recipient.auth_id)
        .maybeSingle();
      email = au?.email || null;
    }

    let emailSent = false;
    if (email) {
      const r = await sendMail({
        to: email,
        subject: `[ShelfMaster] ${title}`,
        html: htmlEmail({ heading: title, body: body.replace(/\n/g, '<br>') }),
        text: body,
      });
      emailSent = !!r.ok;
    }

    const id = uuidv4();
    const { error } = await supabase
      .from('notifications')
      .insert({ id, user_id: userId, type, title, body, email_sent: emailSent });
    if (error) throw error;

    res.json({ ok: true, id, email_sent: emailSent, mailer: getMailerMode() });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/ebooks', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;

  try {
    const title = String(req.body?.title || '').trim();
    const source = String(req.body?.url || '').trim();

    if (!title || !source) {
      res.status(400).json({ error: 'Please enter both an eBook title and URL.' });
      return;
    }

    const { data: lastRows, error: lastErr } = await supabase
      .from('books')
      .select('accession_num')
      .order('accession_num', { ascending: false })
      .limit(1);
    if (lastErr) throw lastErr;

    const lastNum = Number.parseInt(lastRows?.[0]?.accession_num, 10) || 0;
    const nextAcc = (lastNum + 1).toString().padStart(5, '0');
    const id = uuidv4();
    const today = new Date().toISOString().slice(0, 10);

    const { data: inserted, error: insertErr } = await supabase
      .from('books')
      .insert({
        id,
        accession_num: nextAcc,
        title,
        authors: 'eBook',
        quantity: 1,
        book_type: 'eBook',
        source,
        date_acquired: today,
        status: 'active',
      })
      .select()
      .single();
    if (insertErr) throw insertErr;

    res.json({ ok: true, ebook: inserted });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.patch('/api/ebooks/:id', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;

  try {
    const title = String(req.body?.title || '').trim();
    const source = String(req.body?.url || '').trim();

    if (!title || !source) {
      res.status(400).json({ error: 'Please enter both an eBook title and URL.' });
      return;
    }

    const { error } = await supabase
      .from('books')
      .update({ title, source })
      .eq('id', req.params.id)
      .eq('book_type', 'eBook');
    if (error) throw error;

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/storage/upload', async (req, res) => {
  if (!(await requireLibrarian(req, res))) return;

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

async function checkSupabaseReachable() {
  try {
    const { error } = await supabase.from('site_content').select('id').limit(1);
    if (error && error.code === '42P01') {
      console.error('\n========================================');
      console.error(' ⚠️  Supabase reachable but tables are missing.');
      console.error('========================================');
      console.error(' Open your Supabase project → SQL Editor and run');
      console.error(' the contents of supabase_schema.sql once.');
      console.error('========================================\n');
      return;
    }
    if (error) throw error;
    console.log(`[db] Supabase reachable at ${SUPABASE_URL}`);
  } catch (err) {
    console.error('\n========================================');
    console.error(' ❌ Cannot reach Supabase');
    console.error('========================================');
    console.error(` URL:   ${SUPABASE_URL}`);
    console.error(` Error: ${err.message}`);
    console.error('========================================\n');
  }
}

app.listen(port, '0.0.0.0', async () => {
  console.log(`ShelfMaster running on port ${port}`);
  console.log(`[mailer] mode = ${getMailerMode()}${getMailerMode() === 'console' ? ' (set SMTP_HOST/SMTP_USER/SMTP_PASS to send real email)' : ''}`);
  await checkSupabaseReachable();
});
