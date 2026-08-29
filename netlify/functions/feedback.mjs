import { getStore } from '@netlify/blobs';
import { randomUUID, createHash } from 'node:crypto';

const STORE = 'simplestock-feedback';
const AUTH_STORE = 'simplestock-auth';

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });

const sessionKey = (token) =>
  `session:${createHash('sha256').update(String(token)).digest('hex')}`;

const userKey = (email) =>
  `user:${createHash('sha256')
    .update(String(email).trim().toLowerCase())
    .digest('hex')}`;

async function requirePlatformAdmin(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const authStore = getStore(AUTH_STORE);
  const session = await authStore.get(sessionKey(token), {
    type: 'json',
    consistency: 'strong'
  });

  if (!session || !session.expiresAt || Date.now() > Number(session.expiresAt)) {
    return null;
  }

  const user = await authStore.get(userKey(session.email), {
    type: 'json',
    consistency: 'strong'
  });

  const adminEmail = String(process.env.SIMPLESTOCK_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();

  if (!user || !adminEmail || String(user.email).toLowerCase() !== adminEmail) {
    return null;
  }

  return user;
}

export default async (request) => {
  try {
    const store = getStore(STORE);

    if (request.method === 'GET') {
      const owner = await requirePlatformAdmin(request);
      if (!owner) {
        return json({ ok: false, error: 'Platform admin access required.' }, 403);
      }

      const entries = [];
      const { blobs } = await store.list({ prefix: 'feedback:' });

      for (const blob of blobs) {
        const entry = await store.get(blob.key, {
          type: 'json',
          consistency: 'strong'
        });
        if (entry) entries.push(entry);
      }

      entries.sort((a, b) =>
        String(b.createdAt || '').localeCompare(String(a.createdAt || ''))
      );

      return json({
        ok: true,
        feedback: entries
      });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, 405);
    }

    const body = await request.json().catch(() => ({}));

    const useful = String(body.useful || '').trim();
    const confusing = String(body.confusing || '').trim();
    const remove = String(body.remove || '').trim();
    const missing = String(body.missing || '').trim();
    const wouldUse = String(body.wouldUse || '').trim();
    const contact = String(body.contact || '').trim();
    const testerType = String(body.testerType || '').trim();
    const kind = body.kind === 'bug' ? 'bug' : 'feedback';

    if (!useful && !confusing && !missing && !remove) {
      return json(
        { ok: false, error: 'Please share at least one piece of feedback.' },
        400
      );
    }

    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      kind,
      testerType,
      useful,
      confusing,
      remove,
      missing,
      wouldUse,
      contact
    };

    await store.setJSON(`feedback:${entry.createdAt}:${entry.id}`, entry);

    return json({ ok: true });
  } catch (error) {
    console.error('SimpleStock feedback error:', error);
    return json(
      { ok: false, error: error?.message || 'Could not handle feedback.' },
      500
    );
  }
};
