const express = require('express');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const router = express.Router();
const queries = require('../db/queries');

// Google sign-in is enabled only when a client ID is configured.
const PENDING_MESSAGE = "Thanks for signing up! Your account is waiting for approval. You'll be able to sign in once an admin approves it.";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || null;
const googleClient = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

// GET /api/auth/config — public settings the sign-in page needs
router.get('/config', (req, res) => {
  res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email format' });

    const existing = await queries.getUserByEmail(email.toLowerCase());
    if (existing) {
      const error = existing.password_hash
        ? 'Email already registered'
        : 'This email is registered with Google. Use "Continue with Google" to sign in.';
      return res.status(409).json({ error });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await queries.createUser({ email: email.toLowerCase(), passwordHash, displayName });

    // New accounts wait for global-admin approval — no session until then.
    res.json({ pending: true, message: PENDING_MESSAGE });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    const user = await queries.getUserByEmail(email.toLowerCase());
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.password_hash) {
      return res.status(401).json({ error: 'This account uses Google sign-in. Use "Continue with Google", or set a password from your account page.' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
    if (!user.approved) return res.status(403).json({ error: PENDING_MESSAGE, pending: true });

    req.session.userId = user.id;
    const roles = await queries.getUserTeamRoles(user.id);
    const userObj = await queries.getUserById(user.id);
    res.json({ user: userObj, roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/google — sign in or sign up with a Google ID token
router.post('/google', async (req, res) => {
  try {
    if (!googleClient) return res.status(503).json({ error: 'Google sign-in is not configured' });
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ error: 'Missing Google credential' });

    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      return res.status(401).json({ error: 'Google sign-in failed. Please try again.' });
    }
    if (!payload?.sub || !payload.email || !payload.email_verified) {
      return res.status(401).json({ error: 'Your Google account email is not verified' });
    }

    const email = payload.email.toLowerCase();
    let user = await queries.getUserByGoogleSub(payload.sub);
    if (!user) {
      // Google has verified the address, so an existing account with the same
      // email belongs to this person — link it rather than creating a duplicate.
      user = await queries.getUserByEmail(email);
      if (user) {
        await queries.linkGoogleAccount(user.id, payload.sub);
      } else {
        await queries.createUser({ email, displayName: payload.name, googleSub: payload.sub });
        return res.json({ pending: true, message: PENDING_MESSAGE });
      }
    }
    if (!user.approved) return res.status(403).json({ error: PENDING_MESSAGE, pending: true });

    req.session.userId = user.id;
    const userObj = await queries.getUserById(user.id);
    const roles = await queries.getUserTeamRoles(user.id);
    res.json({ user: userObj, roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout failed' });
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  try {
    if (!req.session?.userId) return res.json({ user: null, roles: [] });
    const user = await queries.getUserById(req.session.userId);
    if (!user?.approved) return res.json({ user: null, roles: [] });
    const roles = await queries.getUserTeamRoles(user.id);
    res.json({ user, roles });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Not authenticated' });
    const { currentPassword, newPassword } = req.body;
    if (!newPassword) return res.status(400).json({ error: 'New password required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await queries.getUserByEmail((await queries.getUserById(req.session.userId)).email);
    if (!user) return res.status(401).json({ error: 'User not found' });

    // Google-only accounts have no password yet and may set one without a current password.
    if (user.password_hash) {
      if (!currentPassword) return res.status(400).json({ error: 'Current password required' });
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    const { getDb, saveDb } = require('../db/schema');
    const db = await getDb();
    db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
    saveDb();

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
