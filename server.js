// server.js - Cloud Capsule Backend
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'cloudy-grunge-capsule-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Ensure uploads folder exists
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// ==================== EMAIL SETUP (for forgot password) ====================
// For testing, use ethereal.email (fake email service)
// In production, use real email service like Gmail, SendGrid, etc.
let transporter;

// Create test account for development
if (process.env.NODE_ENV !== 'production') {
  nodemailer.createTestAccount((err, account) => {
    if (err) {
      console.error('Failed to create test email account:', err);
    } else {
      transporter = nodemailer.createTransport({
        host: account.smtp.host,
        port: account.smtp.port,
        secure: account.smtp.secure,
        auth: {
          user: account.user,
          pass: account.pass
        }
      });
      console.log('✅ Test email account created. Preview URL: ' + account.web);
    }
  });
} else {
  // Production email config - replace with your email service
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
}

// ==================== MULTER SETUP (MULTIPLE PHOTOS) ====================
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

// Updated to handle multiple files (up to 10)
const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB per file
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
    reset_token TEXT,
    reset_token_expiry DATETIME,
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

  // Contents table - modified to store multiple photo URLs as JSON
  db.run(`CREATE TABLE IF NOT EXISTS contents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    capsule_id INTEGER UNIQUE NOT NULL,
    letter TEXT,
    secret TEXT,
    feeling TEXT,
    rating INTEGER DEFAULT 0,
    song TEXT,
    photo_urls TEXT, -- JSON array of photo URLs
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

// ==================== FORGOT PASSWORD ROUTES ====================

// Request password reset
app.post('/api/auth/forgot-password', (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  db.get('SELECT id, username FROM users WHERE email = ?', [email], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!user) {
      // Don't reveal that user doesn't exist (security)
      return res.json({ message: 'If your email exists, you will receive a reset link' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    db.run(
      'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      [resetToken, tokenExpiry.toISOString(), user.id],
      async (err) => {
        if (err) {
          return res.status(500).json({ error: 'Failed to generate reset token' });
        }

        // Create reset link
        const resetLink = `${FRONTEND_URL}/reset-password?token=${resetToken}`;

        // Send email
        try {
          const mailOptions = {
            from: '"Cloud Capsule" <noreply@cloudcapsule.com>',
            to: email,
            subject: 'Reset Your Cloud Capsule Password',
            html: `
              <div style="font-family: 'Baloo 2', cursive; max-width: 500px; margin: 0 auto; padding: 20px; background: linear-gradient(145deg, #ffd9e8, #ffe0f0); border-radius: 30px; border: 3px solid white;">
                <h1 style="color: #3a1a32; text-align: center;">☁️ Cloud Capsule</h1>
                <p style="color: #552a45; font-size: 1.1rem;">Hello ${user.username},</p>
                <p style="color: #552a45;">We received a request to reset your password. Click the button below to create a new password:</p>
                <div style="text-align: center; margin: 30px 0;">
                  <a href="${resetLink}" style="background: #b07a9a; color: white; padding: 12px 30px; text-decoration: none; border-radius: 50px; font-weight: bold; border: 2px solid white; display: inline-block;">Reset Password</a>
                </div>
                <p style="color: #552a45; font-size: 0.9rem;">This link will expire in 1 hour.</p>
                <p style="color: #552a45; font-size: 0.9rem;">If you didn't request this, please ignore this email.</p>
                <p style="color: #552a45; margin-top: 20px;">✨ Your memories are safe in the clouds</p>
              </div>
            `
          };

          if (transporter) {
            const info = await transporter.sendMail(mailOptions);
            console.log('Reset email sent:', info.messageId);
            if (info.previewURL) {
              console.log('Preview URL:', info.previewURL);
            }
          } else {
            // For development, log the reset link
            console.log('RESET LINK (copy to browser):', resetLink);
          }

          res.json({ message: 'If your email exists, you will receive a reset link' });
        } catch (emailErr) {
          console.error('Email error:', emailErr);
          res.json({ message: 'If your email exists, you will receive a reset link' });
        }
      }
    );
  });
});

// Verify reset token
app.post('/api/auth/verify-reset-token', (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  db.get(
    'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > datetime("now")',
    [token],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (!user) {
        return res.status(400).json({ error: 'Invalid or expired token' });
      }

      res.json({ valid: true });
    }
  );
});

// Reset password
app.post('/api/auth/reset-password', async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password required' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  try {
    db.get(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > datetime("now")',
      [token],
      async (err, user) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        if (!user) {
          return res.status(400).json({ error: 'Invalid or expired token' });
        }

        const hashedPassword = await bcrypt.hash(newPassword, 10);

        db.run(
          'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
          [hashedPassword, user.id],
          (err) => {
            if (err) {
              return res.status(500).json({ error: 'Failed to reset password' });
            }

            res.json({ message: 'Password reset successful' });
          }
        );
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== CAPSULE ROUTES (UPDATED FOR MULTIPLE PHOTOS) ====================

// Get all capsules for user
app.get('/api/capsules', authenticateToken, (req, res) => {
  db.all(
    `SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_urls,
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

      // Parse photo_urls from JSON string to array
      const processed = capsules.map(cap => ({
        ...cap,
        photo_urls: cap.photo_urls ? JSON.parse(cap.photo_urls) : []
      }));

      res.json(processed);
    }
  );
});

// Create new capsule (with multiple photos)
app.post('/api/capsules', authenticateToken, upload.array('photos', 10), (req, res) => {
  const { title, open_date, letter, secret, feeling, rating, song } = req.body;
  const files = req.files;
  
  // Create array of photo URLs
  const photoUrls = files ? files.map(f => `/uploads/${f.filename}`) : [];
  const photoUrlsJson = JSON.stringify(photoUrls);

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
          `INSERT INTO contents (capsule_id, letter, secret, feeling, rating, song, photo_urls)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [capsuleId, letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', photoUrlsJson],
          function(err) {
            if (err) {
              db.run('ROLLBACK');
              return res.status(500).json({ error: 'Failed to save capsule contents' });
            }

            db.run('COMMIT');
            res.status(201).json({ 
              message: 'Capsule created successfully',
              id: capsuleId,
              photoCount: photoUrls.length
            });
          }
        );
      }
    );
  });
});

// Get single capsule
app.get('/api/capsules/:id', authenticateToken, (req, res) => {
  const capsuleId = req.params.id;

  db.get(
    `SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_urls,
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

      // Parse photo URLs
      const photoUrls = capsule.photo_urls ? JSON.parse(capsule.photo_urls) : [];

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
          photo_urls: []
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
        photo_urls: photoUrls
      });
    }
  );
});

// Update capsule
app.put('/api/capsules/:id', authenticateToken, upload.array('photos', 10), (req, res) => {
  const capsuleId = req.params.id;
  const { title, open_date, letter, secret, feeling, rating, song } = req.body;
  const files = req.files;
  
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

            // Handle photos
            db.get('SELECT photo_urls FROM contents WHERE capsule_id = ?', [capsuleId], (err, row) => {
              if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Database error' });
              }

              let existingPhotos = [];
              if (row && row.photo_urls) {
                existingPhotos = JSON.parse(row.photo_urls);
              }

              // Add new photos
              const newPhotos = files ? files.map(f => `/uploads/${f.filename}`) : [];
              const allPhotos = [...existingPhotos, ...newPhotos];
              const photoUrlsJson = JSON.stringify(allPhotos);

              db.run(
                `UPDATE contents SET letter = ?, secret = ?, feeling = ?, rating = ?, song = ?, photo_urls = ? WHERE capsule_id = ?`,
                [letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', photoUrlsJson, capsuleId],
                function(err) {
                  if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Failed to update contents' });
                  }

                  db.run('COMMIT');
                  res.json({ 
                    message: 'Capsule updated successfully',
                    photoCount: allPhotos.length
                  });
                }
              );
            });
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

app.get('/reset-password', (req, res) => {
  res.sendFile(path.join(__dirname, 'capsule.html'));
});

// ==================== ERROR HANDLING ====================
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Max size is 5MB per file' });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'Too many files. Max 10 photos allowed' });
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
  console.log(`📁 Uploads folder: ${path.join(__dirname, 'uploads')}`);
  console.log(`💾 Database: ${path.join(__dirname, 'capsule.db')}`);
});