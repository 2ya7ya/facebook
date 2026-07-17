const path = require('path');
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT || 3000);
const publicDirectory = path.join(__dirname, 'upload');

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use('/files', express.static(publicDirectory, { index: false }));

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

app.get('/api/health', async (_request, response) => {
  if (!pool) {
    return response.json({ ok: true, database: 'not-configured' });
  }

  try {
    await pool.query('SELECT 1');
    response.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('Aiven health check failed:', error.message);
    response.status(503).json({ ok: false, database: 'unavailable' });
  }
});

app.get('/', (_request, response) => {
  response.sendFile(path.join(publicDirectory, 'profile_pagee.html'));
});

app.get('*splat', (_request, response) => {
  response.sendFile(path.join(publicDirectory, 'profile_pagee.html'));
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Website listening on port ${port}`);
});

async function shutdown() {
  server.close(async () => {
    if (pool) await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
