import express from 'express';
import bcrypt from 'bcrypt';
import { db, getUserByUsername } from '../db.js';
import { signToken, authMiddleware } from '../jwt.js';

export const authRouter = express.Router();

authRouter.post('/register', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username and password required' });
  }
  try {
    const existing = await getUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'username taken' });
    const hash = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password_hash) VALUES (?, ?)`,
      [username, hash],
      function (err) {
        if (err) return res.status(500).json({ error: 'db error' });
        const user = { id: this.lastID, username, coins: 100, earnings: 0 };
        const token = signToken({ id: user.id, username });
        res.json({ token, user });
      }
    );
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

authRouter.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing' });
  try {
    const user = await getUserByUsername(username);
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    const token = signToken({ id: user.id, username: user.username });
    res.json({ token, user: { id: user.id, username: user.username, coins: user.coins, earnings: user.earnings } });
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});

authRouter.get('/me', authMiddleware, (req, res) => {
  const id = req.user.id;
  db.get(`SELECT id, username, coins, earnings FROM users WHERE id = ?`, [id], (err, row) => {
    if (err) return res.status(500).json({ error: 'db error' });
    res.json(row);
  });
});
