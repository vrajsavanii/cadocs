// backend/utils/userStore.js
// In-memory + JSON file user store (interim until Supabase migration)
// CA Firm Automation Suite

const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const USERS_FILE = path.join(__dirname, '../data/users.json');

function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function saveUsers(users) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function findByEmail(email) {
  return loadUsers().find(u => u.email.toLowerCase() === email.toLowerCase()) || null;
}

function findById(id) {
  return loadUsers().find(u => u.id === id) || null;
}

async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

async function hashPassword(plainText) {
  return bcrypt.hash(plainText, 10);
}

function updateLastLogin(id) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx !== -1) {
    users[idx].last_login = new Date().toISOString();
    saveUsers(users);
  }
}

async function changePassword(id, newPassword) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return false;
  users[idx].password_hash = await hashPassword(newPassword);
  saveUsers(users);
  return true;
}

function getAllUsers() {
  return loadUsers().map(u => {
    const { password_hash, ...safe } = u;
    return safe;
  });
}

async function createUser({ name, email, role, password }) {
  const users = loadUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    throw new Error('User with this email already exists');
  }
  const newUser = {
    id: `usr-${Date.now()}`,
    name,
    email: email.toLowerCase(),
    password_hash: await hashPassword(password || 'Admin@1234'),
    role: role || 'article',
    is_active: true,
    created_at: new Date().toISOString(),
    last_login: null,
  };
  users.push(newUser);
  saveUsers(users);
  const { password_hash, ...safe } = newUser;
  return safe;
}

function updateUser(id, updates) {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return null;
  const { password_hash, ...safeUpdates } = updates; // never allow direct hash override here
  users[idx] = { ...users[idx], ...safeUpdates };
  saveUsers(users);
  const { password_hash: _, ...safe } = users[idx];
  return safe;
}

module.exports = {
  findByEmail,
  findById,
  verifyPassword,
  hashPassword,
  updateLastLogin,
  changePassword,
  getAllUsers,
  createUser,
  updateUser,
};
