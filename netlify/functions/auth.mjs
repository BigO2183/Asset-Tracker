import { getStore } from '@netlify/blobs';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash
} from 'node:crypto';

const AUTH_STORE = 'simplestock-auth';
const SESSION_DAYS = 30;

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });

const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const emailKey = (email) =>
  `user:${createHash('sha256').update(normalizeEmail(email)).digest('hex')}`;
const sessionKey = (token) =>
  `session:${createHash('sha256').update(String(token)).digest('hex')}`;

const passwordHash = (password, salt) =>
  scryptSync(String(password), salt, 64).toString('hex');

const safeUser = (user) => ({
  email: user.email,
  role: user.role,
  workspaceId: user.workspaceId,
  workspaceName: user.workspaceName,
  defaultMode: user.defaultMode || 'reseller'
});

async function getSession(store, request) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const session = await store.get(sessionKey(token), {
    type: 'json',
    consistency: 'strong'
  });
  if (!session) return null;

  if (!session.expiresAt || Date.now() > Number(session.expiresAt)) {
    await store.delete(sessionKey(token));
    return null;
  }

  const user = await store.get(emailKey(session.email), {
    type: 'json',
    consistency: 'strong'
  });
  if (!user) return null;

  return { token, session, user };
}

export default async (request) => {
  try {
    const store = getStore(AUTH_STORE);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    if (request.method === 'GET' && action === 'me') {
      const active = await getSession(store, request);
      if (!active) return json({ ok: false, error: 'Not signed in.' }, 401);
      return json({ ok: true, user: safeUser(active.user) });
    }

    if (request.method !== 'POST') {
      return json({ ok: false, error: 'Method not allowed.' }, 405);
    }

    const body = await request.json().catch(() => ({}));

    if (action === 'signup') {
      const workspaceName = String(body.workspaceName || '').trim();
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      const defaultMode = body.defaultMode === 'estate' ? 'estate' : 'reseller';

      if (workspaceName.length < 2) {
        return json({ ok: false, error: 'Enter a business or workspace name.' }, 400);
      }
      if (!email.includes('@')) {
        return json({ ok: false, error: 'Enter a valid email.' }, 400);
      }
      if (password.length < 8) {
        return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);
      }

      const existing = await store.get(emailKey(email), {
        type: 'json',
        consistency: 'strong'
      });
      if (existing) {
        return json({ ok: false, error: 'An account with that email already exists.' }, 409);
      }

      const salt = randomBytes(16).toString('hex');
      const user = {
        email,
        role: 'owner',
        workspaceId: randomUUID(),
        workspaceName,
        defaultMode,
        salt,
        passwordHash: passwordHash(password, salt),
        createdAt: new Date().toISOString()
      };

      await store.setJSON(emailKey(email), user);

      const token = randomBytes(32).toString('hex');
      await store.setJSON(sessionKey(token), {
        email,
        workspaceId: user.workspaceId,
        role: user.role,
        expiresAt: Date.now() + SESSION_DAYS * 86400000
      });

      return json({
        ok: true,
        token,
        user: safeUser(user)
      });
    }

    if (action === 'login') {
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');

      const user = await store.get(emailKey(email), {
        type: 'json',
        consistency: 'strong'
      });
      if (!user) return json({ ok: false, error: 'Incorrect email or password.' }, 401);

      const supplied = Buffer.from(passwordHash(password, user.salt), 'hex');
      const expected = Buffer.from(user.passwordHash, 'hex');

      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return json({ ok: false, error: 'Incorrect email or password.' }, 401);
      }

      const token = randomBytes(32).toString('hex');
      await store.setJSON(sessionKey(token), {
        email,
        workspaceId: user.workspaceId,
        role: user.role,
        expiresAt: Date.now() + SESSION_DAYS * 86400000
      });

      return json({
        ok: true,
        token,
        user: safeUser(user)
      });
    }

    if (action === 'logout') {
      const active = await getSession(store, request);
      if (active) await store.delete(sessionKey(active.token));
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action.' }, 404);
  } catch (error) {
    console.error('SimpleStock auth error:', error);
    return json(
      { ok: false, error: error?.message || 'Authentication error.' },
      500
    );
  }
};
