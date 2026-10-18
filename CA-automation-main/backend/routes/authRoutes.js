// backend/routes/authRoutes.js
// Authentication API — Login, Refresh, Logout, Profile, Change Password, User Management
// CA Firm Automation Suite

const express = require('express');
const router = express.Router();
const {
  findByEmail, findById, verifyPassword, updateLastLogin, changePassword, getAllUsers, createUser, updateUser
} = require('../utils/userStore');
const { signAccessToken, signRefreshToken, verifyToken, requireAuth, requireRole } = require('../middleware/auth');
const emailService = require('../services/emailService');

/**
 * POST /api/auth/login
 * Body: { email, password }
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

    const user = findByEmail(email);
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    updateLastLogin(user.id);

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user.id);

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    console.error('[AUTH] Login error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

/**
 * POST /api/auth/refresh
 * Body: { refreshToken }
 */
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: 'Refresh token required.' });

    const decoded = verifyToken(refreshToken);
    if (decoded.type !== 'refresh') return res.status(401).json({ error: 'Invalid refresh token.' });

    const user = findById(decoded.sub);
    if (!user || !user.is_active) return res.status(401).json({ error: 'User not found or inactive.' });

    const accessToken = signAccessToken(user);
    res.json({ success: true, accessToken });
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired refresh token. Please log in again.' });
  }
});

/**
 * GET /api/auth/profile
 */
router.get('/profile', requireAuth, (req, res) => {
  const user = findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const { password_hash, ...safe } = user;
  res.json(safe);
});

/**
 * POST /api/auth/change-password
 * Body: { currentPassword, newPassword }
 */
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both current and new password required.' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters.' });

    const user = findById(req.user.id);
    const valid = await verifyPassword(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect.' });

    await changePassword(req.user.id, newPassword);
    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not change password.' });
  }
});

/**
 * GET /api/auth/users — Partner only: list all firm users
 */
router.get('/users', requireAuth, requireRole(['partner']), (req, res) => {
  res.json(getAllUsers());
});

/**
 * POST /api/auth/users — Partner only: create new user
 * Body: { name, email, role, password }
 */
router.post('/users', requireAuth, requireRole(['partner']), async (req, res) => {
  try {
    const { name, email, role, password } = req.body;
    if (!name || !email || !role) return res.status(400).json({ error: 'Name, email, and role are required.' });
    const validRoles = ['partner', 'manager', 'article'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: `Role must be one of: ${validRoles.join(', ')}` });

    const newUser = await createUser({ name, email, role, password: password || 'Admin@1234' });
    res.status(201).json({ success: true, user: newUser, message: `User created. Default password: ${password || 'Admin@1234'}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * PUT /api/auth/users/:userId — Partner only: update user role / active status
 */
router.put('/users/:userId', requireAuth, requireRole(['partner']), (req, res) => {
  try {
    const allowed = ['name', 'role', 'is_active'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    const updated = updateUser(req.params.userId, updates);
    if (!updated) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, user: updated });
  } catch (err) {
    res.status(500).json({ error: 'Could not update user.' });
  }
});

/**
 * POST /api/auth/reset-password — Partner: force-reset any user's password
 * Body: { userId, newPassword }
 */
router.post('/reset-password', requireAuth, requireRole(['partner']), async (req, res) => {
  try {
    const { userId, newPassword } = req.body;
    if (!userId || !newPassword) return res.status(400).json({ error: 'userId and newPassword required.' });
    const ok = await changePassword(userId, newPassword);
    if (!ok) return res.status(404).json({ error: 'User not found.' });
    res.json({ success: true, message: 'Password reset successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Could not reset password.' });
  }
});

module.exports = router;
