const http = require('http');
const https = require('https');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AGENT_KEY = process.env.AGENT_KEY || 'avia2024';

// ── In-memory leads store ──
let leads = [];

function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch(e) { resolve({}); }
    });
  });
}

function parseQuery(url) {
  const idx = url.indexOf('?');
  if (idx === -1) return {};
  return Object.fromEntries(new URLSearchParams(url.slice(idx + 1)));
}

function setCORS(res, methods = 'POST, GET, OPTIONS') {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', methods);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

// ── AGENT_HTML inline (loaded once) ──
const fs = require('fs');
const path = require('path');
const AGENT_HTML = fs.readFileSync(path.join(__dirname, 'agent.html'), 'utf8');

const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = req.url.split('?')[0];
  const q = parseQuery(req.url);

  // ══ Agent dashboard ══
  if (req.method === 'GET' && url === '/agent') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(AGENT_HTML);
    return;
  }

  // ══ Get leads list ══
  if (req.method === 'GET' && url === '/api/leads') {
    if (q.key !== AGENT_KEY) { json(res, { error: 'unauthorized' }, 401); return; }
    json(res, leads);
    return;
  }

  // ══ Save new lead ══
  if (req.method === 'POST' && url === '/api/lead') {
    const lead = await parseBody(req);
    if (!lead.id) { json(res, { error: 'missing id' }, 400); return; }
    // Avoid duplicate (same appointment id)
    if (!leads.find(l => l.id === lead.id)) {
      lead.timestamp = new Date().toISOString();
      lead.status = 'new';
      lead.notes = '';
      lead.price = '';
      leads.unshift(lead);
    }
    json(res, { ok: true, total: leads.length });
    return;
  }

  // ══ Update lead (status / notes / price) ══
  if (req.method === 'POST' && url === '/api/lead/update') {
    if (q.key !== AGENT_KEY) { json(res, { error: 'unauthorized' }, 401); return; }
    const body = await parseBody(req);
    const idx = leads.findIndex(l => l.id === body.id);
    if (idx !== -1) {
      if (body.status !== undefined) leads[idx].status = body.status;
      if (body.notes !== undefined) leads[idx].notes = body.notes;
      if (body.price !== undefined) leads[idx].price = body.price;
    }
    json(res, { ok: true });
    return;
  }

  // ══ AI chat proxy (bot + agent) ══
  if (req.method === 'POST' && url === '/api/chat') {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const options = {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': body.length
        }
      };
      const proxyReq = https.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode, { 'Content-Type': 'application/json' });
        proxyRes.pipe(res);
      });
      proxyReq.on('error', (e) => {
        res.writeHead(500);
        res.end(JSON.stringify({ error: e.message }));
      });
      proxyReq.write(body);
      proxyReq.end();
    });
    return;
  }

  // ══ Health check ══
  json(res, { status: 'Avia Bot Server Running', leads: leads.length });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
