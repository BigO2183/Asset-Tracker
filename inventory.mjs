import { getStore } from '@netlify/blobs';

const STORE_NAME = 'simplestock-shared';
const RECORD_KEY = 'inventory-state';

const json = (statusCode, body) => ({
  statusCode,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  },
  body: JSON.stringify(body)
});

export default async (request) => {
  try {
    const store = getStore(STORE_NAME);

    if (request.method === 'GET') {
      const data = await store.get(RECORD_KEY, { type: 'json' });
      return json(200, {
        exists: Boolean(data),
        data: data || { items: [], history: [], updatedAt: null }
      });
    }

    if (request.method === 'POST') {
      const incoming = await request.json();

      if (!incoming || !Array.isArray(incoming.items) || !Array.isArray(incoming.history)) {
        return json(400, { ok: false, error: 'Invalid inventory payload.' });
      }

      const data = {
        items: incoming.items,
        history: incoming.history.slice(0, 500),
        updatedAt: new Date().toISOString()
      };

      await store.setJSON(RECORD_KEY, data);
      return json(200, { ok: true, updatedAt: data.updatedAt });
    }

    return json(405, { ok: false, error: 'Method not allowed.' });
  } catch (error) {
    console.error(error);
    return json(500, { ok: false, error: 'Cloud storage error.' });
  }
};
