import { getStore } from '@netlify/blobs';
import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
  createHash
} from 'node:crypto';

const AUTH_STORE = 'simplestock-auth';
const SIGNUP_STORE = 'simplestock-signups';
const SESSION_DAYS = 30;

const json = (body, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' }
  });

const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const userKey = (email) =>
  `user:${createHash('sha256').update(normalizeEmail(email)).digest('hex')}`;
const sessionKey = (token) =>
  `session:${createHash('sha256').update(String(token)).digest('hex')}`;
const workspaceKey = (workspaceId) => `workspace:${workspaceId}:meta`;

const passwordHash = (password, salt) =>
  scryptSync(String(password), salt, 64).toString('hex');
const recoveryHash = (code) =>
  createHash('sha256').update(String(code).trim().toLowerCase()).digest('hex');

const safeUser = (user) => ({
  email: user.email,
  role: user.role,
  canEdit: user.role === 'owner' || Boolean(user.canEdit),
  workspaceId: user.workspaceId,
  workspaceName: user.workspaceName,
  defaultMode: user.defaultMode || 'reseller'
});

async function loadUser(store, email) {
  return store.get(userKey(email), { type: 'json', consistency: 'strong' });
}

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

  const user = await loadUser(store, session.email);
  if (!user) {
    await store.delete(sessionKey(token));
    return null;
  }

  return { token, session, user };
}

async function requireOwner(store, request) {
  const active = await getSession(store, request);
  if (!active || active.user.role !== 'owner') return null;
  return active;
}

async function requirePlatformAdmin(store, request) {
  const active = await getSession(store, request);
  if (!active) return null;

  const adminEmail = String(process.env.SIMPLESTOCK_ADMIN_EMAIL || '')
    .trim()
    .toLowerCase();

  if (!adminEmail || normalizeEmail(active.user.email) !== adminEmail) {
    return null;
  }

  return active;
}

async function sendSignupEmail(entry) {
  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.SIGNUP_NOTIFY_EMAIL;
  const fromEmail = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !notifyEmail || !fromEmail) {
    return { sent: false, reason: 'Email notification is not configured.' };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [notifyEmail],
        subject: `New SimpleStock signup — ${entry.workspaceName}`,
        text:
`New SimpleStock signup

Workspace: ${entry.workspaceName}
Email: ${entry.email}
Mode: ${entry.defaultMode === 'estate' ? 'Estate Sale' : 'Reseller'}
Time: ${entry.createdAt}`
      })
    });

    if (!res.ok) {
      const body = await res.text();
      console.error('Signup email failed:', res.status, body);
      return { sent: false, reason: `Email provider returned ${res.status}.` };
    }

    return { sent: true };
  } catch (error) {
    console.error('Signup email error:', error);
    return { sent: false, reason: error?.message || 'Email notification failed.' };
  }
}

async function issueSession(store, user) {
  const token = randomBytes(32).toString('hex');
  await store.setJSON(sessionKey(token), {
    email: user.email,
    workspaceId: user.workspaceId,
    role: user.role,
    expiresAt: Date.now() + SESSION_DAYS * 86400000
  });
  return token;
}

async function updateWorkspaceUsers(store, meta) {
  for (const member of meta.members || []) {
    const user = await loadUser(store, member.email);
    if (!user) continue;
    user.workspaceName = meta.name;
    user.defaultMode = meta.defaultMode || 'reseller';
    await store.setJSON(userKey(user.email), user);
  }
}

export default async (request) => {
  try {
    const store = getStore(AUTH_STORE);
    const url = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    if (request.method === 'GET' && action === 'health') {
      return json({
        ok: true,
        service: 'simplestock-auth',
        version: '22.1'
      });
    }

    if (request.method === 'GET' && action === 'me') {
      const active = await getSession(store, request);
      if (!active) return json({ ok: false, error: 'Not signed in.' }, 401);

      const meta = await store.get(workspaceKey(active.user.workspaceId), {
        type: 'json',
        consistency: 'strong'
      });

      return json({
        ok: true,
        user: safeUser(active.user),
        workspace: meta ? {
          id: meta.id,
          name: meta.name,
          defaultMode: meta.defaultMode || 'reseller'
        } : null
      });
    }

    if (request.method === 'GET' && action === 'staff') {
      const active = await requireOwner(store, request);
      if (!active) return json({ ok: false, error: 'Owner access required.' }, 403);

      const meta = await store.get(workspaceKey(active.user.workspaceId), {
        type: 'json',
        consistency: 'strong'
      });

      return json({
        ok: true,
        staff: (meta?.members || [])
          .filter(m => m.email !== active.user.email)
          .map(m => ({
            email: m.email,
            role: m.role || 'staff',
            canEdit: Boolean(m.canEdit),
            createdAt: m.createdAt || null
          }))
      });
    }

    if (request.method === 'GET' && action === 'signups') {
      const active = await requirePlatformAdmin(store, request);
      if (!active) {
        return json({ ok: false, error: 'Platform admin access required.' }, 403);
      }

      const signupStore = getStore(SIGNUP_STORE);
      const entries = [];
      const { blobs } = await signupStore.list({ prefix: 'signup:' });

      for (const blob of blobs) {
        const entry = await signupStore.get(blob.key, {
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
        signups: entries,
        total: entries.length
      });
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

      if (await loadUser(store, email)) {
        return json({ ok: false, error: 'An account with that email already exists.' }, 409);
      }

      const workspaceId = randomUUID();
      const salt = randomBytes(16).toString('hex');
      const recoveryCode = randomBytes(10).toString('hex');

      const user = {
        email,
        role: 'owner',
        canEdit: true,
        workspaceId,
        workspaceName,
        defaultMode,
        salt,
        passwordHash: passwordHash(password, salt),
        recoveryHash: recoveryHash(recoveryCode),
        createdAt: new Date().toISOString()
      };

      const meta = {
        id: workspaceId,
        name: workspaceName,
        defaultMode,
        ownerEmail: email,
        members: [{
          email,
          role: 'owner',
          canEdit: true,
          createdAt: user.createdAt
        }],
        createdAt: user.createdAt
      };

      await store.setJSON(userKey(email), user);
      await store.setJSON(workspaceKey(workspaceId), meta);

      const signupEntry = {
        id: randomUUID(),
        workspaceId,
        workspaceName,
        email,
        defaultMode,
        createdAt: user.createdAt
      };

      const signupStore = getStore(SIGNUP_STORE);
      await signupStore.setJSON(
        `signup:${signupEntry.createdAt}:${signupEntry.id}`,
        signupEntry
      );

      const emailNotification = await sendSignupEmail(signupEntry);

      const token = await issueSession(store, user);

      return json({
        ok: true,
        token,
        recoveryCode,
        user: safeUser(user),
        workspace: { id: workspaceId, name: workspaceName, defaultMode },
        signupNotification: emailNotification
      });
    }

    if (action === 'login') {
      const email = normalizeEmail(body.email);
      const password = String(body.password || '');

      const user = await loadUser(store, email);
      if (!user) return json({ ok: false, error: 'Incorrect email or password.' }, 401);

      const supplied = Buffer.from(passwordHash(password, user.salt), 'hex');
      const expected = Buffer.from(user.passwordHash, 'hex');

      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return json({ ok: false, error: 'Incorrect email or password.' }, 401);
      }

      // Migrate older SimpleStock account records forward safely.
      let changed = false;
      if (!user.role) { user.role = 'owner'; changed = true; }
      if (user.role === 'owner' && user.canEdit !== true) { user.canEdit = true; changed = true; }
      if (!user.defaultMode) { user.defaultMode = 'reseller'; changed = true; }
      if (!user.workspaceName) { user.workspaceName = 'SimpleStock Workspace'; changed = true; }

      if (changed) {
        await store.setJSON(userKey(user.email), user);
      }

      const token = await issueSession(store, user);
      return json({ ok: true, token, user: safeUser(user) });
    }

    if (action === 'logout') {
      const active = await getSession(store, request);
      if (active) await store.delete(sessionKey(active.token));
      return json({ ok: true });
    }

    if (action === 'recover') {
      const email = normalizeEmail(body.email);
      const code = String(body.recoveryCode || '').trim();
      const newPassword = String(body.newPassword || '');

      const user = await loadUser(store, email);
      if (!user || !user.recoveryHash || recoveryHash(code) !== user.recoveryHash) {
        return json({ ok: false, error: 'Email or recovery code is incorrect.' }, 401);
      }
      if (newPassword.length < 8) {
        return json({ ok: false, error: 'New password must be at least 8 characters.' }, 400);
      }

      user.salt = randomBytes(16).toString('hex');
      user.passwordHash = passwordHash(newPassword, user.salt);
      user.recoveryHash = recoveryHash(randomBytes(10).toString('hex')); // invalidate old code
      await store.setJSON(userKey(email), user);

      return json({ ok: true, message: 'Password reset. Sign in with your new password.' });
    }

    if (action === 'change_password') {
      const active = await getSession(store, request);
      if (!active) return json({ ok: false, error: 'Not signed in.' }, 401);

      const currentPassword = String(body.currentPassword || '');
      const newPassword = String(body.newPassword || '');
      if (newPassword.length < 8) {
        return json({ ok: false, error: 'New password must be at least 8 characters.' }, 400);
      }

      const supplied = Buffer.from(passwordHash(currentPassword, active.user.salt), 'hex');
      const expected = Buffer.from(active.user.passwordHash, 'hex');
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        return json({ ok: false, error: 'Current password is incorrect.' }, 401);
      }

      active.user.salt = randomBytes(16).toString('hex');
      active.user.passwordHash = passwordHash(newPassword, active.user.salt);
      await store.setJSON(userKey(active.user.email), active.user);
      return json({ ok: true });
    }

    if (action === 'update_workspace') {
      const active = await requireOwner(store, request);
      if (!active) return json({ ok: false, error: 'Owner access required.' }, 403);

      const name = String(body.workspaceName || '').trim();
      const defaultMode = body.defaultMode === 'estate' ? 'estate' : 'reseller';
      if (name.length < 2) {
        return json({ ok: false, error: 'Enter a workspace name.' }, 400);
      }

      const meta = await store.get(workspaceKey(active.user.workspaceId), {
        type: 'json',
        consistency: 'strong'
      });
      if (!meta) return json({ ok: false, error: 'Workspace not found.' }, 404);

      meta.name = name;
      meta.defaultMode = defaultMode;
      await store.setJSON(workspaceKey(meta.id), meta);
      await updateWorkspaceUsers(store, meta);

      const refreshed = await loadUser(store, active.user.email);
      return json({
        ok: true,
        user: safeUser(refreshed),
        workspace: { id: meta.id, name: meta.name, defaultMode: meta.defaultMode }
      });
    }

    if (action === 'add_staff') {
      const active = await requireOwner(store, request);
      if (!active) return json({ ok: false, error: 'Owner access required.' }, 403);

      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      const canEdit = body.canEdit !== false;

      if (!email.includes('@')) return json({ ok: false, error: 'Enter a valid staff email.' }, 400);
      if (password.length < 8) return json({ ok: false, error: 'Temporary password must be at least 8 characters.' }, 400);
      if (await loadUser(store, email)) return json({ ok: false, error: 'That email already has a SimpleStock account.' }, 409);

      const meta = await store.get(workspaceKey(active.user.workspaceId), {
        type: 'json',
        consistency: 'strong'
      });
      if (!meta) return json({ ok: false, error: 'Workspace not found.' }, 404);

      const salt = randomBytes(16).toString('hex');
      const recoveryCode = randomBytes(10).toString('hex');
      const createdAt = new Date().toISOString();

      const user = {
        email,
        role: 'staff',
        canEdit,
        workspaceId: meta.id,
        workspaceName: meta.name,
        defaultMode: meta.defaultMode || 'reseller',
        salt,
        passwordHash: passwordHash(password, salt),
        recoveryHash: recoveryHash(recoveryCode),
        createdAt
      };

      await store.setJSON(userKey(email), user);
      meta.members = [...(meta.members || []), {
        email,
        role: 'staff',
        canEdit,
        createdAt
      }];
      await store.setJSON(workspaceKey(meta.id), meta);

      return json({ ok: true, recoveryCode });
    }

    if (action === 'reset_staff_password') {
      const active = await requireOwner(store, request);
      if (!active) return json({ ok: false, error: 'Owner access required.' }, 403);

      const email = normalizeEmail(body.email);
      const password = String(body.password || '');
      if (password.length < 8) return json({ ok: false, error: 'Password must be at least 8 characters.' }, 400);

      const user = await loadUser(store, email);
      if (!user || user.workspaceId !== active.user.workspaceId || user.role === 'owner') {
        return json({ ok: false, error: 'Staff account not found.' }, 404);
      }

      user.salt = randomBytes(16).toString('hex');
      user.passwordHash = passwordHash(password, user.salt);
      await store.setJSON(userKey(email), user);
      return json({ ok: true });
    }

    if (action === 'remove_staff') {
      const active = await requireOwner(store, request);
      if (!active) return json({ ok: false, error: 'Owner access required.' }, 403);

      const email = normalizeEmail(body.email);
      const user = await loadUser(store, email);
      if (!user || user.workspaceId !== active.user.workspaceId || user.role === 'owner') {
        return json({ ok: false, error: 'Staff account not found.' }, 404);
      }

      await store.delete(userKey(email));
      const meta = await store.get(workspaceKey(active.user.workspaceId), {
        type: 'json',
        consistency: 'strong'
      });
      if (meta) {
        meta.members = (meta.members || []).filter(m => m.email !== email);
        await store.setJSON(workspaceKey(meta.id), meta);
      }
      return json({ ok: true });
    }

    return json({ ok: false, error: 'Unknown action.' }, 404);
  } catch (error) {
    console.error('SimpleStock auth error:', error);
    return json({ ok: false, error: error?.message || 'Authentication error.' }, 500);
  }
};
