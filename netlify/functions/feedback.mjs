import { getStore } from '@netlify/blobs';
import { randomUUID } from 'node:crypto';

const STORE = 'simplestock-feedback';

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });

export default async (request) => {
  try {
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

    if (!useful && !confusing && !missing && !remove) {
      return json({ ok: false, error: 'Please share at least one piece of feedback.' }, 400);
    }

    const entry = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      testerType,
      useful,
      confusing,
      remove,
      missing,
      wouldUse,
      contact
    };

    const store = getStore(STORE);
    await store.setJSON(`feedback:${entry.createdAt}:${entry.id}`, entry);

    return json({ ok: true });
  } catch (error) {
    console.error('SimpleStock feedback error:', error);
    return json({ ok: false, error: 'Could not submit feedback.' }, 500);
  }
};
