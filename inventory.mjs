import { getStore } from '@netlify/blobs';

const STORE_NAME = 'simplestock-shared';
const RECORD_KEY = 'inventory-state';

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });

export default async (request) => {
  try {
    const store = getStore(STORE_NAME);

    if (request.method === 'GET') {
      const data = await store.get(RECORD_KEY, {
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
          { ok: false, error: 'Invalid inventory payload.' },
          400
        );
      }

      const data = {
        items: incoming.items,
        history: incoming.history.slice(0, 500),
        updatedAt: new Date().toISOString()
      };

      await store.setJSON(RECORD_KEY, data);

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
    console.error('SimpleStock cloud function error:', error);

    return json(
      {
        ok: false,
        error: error?.message || 'Cloud storage error.'
      },
      500
    );
  }
};
