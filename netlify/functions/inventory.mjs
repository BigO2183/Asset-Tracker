import { getStore } from '@netlify/blobs';
import { createHash } from 'node:crypto';

const DATA_STORE = 'simplestock-workspaces';
const AUTH_STORE = 'simplestock-auth';

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });

const sessionKey = (token) =>
  `session:${createHash('sha256')
    .update(String(token))
    .digest('hex')}`;

async function requireSession(request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ')
    ? header.slice(7).trim()
    : '';

  if (!token) return null;

  const authStore = getStore(AUTH_STORE);

  const session = await authStore.get(sessionKey(token), {
    type: 'json',
    consistency: 'strong'
  });

  if (!session) return null;

  if (
    !session.expiresAt ||
    Date.now() > Number(session.expiresAt)
  ) {
    await authStore.delete(sessionKey(token));
    return null;
  }

  return session;
}

export default async (request) => {
  try {
    const session = await requireSession(request);

    if (!session) {
      return json(
        { ok: false, error: 'Not signed in.' },
        401
      );
    }

    const store = getStore(DATA_STORE);

    const recordKey =
      `workspace:${session.workspaceId}:inventory-state`;

    if (request.method === 'GET') {
      const data = await store.get(recordKey, {
        type: 'json',
        consistency: 'strong'
      });

      return json({
        exists: Boolean(data),
        data: data || {
          items: [],
          history: [],
          updatedAt: null
        }
      });
    }

    if (request.method === 'POST') {
      const incoming = await request.json();

      if (
        !incoming ||
        !Array.isArray(incoming.items) ||
        !Array.isArray(incoming.history)
      ) {
        return json(
          {
            ok: false,
            error: 'Invalid inventory payload.'
          },
          400
        );
      }

      const data = {
        items: incoming.items,
        history: incoming.history.slice(0, 500),
        updatedAt: new Date().toISOString()
      };

      await store.setJSON(recordKey, data);

      return json({
        ok: true,
        updatedAt: data.updatedAt
      });
    }

    return json(
      { ok: false, error: 'Method not allowed.' },
      405
    );
  } catch (error) {
    console.error(
      'SimpleStock workspace inventory error:',
      error
    );

    return json(
      {
        ok: false,
        error: error?.message || 'Cloud storage error.'
      },
      500
    );
  }
};
