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
app.use(express.json({ limit: '32mb' }));

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
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_photo TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS cover_photo TEXT');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_frame_name VARCHAR(120)');
  await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_frame_svg TEXT');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL DEFAULT '',
      image_data TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reels (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      caption VARCHAR(500) NOT NULL DEFAULT '',
      video_data TEXT NOT NULL,
      mime_type VARCHAR(120) NOT NULL,
      visibility VARCHAR(20) NOT NULL DEFAULT 'followers',
      allow_comments BOOLEAN NOT NULL DEFAULT TRUE,
      edit_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE reels ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'followers'");
  await pool.query('ALTER TABLE reels ADD COLUMN IF NOT EXISTS allow_comments BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query("ALTER TABLE reels ADD COLUMN IF NOT EXISTS edit_data JSONB NOT NULL DEFAULT '{}'::jsonb");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stories (
      id BIGSERIAL PRIMARY KEY,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      caption VARCHAR(500) NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reel_likes (
      reel_id BIGINT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (reel_id, user_id)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reel_comments (
      id BIGSERIAL PRIMARY KEY,
      reel_id BIGINT NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query('CREATE INDEX IF NOT EXISTS post_comments_post_id_idx ON post_comments (post_id, created_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS reel_comments_reel_id_idx ON reel_comments (reel_id, created_at)');
  await pool.query('CREATE INDEX IF NOT EXISTS reels_created_at_idx ON reels (created_at DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS stories_created_at_idx ON stories (created_at DESC)');
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

function requireApiAuth(request, response, next) {
  const session = readSession(request);
  if (!session) return response.status(401).json({ error: 'Sign in to continue.' });
  request.user = session;
  next();
}

function validImageData(value) {
  if (value === null || value === undefined || value === '') return true;
  return typeof value === 'string' && value.length <= 8 * 1024 * 1024 && /^data:image\/(?:png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value);
}

function validVideoData(value) {
  return typeof value === 'string'
    && value.length <= 28 * 1024 * 1024
    && /^data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=\s]+$/i.test(value);
}

function validNumericId(value) {
  return /^\d+$/.test(String(value || ''));
}

function normalizeReelEdits(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const number = (input, minimum, maximum, fallback) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
  };
  const effects = new Set([
    'none','enhance','portrait','soft','vivid','pop','warm','golden','sunset','cool','arctic','teal','emerald','rose','lavender',
    'cinematic','blockbuster','film','vintage','matte','fade','dream','sepia','mono','noir','silvertone','washed','dramatic',
    'lowlight','midnight','neon','cyber','electric','infrared','negative','haze'
  ]);
  const visualEffects = new Set([
    'none','rgb-split','glitch','vhs','old-tv','scanlines','pixelate','posterize','edge-glow','thermal','mirror',
    'split-screen','kaleidoscope','fisheye','ripple','wave','zoom-pulse','shake','strobe','ghost','tunnel',
    'bloom','grain','vignette','bokeh-blur','lens-flare','motion-blur','bling','dynamic-distort','prism','light-leak',
    'datamosh','block-glitch','digital-rain','color-trails','echo-zoom','radial-blur','swirl','stretch','liquid-glass','flash-zoom','dream-glow',
    'mini-zoom','zoom-lens','blur','shaky-camera-move','delay','shake-2','astral','shake-1','neon-dynamic','bounce-camera',
    'trembling','black-flash','shake-dynamic','soul','disco-count','2026-loading','lyric-cut','quick-speed','particles',
    'question-mark','energy','moon-off','shockwave','somethings-wrong','small-body-big-head','goat-eyes','halo',
    'facial-fisheye','half-face-whirl','laser-eyes','shy','feeling-hurt','face-mosaic','laser'
  ]);
  const normalizeClip = (clip, index) => {
    clip = clip && typeof clip === 'object' ? clip : {};
    const start = number(clip.sourceStart, 0, 3600, 0);
    const end = number(clip.sourceEnd, start + 0.05, 3600, start + 0.05);
    return {
      id: String(clip.id || `clip-${index + 1}`).slice(0, 80),
      sourceStart: start,
      sourceEnd: end,
      availableStart: number(clip.availableStart, 0, 3600, 0),
      availableEnd: number(clip.availableEnd, end, 3600, end),
      speed: number(clip.speed, 0.25, 4, 1),
      brightness: number(clip.brightness, 0.5, 1.5, 1),
      contrast: number(clip.contrast, 0.5, 1.5, 1),
      saturation: number(clip.saturation, 0, 2, 1),
      effect: effects.has(clip.effect) ? clip.effect : 'none',
      visualEffect: visualEffects.has(clip.visualEffect) ? clip.visualEffect : 'none',
      text: String(clip.text || '').slice(0, 100),
      sticker: String(clip.sticker || '').slice(0, 8),
      captions: Boolean(clip.captions),
      overlay: Boolean(clip.overlay),
      fit: clip.fit === 'cover' ? 'cover' : 'contain'
    };
  };
  const clips = Array.isArray(source.clips) ? source.clips.slice(0, 100).map(normalizeClip) : [];
  const clipIds = new Set(clips.map(clip => clip.id));
  const transitions = Array.isArray(source.transitions) ? source.transitions.slice(0, 99).map(item => ({
    fromId: String(item?.fromId || '').slice(0, 80),
    toId: String(item?.toId || '').slice(0, 80),
    type: ['none','fade','dissolve','wipe','slide'].includes(item?.type) ? item.type : 'none',
    duration: number(item?.duration, 0, 1, 0)
  })).filter(item => clipIds.has(item.fromId) && clipIds.has(item.toId)) : [];
  return {
    trimStart: number(source.trimStart, 0, 3600, 0),
    trimEnd: number(source.trimEnd, 0, 3600, 0),
    brightness: number(source.brightness, 0.5, 1.5, 1),
    contrast: number(source.contrast, 0.5, 1.5, 1),
    saturation: number(source.saturation, 0, 2, 1),
    effect: effects.has(source.effect) ? source.effect : 'none',
    visualEffect: visualEffects.has(source.visualEffect) ? source.visualEffect : 'none',
    text: String(source.text || '').slice(0, 100),
    sticker: String(source.sticker || '').slice(0, 8),
    captions: Boolean(source.captions),
    overlay: Boolean(source.overlay),
    fit: source.fit === 'cover' ? 'cover' : 'contain',
    clips,
    transitions,
    rendered: Boolean(source.rendered)
  };
}

function validProfileFrame(name, svg) {
  if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 120)) return false;
  if (svg === undefined || svg === null || svg === '') return true;
  return typeof svg === 'string'
    && svg.length <= 30000
    && /^\s*<svg(?:\s|>)/i.test(svg)
    && !/<script|javascript:|on\w+\s*=/i.test(svg);
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

app.get('/api/profile', requireApiAuth, async (request, response) => {
  try {
    await ensureDatabase();
    const result = await pool.query(
      'SELECT id, full_name, profile_photo, cover_photo, profile_frame_name, profile_frame_svg FROM users WHERE id = $1 LIMIT 1',
      [request.user.id]
    );
    const user = result.rows[0];
    if (!user) return response.status(404).json({ error: 'Account not found.' });
    response.json({
      id: String(user.id),
      name: user.full_name,
      profilePhoto: user.profile_photo || '',
      coverPhoto: user.cover_photo || '',
      profileFrameName: user.profile_frame_name || '',
      profileFrameSvg: user.profile_frame_svg || ''
    });
  } catch (error) {
    console.error('Profile load failed:', error.message);
    response.status(500).json({ error: 'Could not load the profile.' });
  }
});

app.put('/api/profile', requireApiAuth, async (request, response) => {
  const profilePhoto = request.body?.profilePhoto;
  const coverPhoto = request.body?.coverPhoto;
  const profileFrameName = request.body?.profileFrameName;
  const profileFrameSvg = request.body?.profileFrameSvg;
  if (profilePhoto === undefined && coverPhoto === undefined && profileFrameName === undefined && profileFrameSvg === undefined) {
    return response.status(400).json({ error: 'No profile changes supplied.' });
  }
  if (!validImageData(profilePhoto) || !validImageData(coverPhoto)) return response.status(400).json({ error: 'Choose a valid image smaller than 6 MB.' });
  if (!validProfileFrame(profileFrameName, profileFrameSvg)) return response.status(400).json({ error: 'Choose a valid profile frame.' });
  try {
    await ensureDatabase();
    const result = await pool.query(
      `UPDATE users
       SET profile_photo = CASE WHEN $2::boolean THEN $3 ELSE profile_photo END,
           cover_photo = CASE WHEN $4::boolean THEN $5 ELSE cover_photo END,
           profile_frame_name = CASE WHEN $6::boolean THEN $7 ELSE profile_frame_name END,
           profile_frame_svg = CASE WHEN $8::boolean THEN $9 ELSE profile_frame_svg END
       WHERE id = $1
       RETURNING id, full_name, profile_photo, cover_photo, profile_frame_name, profile_frame_svg`,
      [
        request.user.id,
        profilePhoto !== undefined, profilePhoto || null,
        coverPhoto !== undefined, coverPhoto || null,
        profileFrameName !== undefined, profileFrameName || null,
        profileFrameSvg !== undefined, profileFrameSvg || null
      ]
    );
    const user = result.rows[0];
    response.json({
      ok: true,
      name: user.full_name,
      profilePhoto: user.profile_photo || '',
      coverPhoto: user.cover_photo || '',
      profileFrameName: user.profile_frame_name || '',
      profileFrameSvg: user.profile_frame_svg || ''
    });
  } catch (error) {
    console.error('Profile update failed:', error.message);
    response.status(500).json({ error: 'Could not save the photo.' });
  }
});

app.get('/api/posts', requireApiAuth, async (request, response) => {
  try {
    await ensureDatabase();
    const result = await pool.query(`
      WITH like_counts AS (
        SELECT post_id, COUNT(*)::int AS like_count FROM post_likes GROUP BY post_id
      ), my_likes AS (
        SELECT post_id FROM post_likes WHERE user_id = $1
      )
      SELECT p.id, p.user_id, p.body, p.image_data, p.created_at, u.full_name, u.profile_photo,
             COALESCE(lc.like_count, 0)::int AS like_count,
             (ml.post_id IS NOT NULL) AS liked_by_me
      FROM posts p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN like_counts lc ON lc.post_id = p.id
      LEFT JOIN my_likes ml ON ml.post_id = p.id
      ORDER BY p.created_at DESC
      LIMIT 50
    `, [request.user.id]);
    const commentsByPost = new Map();
    if (result.rows.length) {
      const ids = result.rows.map(row => String(row.id));
      const placeholders = ids.map((_id, index) => `$${index + 1}`).join(',');
      const commentResult = await pool.query(
        `SELECT pc.id, pc.post_id, pc.user_id, pc.body, pc.created_at, u.full_name
         FROM post_comments pc
         JOIN users u ON u.id = pc.user_id
         WHERE pc.post_id IN (${placeholders})
         ORDER BY pc.created_at`,
        ids
      );
      commentResult.rows.forEach(row => {
        const key = String(row.post_id);
        if (!commentsByPost.has(key)) commentsByPost.set(key, []);
        commentsByPost.get(key).push({
          id: String(row.id),
          userId: String(row.user_id),
          author: row.full_name,
          body: row.body,
          createdAt: row.created_at
        });
      });
    }
    response.json({ posts: result.rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      body: row.body,
      image: row.image_data || '',
      createdAt: row.created_at,
      author: row.full_name,
      profilePhoto: row.profile_photo || '',
      likeCount: Number(row.like_count || 0),
      likedByMe: Boolean(row.liked_by_me),
      comments: commentsByPost.get(String(row.id)) || []
    })) });
  } catch (error) {
    console.error('Posts load failed:', error.message);
    response.status(500).json({ error: 'Could not load posts.' });
  }
});

app.post('/api/posts', requireApiAuth, async (request, response) => {
  const body = String(request.body?.body || '').trim();
  const image = request.body?.image || '';
  if (!body && !image) return response.status(400).json({ error: 'Write something or add a photo.' });
  if (body.length > 5000) return response.status(400).json({ error: 'Post text is too long.' });
  if (!validImageData(image)) return response.status(400).json({ error: 'Choose a valid image smaller than 6 MB.' });
  try {
    await ensureDatabase();
    const result = await pool.query(
      `INSERT INTO posts (user_id, body, image_data)
       VALUES ($1, $2, $3)
       RETURNING id, body, image_data, created_at`,
      [request.user.id, body, image || null]
    );
    response.status(201).json({ ok: true, post: result.rows[0] });
  } catch (error) {
    console.error('Post creation failed:', error.message);
    response.status(500).json({ error: 'Could not save the post.' });
  }
});

app.post('/api/posts/:postId/like', requireApiAuth, async (request, response) => {
  const postId = request.params.postId;
  if (!validNumericId(postId)) return response.status(400).json({ error: 'Invalid post.' });
  try {
    await ensureDatabase();
    const removed = await pool.query('DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2 RETURNING post_id', [postId, request.user.id]);
    let liked = false;
    if (!removed.rowCount) {
      await pool.query('INSERT INTO post_likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [postId, request.user.id]);
      liked = true;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM post_likes WHERE post_id = $1', [postId]);
    response.json({ ok: true, liked, likeCount: Number(count.rows[0].count) });
  } catch (error) {
    if (error.code === '23503') return response.status(404).json({ error: 'Post not found.' });
    console.error('Post like failed:', error.message);
    response.status(500).json({ error: 'Could not update the like.' });
  }
});

app.post('/api/posts/:postId/comments', requireApiAuth, async (request, response) => {
  const postId = request.params.postId;
  const body = String(request.body?.body || '').trim();
  if (!validNumericId(postId)) return response.status(400).json({ error: 'Invalid post.' });
  if (!body || body.length > 1000) return response.status(400).json({ error: 'Write a comment up to 1,000 characters.' });
  try {
    await ensureDatabase();
    const result = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, body, created_at`,
      [postId, request.user.id, body]
    );
    const comment = result.rows[0];
    response.status(201).json({ ok: true, comment: {
      id: String(comment.id),
      userId: String(comment.user_id),
      author: request.user.name,
      body: comment.body,
      createdAt: comment.created_at
    } });
  } catch (error) {
    if (error.code === '23503') return response.status(404).json({ error: 'Post not found.' });
    console.error('Post comment failed:', error.message);
    response.status(500).json({ error: 'Could not add the comment.' });
  }
});

app.get('/api/stories', requireApiAuth, async (_request, response) => {
  try {
    await ensureDatabase();
    const result = await pool.query(`
      SELECT s.id, s.user_id, s.image_data, s.caption, s.created_at, u.full_name, u.profile_photo
      FROM stories s
      JOIN users u ON u.id = s.user_id
      WHERE s.created_at >= NOW() - INTERVAL '24 hours'
      ORDER BY s.created_at DESC
      LIMIT 50
    `);
    response.json({ stories: result.rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      image: row.image_data,
      caption: row.caption,
      createdAt: row.created_at,
      author: row.full_name,
      profilePhoto: row.profile_photo || ''
    })) });
  } catch (error) {
    console.error('Stories load failed:', error.message);
    response.status(500).json({ error: 'Could not load stories.' });
  }
});

app.post('/api/stories', requireApiAuth, async (request, response) => {
  const image = request.body?.image || '';
  const caption = String(request.body?.caption || '').trim();
  if (!image || !validImageData(image)) return response.status(400).json({ error: 'Choose a valid story photo smaller than 6 MB.' });
  if (caption.length > 500) return response.status(400).json({ error: 'Story text is too long.' });
  try {
    await ensureDatabase();
    const result = await pool.query(
      `INSERT INTO stories (user_id, image_data, caption)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, image_data, caption, created_at`,
      [request.user.id, image, caption]
    );
    response.status(201).json({ ok: true, story: result.rows[0] });
  } catch (error) {
    console.error('Story creation failed:', error.message);
    response.status(500).json({ error: 'Could not publish the story.' });
  }
});

app.get('/api/reels', requireApiAuth, async (request, response) => {
  try {
    await ensureDatabase();
    const result = await pool.query(`
      WITH like_counts AS (
        SELECT reel_id, COUNT(*)::int AS like_count FROM reel_likes GROUP BY reel_id
      ), my_likes AS (
        SELECT reel_id FROM reel_likes WHERE user_id = $1
      )
      SELECT r.id, r.user_id, r.caption, r.video_data, r.mime_type, r.visibility, r.allow_comments, r.edit_data, r.created_at, u.full_name, u.profile_photo,
             COALESCE(lc.like_count, 0)::int AS like_count,
             (ml.reel_id IS NOT NULL) AS liked_by_me
      FROM reels r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN like_counts lc ON lc.reel_id = r.id
      LEFT JOIN my_likes ml ON ml.reel_id = r.id
      ORDER BY r.created_at DESC
      LIMIT 1
    `, [request.user.id]);
    const commentsByReel = new Map();
    if (result.rows.length) {
      const reelId = String(result.rows[0].id);
      const commentResult = await pool.query(
        `SELECT rc.id, rc.reel_id, rc.user_id, rc.body, rc.created_at, u.full_name
         FROM reel_comments rc
         JOIN users u ON u.id = rc.user_id
         WHERE rc.reel_id = $1
         ORDER BY rc.created_at`,
        [reelId]
      );
      commentsByReel.set(reelId, commentResult.rows.map(row => ({
        id: String(row.id),
        userId: String(row.user_id),
        author: row.full_name,
        body: row.body,
        createdAt: row.created_at
      })));
    }
    response.json({ reels: result.rows.map(row => ({
      id: String(row.id),
      userId: String(row.user_id),
      caption: row.caption,
      video: row.video_data,
      mimeType: row.mime_type,
      visibility: row.visibility,
      allowComments: Boolean(row.allow_comments),
      editData: normalizeReelEdits(row.edit_data),
      createdAt: row.created_at,
      author: row.full_name,
      profilePhoto: row.profile_photo || '',
      likeCount: Number(row.like_count || 0),
      likedByMe: Boolean(row.liked_by_me),
      comments: commentsByReel.get(String(row.id)) || []
    })) });
  } catch (error) {
    console.error('Reels load failed:', error.message);
    response.status(500).json({ error: 'Could not load reels.' });
  }
});

app.post('/api/reels', requireApiAuth, async (request, response) => {
  const video = request.body?.video || '';
  const caption = String(request.body?.caption || '').trim();
  const detectedType = /^data:(video\/[a-z0-9.+-]+);base64,/i.exec(video)?.[1] || '';
  const mimeType = String(request.body?.mimeType || detectedType).trim().toLowerCase();
  const visibility = String(request.body?.visibility || 'followers').trim().toLowerCase();
  const allowComments = request.body?.allowComments !== false;
  const editData = normalizeReelEdits(request.body?.editData);
  if (!validVideoData(video)) return response.status(400).json({ error: 'Choose a valid rendered video smaller than 20 MB.' });
  if (!/^video\/[a-z0-9.+-]+$/i.test(mimeType) || !video.toLowerCase().startsWith(`data:${mimeType};base64,`)) {
    return response.status(400).json({ error: 'The selected video format is not supported.' });
  }
  if (caption.length > 500) return response.status(400).json({ error: 'Reel caption is too long.' });
  if (!['followers', 'friends', 'only-me'].includes(visibility)) return response.status(400).json({ error: 'Choose a valid Reel audience.' });
  try {
    await ensureDatabase();
    const result = await pool.query(
      `INSERT INTO reels (user_id, caption, video_data, mime_type, visibility, allow_comments, edit_data)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, user_id, caption, video_data, mime_type, visibility, allow_comments, edit_data, created_at`,
      [request.user.id, caption, video, mimeType, visibility, allowComments, editData]
    );
    response.status(201).json({ ok: true, reel: result.rows[0] });
  } catch (error) {
    console.error('Reel creation failed:', error.message);
    response.status(500).json({ error: 'Could not publish the reel.' });
  }
});

app.post('/api/reels/:reelId/like', requireApiAuth, async (request, response) => {
  const reelId = request.params.reelId;
  if (!validNumericId(reelId)) return response.status(400).json({ error: 'Invalid reel.' });
  try {
    await ensureDatabase();
    const removed = await pool.query('DELETE FROM reel_likes WHERE reel_id = $1 AND user_id = $2 RETURNING reel_id', [reelId, request.user.id]);
    let liked = false;
    if (!removed.rowCount) {
      await pool.query('INSERT INTO reel_likes (reel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [reelId, request.user.id]);
      liked = true;
    }
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM reel_likes WHERE reel_id = $1', [reelId]);
    response.json({ ok: true, liked, likeCount: Number(count.rows[0].count) });
  } catch (error) {
    if (error.code === '23503') return response.status(404).json({ error: 'Reel not found.' });
    console.error('Reel like failed:', error.message);
    response.status(500).json({ error: 'Could not update the like.' });
  }
});

app.post('/api/reels/:reelId/comments', requireApiAuth, async (request, response) => {
  const reelId = request.params.reelId;
  const body = String(request.body?.body || '').trim();
  if (!validNumericId(reelId)) return response.status(400).json({ error: 'Invalid reel.' });
  if (!body || body.length > 1000) return response.status(400).json({ error: 'Write a comment up to 1,000 characters.' });
  try {
    await ensureDatabase();
    const reel = await pool.query('SELECT allow_comments FROM reels WHERE id = $1 LIMIT 1', [reelId]);
    if (!reel.rows[0]) return response.status(404).json({ error: 'Reel not found.' });
    if (!reel.rows[0].allow_comments) return response.status(403).json({ error: 'Comments are turned off for this Reel.' });
    const result = await pool.query(
      `INSERT INTO reel_comments (reel_id, user_id, body)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, body, created_at`,
      [reelId, request.user.id, body]
    );
    const comment = result.rows[0];
    response.status(201).json({ ok: true, comment: {
      id: String(comment.id),
      userId: String(comment.user_id),
      author: request.user.name,
      body: comment.body,
      createdAt: comment.created_at
    } });
  } catch (error) {
    if (error.code === '23503') return response.status(404).json({ error: 'Reel not found.' });
    console.error('Reel comment failed:', error.message);
    response.status(500).json({ error: 'Could not add the comment.' });
  }
});

app.get('/', (request, response) => {
  if (readSession(request)) return response.redirect('/app');
  response.sendFile(path.join(publicDirectory, 'login.html'));
});

app.get('/app', requireAuth, (_request, response) => {
  response.sendFile(path.join(publicDirectory, 'profile_pagee.html'));
});

app.get('/app-data.js', requireAuth, (_request, response) => {
  response.type('application/javascript').sendFile(path.join(publicDirectory, 'app-data.js'));
});

app.get('/reel-effects.js', requireAuth, (_request, response) => {
  response.type('application/javascript').sendFile(path.join(publicDirectory, 'reel-effects.js'));
});

app.use('/mediapipe', requireAuth, express.static(path.join(__dirname, 'node_modules', '@mediapipe', 'face_mesh')));

app.get('/reel-ui/:asset', requireAuth, (request, response) => {
  const allowed = new Set(['reel-undo.png', 'reel-redo.png', 'reel-fullscreen.png', 'reel-minimize.png']);
  if (!allowed.has(request.params.asset)) return response.sendStatus(404);
  response.sendFile(path.join(publicDirectory, request.params.asset));
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
