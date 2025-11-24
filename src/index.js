// backend/src/index.js

import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// we'll assign io after routes
let io = null;

// CORS – allow your Vite frontend
app.use(
  cors({
    origin: ["http://localhost:5173", "https://tecplugs.com"],
    credentials: true,
  })
);

app.use(bodyParser.json());

// ===== DB setup =====
const dbPath = path.join(__dirname, "theplug.db");
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, password TEXT, coins INTEGER DEFAULT 100, earnings INTEGER DEFAULT 0)"
  );
});

const SECRET = "theplug_secret_key";

// ===== AUTH ROUTES =====

// register
app.post("/api/auth/register", (req, res) => {
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);

  db.run(
    "INSERT INTO users (username, password) VALUES (?, ?)",
    [username, hash],
    function (err) {
      if (err) return res.status(400).json({ error: "Username exists" });
      const token = jwt.sign({ id: this.lastID, username }, SECRET);
      res.json({ token, username });
    }
  );
});

// login
app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  db.get("SELECT * FROM users WHERE username = ?", [username], (err, row) => {
    if (!row || !bcrypt.compareSync(password, row.password)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const token = jwt.sign({ id: row.id, username: row.username }, SECRET);
    res.json({ token, username: row.username });
  });
});

// who am I
app.get("/api/auth/me", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });

  try {
    const decoded = jwt.verify(token, SECRET);
    db.get(
      "SELECT id, username, coins, earnings FROM users WHERE id = ?",
      [decoded.id],
      (err, row) => {
        if (err || !row) return res.status(404).json({ error: "User not found" });
        res.json(row);
      }
    );
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
});

// ===== GIFTS ROUTE =====
app.post("/api/gifts/send", (req, res) => {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "No token" });

  const { toUsername, amount } = req.body || {};
  if (!toUsername || !amount || amount <= 0) {
    return res
      .status(400)
      .json({ error: "toUsername and positive amount required" });
  }

  let senderDecoded;
  try {
    senderDecoded = jwt.verify(token, SECRET);
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }

  // get sender
  db.get(
    "SELECT * FROM users WHERE id = ?",
    [senderDecoded.id],
    (err, senderRow) => {
      if (err || !senderRow)
        return res.status(500).json({ error: "sender not found" });
      if (senderRow.coins < amount)
        return res.status(400).json({ error: "not enough coins" });

      // get receiver
      db.get(
        "SELECT * FROM users WHERE username = ?",
        [toUsername],
        (err2, receiverRow) => {
          if (err2 || !receiverRow)
            return res.status(404).json({ error: "receiver not found" });

          db.serialize(() => {
            db.run(
              "UPDATE users SET coins = coins - ? WHERE id = ?",
              [amount, senderRow.id]
            );
            db.run(
              "UPDATE users SET earnings = earnings + ? WHERE id = ?",
              [amount, receiverRow.id]
            );
          });

          // broadcast gift (optional)
          if (io) {
            io.emit("gift", {
              from: senderRow.username,
              to: receiverRow.username,
              amount,
            });
          }

          return res.json({ ok: true });
        }
      );
    }
  );
});

// ===== SOCKET.IO / SIGNALING =====
io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "https://tecplugs.com"],
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log("a user connected:", socket.id);

  // chat
  socket.on("chat", (msg) => {
    io.emit("chat", msg);
  });

  // gift (frontend could emit too)
  socket.on("gift", (data) => {
    io.emit("gift", data);
  });

  // WebRTC signaling
  socket.on("webrtc-offer", ({ to, offer }) => {
    io.to(to).emit("webrtc-offer", {
      from: socket.id,
      offer,
    });
  });

  socket.on("webrtc-answer", ({ to, answer }) => {
    io.to(to).emit("webrtc-answer", {
      from: socket.id,
      answer,
    });
  });

  socket.on("webrtc-ice", ({ to, candidate }) => {
    io.to(to).emit("webrtc-ice", {
      from: socket.id,
      candidate,
    });
  });

  socket.on("disconnect", () => {
    console.log("user disconnected:", socket.id);
  });
});

// ===== START SERVER =====
server.listen(5001, () => {
  console.log("🚀 The Plug backend running on port 5001");
});




