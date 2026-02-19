// server.js - Cloud Capsule Backend
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cloudy-grunge-capsule-secret';

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads folder exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// ==================== MULTER SETUP ====================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, 'photo-' + uniqueSuffix + ext);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }
});

// ==================== DATABASE SETUP ====================
const db = new sqlite3.Database('./capsule.db');

db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Capsules table
  db.run(`CREATE TABLE IF NOT EXISTS capsules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    open_date DATETIME NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Contents table
  db.run(`CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capsule_id INTEGER UNIQUE NOT NULL,
    letter TEXT,
    secret TEXT,
    feeling TEXT,
    rating INTEGER DEFAULT 0,
    song TEXT,
    photo_url TEXT,
    FOREIGN KEY(capsule_id) REFERENCES capsules(id) ON DELETE CASCADE
  )`);

  console.log('✅ Database setup complete');
});

// ==================== AUTH MIDDLEWARE ====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
}

// ==================== AUTH ROUTES ====================

// Register new user
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password } = req.body;

  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Username, email, and password required' });
  }

  try {
    db.get('SELECT id FROM users WHERE email = ? OR username = ?', [email, username], async (err, existing) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (existing) {
        return res.status(400).json({ error: 'User with this email or username already exists' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      db.run(
        'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
        [username, email, hashedPassword],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Failed to create user' });
          }

          const token = jwt.sign(
            { id: this.lastID, username, email }, 
            JWT_SECRET, 
            { expiresIn: '7d' }
          );

          res.status(201).json({
            message: 'User created successfully',
            token,
            user: { id: this.lastID, username, email }
          });
        }
      );
    });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Login user
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  db.get('SELECT * FROM users WHERE email = ?', [email], async (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    try {
      const validPassword = await bcrypt.compare(password, user.password);
      
      if (!validPassword) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign(
        { id: user.id, username: user.username, email: user.email },
        JWT_SECRET,
        { expiresIn: '7d' }
      );

      res.json({
        message: 'Login successful',
        token,
        user: { id: user.id, username: user.username, email: user.email }
      });
    } catch (error) {
      res.status(500).json({ error: 'Server error' });
    }
  });
});

// Get current user
app.get('/api/auth/me', authenticateToken, (req, res) => {
  db.get(
    'SELECT id, username, email, created_at FROM users WHERE id = ?',
    [req.user.id],
    (err, user) => {
      if (err || !user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ user });
    }
  );
});

// ==================== CAPSULE ROUTES ====================

// Get all capsules for user
app.get('/api/capsules', authenticateToken, (req, res) => {
  db.all(
    `SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_url,
     (CASE WHEN datetime(c.open_date) <= datetime('now') THEN 1 ELSE 0 END) as is_open
     FROM capsules c
     LEFT JOIN contents ct ON c.id = ct.capsule_id
     WHERE c.user_id = ?
     ORDER BY c.created_at DESC`,
    [req.user.id],
    (err, capsules) => {
      if (err) {
        return res.status(500).json({ error: 'Failed to fetch capsules' });
      }
      res.json(capsules);
    }
  );
});

// Create new capsule
app.post('/api/capsules', authenticateToken, upload.single('photo'), (req, res) => {
  const { title, open_date, letter, secret, feeling, rating, song } = req.body;
  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

  if (!title || !open_date) {
    return res.status(400).json({ error: 'Title and open date are required' });
  }

  db.serialize(() => {
    db.run('BEGIN TRANSACTION');

    db.run(
      'INSERT INTO capsules (user_id, title, open_date) VALUES (?, ?, ?)',
      [req.user.id, title, open_date],
      function(err) {
        if (err) {
          db.run('ROLLBACK');
          return res.status(500).json({ error: 'Failed to create capsule' });
        }

        const capsuleId = this.lastID;

        db.run(
          `INSERT INTO contents (capsule_id, letter, secret, feeling, rating, song, photo_url)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [capsuleId, letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', photo_url],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to save capsule contents' });
            }

            db.run('COMMIT');
            res.status(201).json({ 
              message: 'Capsule created successfully',
              id: capsuleId 
            });
          }
        );
      }
    );
  });
});

// Get single capsule - FIXED VERSION
app.get('/api/capsules/:id', authenticateToken, (req, res) => {
  const capsuleId = req.params.id;

  db.get(
    `SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_url,
     (CASE WHEN datetime(c.open_date) <= datetime('now') THEN 1 ELSE 0 END) as is_open
     FROM capsules c
     LEFT JOIN contents ct ON c.id = ct.capsule_id
     WHERE c.id = ? AND c.user_id = ?`,
    [capsuleId, req.user.id],
    (err, capsule) => {
      if (err) {
        console.error('Database error:', err);
        return res.status(500).json({ error: 'Failed to fetch capsule' });
      }

      if (!capsule) {
        return res.status(404).json({ error: 'Capsule not found' });
      }

      // Check if capsule is open
      const now = new Date();
      const openDate = new Date(capsule.open_date);
      const isOpen = now >= openDate;

      if (!isOpen) {
        // Return locked capsule
        return res.json({
          id: capsule.id,
          user_id: capsule.user_id,
          title: capsule.title,
          open_date: capsule.open_date,
          created_at: capsule.created_at,
          is_open: 0,
          letter: null,
          secret: null,
          feeling: null,
          rating: null,
          song: null,
          photo_url: null
        });
      }

      // Return OPEN capsule with ALL content
      res.json({
        id: capsule.id,
        user_id: capsule.user_id,
        title: capsule.title,
        open_date: capsule.open_date,
        created_at: capsule.created_at,
        is_open: 1,
        letter: capsule.letter || '',
        secret: capsule.secret || '',
        feeling: capsule.feeling || 'happy',
        rating: capsule.rating || 0,
        song: capsule.song || '',
        photo_url: capsule.photo_url || null
      });
    }
  );
});

// Update capsule
app.put('/api/capsules/:id', authenticateToken, upload.single('photo'), (req, res) => {
  const capsuleId = req.params.id;
  const { title, open_date, letter, secret, feeling, rating, song } = req.body;
  const photo_url = req.file ? `/uploads/${req.file.filename}` : null;

  db.get(
    'SELECT * FROM capsules WHERE id = ? AND user_id = ?',
    [capsuleId, req.user.id],
    (err, capsule) => {
      if (err || !capsule) {
        return res.status(404).json({ error: 'Capsule not found' });
      }

      const now = new Date();
      const openDate = new Date(capsule.open_date);
      
      if (now >= openDate) {
        return res.status(403).json({ error: 'Cannot edit an opened capsule' });
      }

      db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        db.run(
          'UPDATE capsules SET title = ?, open_date = ? WHERE id = ?',
          [title || capsule.title, open_date || capsule.open_date, capsuleId],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to update capsule' });
            }

            db.run(
              `UPDATE contents SET letter = ?, secret = ?, feeling = ?, rating = ?, song = ?${photo_url ? ', photo_url = ?' : ''} WHERE capsule_id = ?`,
              photo_url 
                ? [letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', photo_url, capsuleId]
                : [letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', capsuleId],
              function(err) {
                if (err) {
                  db.run('ROLLBACK');
                  return res.status(500).json({ error: 'Failed to update contents' });
                }

                db.run('COMMIT');
                res.json({ message: 'Capsule updated successfully' });
              }
            );
          }
        );
      });
    }
  );
});

// Delete capsule
app.delete('/api/capsules/:id', authenticateToken, (req, res) => {
  const capsuleId = req.params.id;

  db.run(
    'DELETE FROM capsules WHERE id = ? AND user_id = ?',
    [capsuleId, req.user.id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to delete capsule' });
      }

      if (this.changes === 0) {
        return res.status(404).json({ error: 'Capsule not found' });
      }

      res.json({ message: 'Capsule deleted successfully' });
    }
  );
});

// Check for opened capsules
app.get('/api/capsules/check-opened', authenticateToken, (req, res) => {
  db.all(
    `SELECT id, title FROM capsules 
     WHERE user_id = ? 
     AND datetime(open_date) <= datetime('now')`,
    [req.user.id],
    (err, capsules) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(capsules);
    }
  );
});

// ==================== SERVE FRONTEND ====================
app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'capsule.html'));
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max size is 5MB' });
    }
    return res.status(400).json({ error: err.message });
  }
  console.error('Server error:', err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`☁️ Cloud Capsule server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
});