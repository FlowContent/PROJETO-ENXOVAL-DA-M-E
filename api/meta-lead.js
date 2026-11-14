// API de Conversões da Meta: envia o evento Lead pelo servidor.
// Fica em /api/meta-lead no projeto da Vercel.
//
// Variáveis de ambiente (Vercel > Project > Settings > Environment Variables):
//   META_PIXEL_ID      ID do pixel/conjunto de dados (obrigatório)
//   META_CAPI_TOKEN    token de acesso do Gerenciador de Eventos (obrigatório)
//   META_TEST_CODE     código de teste (ex.: TEST12345). Opcional: use só durante o teste e apague depois
//   ALLOWED_ORIGINS    domínios que podem chamar a função, separados por vírgula (opcional)
//                      ex.: https://enxovaldamae.online,https://www.enxovaldamae.online

const GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0';

function allowedOrigins() {
  const fromEnv = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return fromEnv.length
    ? fromEnv
    : ['https://enxovaldamae.online', 'https://www.enxovaldamae.online'];
}

function parseBody(body) {
  if (!body) return {};
  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (typeof body === 'string') {
    try { return JSON.parse(body); } catch { return {}; }
  }
  return typeof body === 'object' ? body : {};
}

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || undefined;
}

function clean(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;
  const origins = allowedOrigins();
  if (origin && origins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  if (origin && !origins.includes(origin)) return res.status(403).json({ ok: false, error: 'origin_not_allowed' });

  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return res.status(500).json({ ok: false, error: 'missing_env' });

  const b = parseBody(req.body);
  if (!b.event_id) return res.status(400).json({ ok: false, error: 'missing_event_id' });

  const event = clean({
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    event_id: String(b.event_id).slice(0, 100),
    action_source: 'website',
    event_source_url: b.url || req.headers.referer,
    user_data: clean({
      client_ip_address: clientIp(req),
      client_user_agent: req.headers['user-agent'],
      fbp: b.fbp,
      fbc: b.fbc,
    }),
    custom_data: clean({ content_name: b.content_name || 'Entrar no grupo' }),
  });

  const payload = clean({
    data: [event],
    test_event_code: process.env.META_TEST_CODE,
  });

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('Meta CAPI error', r.status, JSON.stringify(data));
      return res.status(502).json({ ok: false, error: 'meta_error' });
    }
    return res.status(200).json({ ok: true, events_received: data.events_received });
  } catch (err) {
    console.error('Meta CAPI fetch failed', err);
    return res.status(502).json({ ok: false, error: 'fetch_failed' });
  }
};
