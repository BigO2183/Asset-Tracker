import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const DATA_STORE = 'simplestock-workspaces';
const AUTH_STORE = 'simplestock-auth';

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });

const sessionKey = (token) =>
  `session:${createHash('sha256').update(String(token)).digest('hex')}`;
const userKey = (email) =>
  `user:${createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex')}`;

async function requireUser(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const authStore = getStore(AUTH_STORE);
  const session = await authStore.get(sessionKey(token), {
    type: 'json',
    consistency: 'strong'
  });
  if (!session || !session.expiresAt || Date.now() > Number(session.expiresAt)) {
    if (session) await authStore.delete(sessionKey(token));
    return null;
  }

  const user = await authStore.get(userKey(session.email), {
    type: 'json',
    consistency: 'strong'
  });
  if (!user) return null;

  return { session, user };
}

export default async (request) => {
  try {
    const active = await requireUser(request);
    if (!active) return json({ ok: false, error: 'Not signed in.' }, 401);

    const canEdit = active.user.role === 'owner' || Boolean(active.user.canEdit);
    const store = getStore(DATA_STORE);
    const recordKey = `workspace:${active.user.workspaceId}:inventory-state`;

    if (request.method === 'GET') {
      const data = await store.get(recordKey, {
        type: 'json',
        consistency: 'strong'
      });

      return json({
        exists: Boolean(data),
        canEdit,
        data: data || { items: [], history: [], updatedAt: null }
      });
    }

    if (request.method === 'POST') {
      if (!canEdit) {
        return json({ ok: false, error: 'This staff account is view-only.' }, 403);
      }

      const incoming = await request.json();
      if (!incoming || !Array.isArray(incoming.items) || !Array.isArray(incoming.history)) {
        return json({ ok: false, error: 'Invalid inventory payload.' }, 400);
      }

      const data = {
        items: incoming.items,
        history: incoming.history.slice(0, 500),
        updatedAt: new Date().toISOString()
      };
      await store.setJSON(recordKey, data);
      return json({ ok: true, updatedAt: data.updatedAt });
    }

    return json({ ok: false, error: 'Method not allowed.' }, 405);
  } catch (error) {
    console.error('SimpleStock inventory error:', error);
    return json({ ok: false, error: error?.message || 'Cloud storage error.' }, 500);
  }
};
