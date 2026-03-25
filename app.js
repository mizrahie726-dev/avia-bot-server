const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const AGENT_KEY = process.env.AGENT_KEY || 'avia2024';

// ── In-memory stores ──
let leads = [];
const businesses = new Map();

// ── Helpers ──
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

function generateId(len = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < len; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function buildSystemPrompt({ name, type, services, hours, phone, faq }) {
  return `אתה עוזר AI של עסק בשם "${name}".
תחום העסק: ${type}
שירותים: ${services}
שעות פעילות: ${hours}
טלפון ליצירת קשר: ${phone}

שאלות ותשובות נפוצות:
${faq}

חוקים:
- ענה בעברית בלבד, בצורה ידידותית ומקצועית
- אל תמציא מידע שאינו מופיע כאן
- אם שאלה חורגת מהמידע שלך, הפנה לטלפון ${phone}
- שמור על תשובות קצרות — עד 3 משפטים`;
}

// ── AGENT_HTML inline ──
const AGENT_HTML = fs.readFileSync(path.join(__dirname, 'agent.html'), 'utf8');

// ── Anthropic direct call helper ──
function callAnthropic(systemPrompt, messages) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: systemPrompt,
      messages: messages
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, (proxyRes) => {
      const chunks = [];
      proxyRes.on('data', c => chunks.push(c));
      proxyRes.on('end', () => {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data);
        } catch(e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const url = req.url.split('?')[0];
  const q = parseQuery(req.url);

  // ▶▶ Agent dashboard
  if (req.method === 'GET' && url === '/agent') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(AGENT_HTML);
    return;
  }

  // ▶▶ Get leads list
  if (req.method === 'GET' && url === '/api/leads') {
    if (q.key !== AGENT_KEY) { json(res, { error: 'unauthorized' }, 401); return; }
    json(res, leads);
    return;
  }

  // ▶▶ Save new lead
  if (req.method === 'POST' && url === '/api/lead') {
    const lead = await parseBody(req);
    if (!lead.id) { json(res, { error: 'missing id' }, 400); return; }
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

  // ▶▶ Update lead (status / notes / price)
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

  // ▶▶ AI chat proxy (original bot + agent) — BACKWARD COMPATIBLE
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

  // ▶▶ Register a new business
  if (req.method === 'POST' && url === '/api/register') {
    const body = await parseBody(req);
    const { name, type, services, hours, phone, faq, color, greeting } = body;

    if (!name) { json(res, { error: 'name is required' }, 400); return; }

    let businessId = generateId(8);
    // ensure uniqueness
    while (businesses.has(businessId)) { businessId = generateId(8); }

    const systemPrompt = buildSystemPrompt({
      name: name || '',
      type: type || '',
      services: services || '',
      hours: hours || '',
      phone: phone || '',
      faq: faq || ''
    });

    businesses.set(businessId, {
      id: businessId,
      name,
      type: type || '',
      services: services || '',
      hours: hours || '',
      phone: phone || '',
      faq: faq || '',
      color: color || '#3B82F6',
      greeting: greeting || `שלום! איך אפשר לעזור לך היום?`,
      systemPrompt,
      createdAt: new Date().toISOString()
    });

    const baseUrl = 'https://nodejs-production-55c3.up.railway.app';
    const embedCode = `<script src="${baseUrl}/widget.js?id=${businessId}" defer></script>`;

    json(res, { id: businessId, embedCode });
    return;
  }

  // ▶▶ Get public business config (no systemPrompt)
  if (req.method === 'GET' && url.startsWith('/api/config/')) {
    const businessId = url.slice('/api/config/'.length);
    const biz = businesses.get(businessId);
    if (!biz) { json(res, { error: 'not found' }, 404); return; }
    json(res, {
      id: biz.id,
      name: biz.name,
      color: biz.color,
      greeting: biz.greeting
    });
    return;
  }

  // ▶▶ Widget chat endpoint
  if (req.method === 'POST' && url === '/api/widget-chat') {
    const body = await parseBody(req);
    const { businessId, message, history } = body;

    if (!businessId || !message) {
      json(res, { error: 'businessId and message are required' }, 400);
      return;
    }

    const biz = businesses.get(businessId);
    if (!biz) { json(res, { error: 'business not found' }, 404); return; }

    try {
      const recentHistory = Array.isArray(history) ? history.slice(-6) : [];
      const messages = [...recentHistory, { role: 'user', content: message }];
      const data = await callAnthropic(biz.systemPrompt, messages);

      if (data.content && data.content[0] && data.content[0].text) {
        json(res, { response: data.content[0].text });
      } else {
        json(res, { error: 'unexpected API response', details: data }, 502);
      }
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
    return;
  }

  // ▶▶ Serve widget.js
  if (req.method === 'GET' && url === '/widget.js') {
    const widgetPath = path.join(__dirname, 'public', 'widget.js');
    if (fs.existsSync(widgetPath)) {
      const content = fs.readFileSync(widgetPath, 'utf8');
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(content);
    } else {
      res.writeHead(404);
      res.end('widget.js not found');
    }
    return;
  }

  // ▶▶ Health check
  json(res, { status: 'Avia Bot Server Running', leads: leads.length, businesses: businesses.size });
});

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
