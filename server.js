const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const express = require('express');
const { Pool } = require('pg');

const scrypt = promisify(crypto.scrypt);
const app = express();
const port = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, 'upload');
const authSecret = process.env.AUTH_SECRET || crypto.randomBytes(32).toString('hex');

app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));

let pool = null;
if (process.env.DATABASE_URL) {
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, '\n');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000
  });
}

let databaseReady = false;
async function ensureDatabase() {
  if (!pool) throw new Error('Database is not configured');
  if (databaseReady) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGSERIAL PRIMARY KEY,
      full_name VARCHAR(120) NOT NULL,
      identifier VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plaintext_password_demo (
      id BIGSERIAL PRIMARY KEY,
      account_name VARCHAR(120) NOT NULL UNIQUE,
      password VARCHAR(255) NOT NULL,
      warning TEXT NOT NULL DEFAULT 'School demonstration only — never store real passwords this way.'
    )
  `);
  await pool.query(`
    INSERT INTO plaintext_password_demo (account_name, password)
    VALUES
      ('dummy_student_1', 'Password123'),
      ('dummy_student_2', 'facebook2026'),
      ('dummy_student_3', 'qwerty123')
    ON CONFLICT (account_name) DO NOTHING
  `);
  databaseReady = true;
}

function normalizeIdentifier(value) {
  return String(value || '').trim().toLowerCase();
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const [algorithm, saltHex, hashHex] = String(stored || '').split(':');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function encode(value) {
  return Buffer.from(value).toString('base64url');
}

function signSession(user) {
  const payload = encode(JSON.stringify({
    id: String(user.id),
    name: user.full_name,
    exp: Date.now() + 7 * 24 * 60 * 60 * 1000
  }));
  const signature = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function readSession(request) {
  const cookie = String(request.headers.cookie || '')
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith('facebook_session='));
  if (!cookie) return null;
  const token = cookie.slice('facebook_session='.length);
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  const expected = crypto.createHmac('sha256', authSecret).update(payload).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.exp > Date.now() ? session : null;
  } catch (_error) {
    return null;
  }
}

function setSessionCookie(response, user) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  response.setHeader('Set-Cookie', `facebook_session=${signSession(user)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${secure}`);
}

function requireAuth(request, response, next) {
  const session = readSession(request);
  if (!session) return response.redirect('/');
  request.user = session;
  next();
}

const loginAttempts = new Map();
function loginAllowed(ip) {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt < now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + 15 * 60 * 1000 });
    return true;
  }
  current.count += 1;
  return current.count <= 10;
}

app.get('/api/health', async (_request, response) => {
  if (!pool) return response.json({ ok: true, database: 'not-configured' });
  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('Aiven health check failed:', error.message);
    response.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.post('/api/register', async (request, response) => {
  const fullName = String(request.body?.fullName || '').trim();
  const identifier = normalizeIdentifier(request.body?.identifier);
  const password = String(request.body?.password || '');
  if (fullName.length < 2 || fullName.length > 120) return response.status(400).json({ error: 'Enter your full name.' });
  if (identifier.length < 5 || identifier.length > 255) return response.status(400).json({ error: 'Enter a valid mobile number or email.' });
  if (password.length < 6 || password.length > 200) return response.status(400).json({ error: 'Password must contain at least 6 characters.' });
  try {
    await ensureDatabase();
    const passwordHash = await hashPassword(password);
    const result = await pool.query(
      'INSERT INTO users (full_name, identifier, password_hash) VALUES ($1, $2, $3) RETURNING id, full_name',
      [fullName, identifier, passwordHash]
    );
    setSessionCookie(response, result.rows[0]);
    response.status(201).json({ ok: true, redirect: '/app' });
  } catch (error) {
    if (error.code === '23505') return response.status(409).json({ error: 'An account already exists for this mobile number or email.' });
    console.error('Registration failed:', error.message);
    response.status(500).json({ error: 'Could not create the account. Try again.' });
  }
});

app.post('/api/login', async (request, response) => {
  if (!loginAllowed(request.ip)) return response.status(429).json({ error: 'Too many attempts. Try again later.' });
  const identifier = normalizeIdentifier(request.body?.identifier);
  const password = String(request.body?.password || '');
  if (!identifier || !password) return response.status(400).json({ error: 'Enter your mobile number or email and password.' });
  try {
    await ensureDatabase();
    const result = await pool.query('SELECT id, full_name, password_hash FROM users WHERE identifier = $1 LIMIT 1', [identifier]);
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) return response.status(401).json({ error: 'The login details you entered are incorrect.' });
    loginAttempts.delete(request.ip);
    setSessionCookie(response, user);
    response.json({ ok: true, redirect: '/app' });
  } catch (error) {
    console.error('Login failed:', error.message);
    response.status(500).json({ error: 'Login is unavailable. Try again.' });
  }
});

app.post('/api/logout', (_request, response) => {
  response.setHeader('Set-Cookie', 'facebook_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  response.json({ ok: true });
});

app.get('/api/me', (request, response) => {
  const session = readSession(request);
  if (!session) return response.status(401).json({ authenticated: false });
  response.json({ authenticated: true, user: { id: session.id, name: session.name } });
});

app.get('/', (request, response) => {
  if (readSession(request)) return response.redirect('/app');
  response.sendFile(path.join(publicDirectory, 'login.html'));
});

app.get('/app', requireAuth, (_request, response) => {
  response.sendFile(path.join(publicDirectory, 'profile_pagee.html'));
});

app.get('*splat', (request, response) => response.redirect(readSession(request) ? '/app' : '/'));

const server = app.listen(port, '0.0.0.0', async () => {
  console.log(`Website listening on port ${port}`);
  if (pool) {
    try {
      await ensureDatabase();
      console.log('Authentication database ready');
    } catch (error) {
      console.error('Authentication database setup failed:', error.message);
    }
  }
});

async function shutdown() {
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
