import express from 'express';
import { db, getUserByUsername } from '../db.js';
import { authMiddleware } from '../jwt.js';

export const giftsRouter = express.Router();

// Send a gift to a streamer by username
giftsRouter.post('/send', authMiddleware, async (req, res) => {
  const { toUsername, value } = req.body || {};
  const senderId = req.user.id;
  if (!toUsername || !value || value <= 0) {
    return res.status(400).json({ error: 'toUsername and positive value required' });
  }
  try {
    const toUser = await getUserByUsername(toUsername);
    if (!toUser) return res.status(404).json({ error: 'recipient not found' });
    db.get(`SELECT * FROM users WHERE id = ?`, [senderId], (err, sender) => {
      if (err || !sender) return res.status(500).json({ error: 'db error' });
      if (sender.coins < value) return res.status(400).json({ error: 'insufficient coins' });
      db.serialize(() => {
        db.run(`UPDATE users SET coins = coins - ? WHERE id = ?`, [value, senderId]);
        db.run(`UPDATE users SET earnings = earnings + ? WHERE id = ?`, [value, toUser.id]);
        db.run(`INSERT INTO gifts (from_user, to_user, value) VALUES (?, ?, ?)`, [senderId, toUser.id, value]);
      });
      // Emit socket event via global io if available
      if (global.io) {
        global.io.to(`user:${toUser.username}`).emit('gift', {
          from: sender.username,
          to: toUser.username,
          value
        });
      }
      res.json({ ok: true });
    });
  } catch (e) {
    res.status(500).json({ error: 'server error' });
  }
});
