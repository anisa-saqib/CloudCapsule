// server.js — Cloud Capsule Backend
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000; // This is important for Render/Railway!
const JWT_SECRET = process.env.JWT_SECRET || 'cloudy-grunge-capsule-secret';

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// --------------------
// Multer for photo uploads
// --------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// --------------------
// SQLite Database
// --------------------
const db = new sqlite3.Database('./capsule.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS capsules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    open_date DATETIME,
    locked INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);
  
  db.run(`CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capsule_id INTEGER UNIQUE,
    letter TEXT,
    secret TEXT,
    feeling TEXT,
    song TEXT,
    rating INTEGER,
    photo_url TEXT,
    FOREIGN KEY(capsule_id) REFERENCES capsules(id)
  )`);
});

// --------------------
// Auth Middleware
// --------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.sendStatus(401);
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// --------------------
// Auth Routes
// --------------------
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email+password required' });
  const hash = await bcrypt.hash(password, 10);
  db.run('INSERT INTO users (email, password) VALUES (?, ?)', [email, hash], function(err) {
    if (err) return res.status(400).json({ error: 'email exists' });
    res.json({ success: true });
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (!user) return res.status(400).json({ error: 'invalid credentials' });
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'invalid credentials' });
    const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET);
    res.json({ token, user: { id: user.id, email: user.email } });
  });
});

app.get('/api/auth/me', authenticateToken, (req, res) => {
  res.json({ user: req.user });
});

// --------------------
// Capsule Routes
// --------------------

// Get all capsules
app.get('/api/capsules', authenticateToken, (req, res) => {
  db.all('SELECT * FROM capsules WHERE user_id = ? ORDER BY created_at DESC', [req.user.id], (err, rows) => {
    res.json(rows);
  });
});

// Create capsule
app.post('/api/capsules', authenticateToken, upload.single('photo'), (req, res) => {
  const { title, open_date, letter, secret, feeling, song, rating } = req.body;
  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

  db.run('INSERT INTO capsules (user_id, title, open_date, locked) VALUES (?, ?, ?, 0)',
    [req.user.id, title, open_date], function(err) {
      if (err) return res.status(500).json({ error: err.message });
      const capsuleId = this.lastID;
      db.run(`INSERT INTO contents (capsule_id, letter, secret, feeling, song, rating, photo_url)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
              [capsuleId, letter, secret, feeling, song, rating, photo_url], (err2) => {
        if (err2) return res.status(500).json(err2);
        res.json({ id: capsuleId });
      });
  });
});

// Get single capsule (with time-lock)
app.get('/api/capsules/:id', authenticateToken, (req, res) => {
  db.get(`SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.song, ct.rating, ct.photo_url 
          FROM capsules c LEFT JOIN contents ct ON c.id = ct.capsule_id 
          WHERE c.id = ? AND c.user_id = ?`, [req.params.id, req.user.id], (err, capsule) => {
    if (!capsule) return res.sendStatus(404);
    const now = new Date();
    const open = new Date(capsule.open_date);
    if (now < open) {
      // locked
      capsule.letter = null; capsule.secret = null; capsule.feeling = null;
      capsule.song = null; capsule.rating = null; capsule.photo_url = null;
      return res.json({ capsule, locked: true });
    }
    res.json({ capsule, locked: false });
  });
});

// Update capsule contents (edit)
app.put('/api/capsules/:id/contents', authenticateToken, upload.single('photo'), (req, res) => {
  const capsuleId = req.params.id;
  db.get('SELECT * FROM capsules WHERE id = ? AND user_id = ?', [capsuleId, req.user.id], (err, cap) => {
    if (!cap) return res.status(404).json({ error: 'not found' });
    if (cap.locked || new Date() >= new Date(cap.open_date)) return res.status(403).json({ error: 'cannot edit locked capsule' });

    const { title, open_date, letter, secret, feeling, song, rating } = req.body;
    const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

    db.run(`UPDATE capsules SET title = ?, open_date = ? WHERE id = ?`, [title, open_date, capsuleId], () => {
      db.run(`UPDATE contents SET letter=?, secret=?, feeling=?, song=?, rating=?, photo_url=? WHERE capsule_id=?`,
        [letter, secret, feeling, song, rating, photo_url, capsuleId], () => {
          res.json({ success: true });
      });
    });
  });
});

// Lock capsule immediately
app.post('/api/capsules/:id/lock', authenticateToken, (req, res) => {
  const capsuleId = req.params.id;
  db.run('UPDATE capsules SET locked = 1 WHERE id = ? AND user_id = ?', [capsuleId, req.user.id], function(err) {
    if (err) return res.status(500).json({ error: 'cannot lock' });
    res.json({ success: true });
  });
});

// Serve static files from current directory
app.use(express.static(__dirname));

// Serve capsule.html at root route
app.get('/', (req, res) => {
  const filePath = path.join(__dirname, 'capsule.html');
  console.log('Looking for file at:', filePath);
  
  if (fs.existsSync(filePath)) {
    console.log('✅ File found! Sending...');
    res.sendFile(filePath);
  } else {
    console.log('❌ File NOT found!');
    res.status(404).send(`
      <h2>File not found!</h2>
      <p>Tried to load: ${filePath}</p>
      <p>Current directory: ${__dirname}</p>
      <p>Files in this folder:</p>
      <ul>
        ${fs.readdirSync(__dirname).map(f => `<li>${f}</li>`).join('')}
      </ul>
    `);
  }
});

// --------------------
// Start Server - UPDATED FOR DEPLOYMENT
// --------------------
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🌥 Cloud Capsule backend running on port ${PORT}`);
});