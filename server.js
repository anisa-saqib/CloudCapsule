// server.js - Cloud Capsule Backend with MySQL
const express = require('express');
const mysql = require('mysql2/promise');
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

// ==================== MYSQL DATABASE CONNECTION ====================
// YOUR EZYRO DATABASE DETAILS
const DB_HOST = 'sql303.ezyro.com';
const DB_USER = 'ezyro_41198476';
const DB_PASSWORD = '7w4kqx06'; // Your vPanel password
const DB_NAME = 'ezyro_41198476_Cloudsdatabase';

// Create connection pool
const pool = mysql.createPool({
  host: DB_HOST,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// Test connection
async function testConnection() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Connected to MySQL database on ezyro');
    connection.release();
    return true;
  } catch (err) {
    console.error('❌ MySQL connection error:', err);
    return false;
  }
}

// Helper function to run queries
async function query(sql, params) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Helper to get a single row
async function getOne(sql, params) {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Test connection on startup
testConnection();

// ==================== EMAIL SETUP (for forgot password) ====================
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
  // Production email config - set these in environment variables
  transporter = nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    }
  });
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
    // Check if user exists
    const existing = await getOne(
      'SELECT id FROM users WHERE email = ? OR username = ?',
      [email, username]
    );
    
    if (existing) {
      return res.status(400).json({ error: 'User with this email or username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const result = await query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username, email, hashedPassword]
    );
    
    const userId = result.insertId;

    const token = jwt.sign(
      { id: userId, username, email }, 
      JWT_SECRET, 
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User created successfully',
      token,
      user: { id: userId, username, email }
    });
    
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login user
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' });
  }

  try {
    const user = await getOne('SELECT * FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

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
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get current user
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  try {
    const user = await getOne(
      'SELECT id, username, email, created_at FROM users WHERE id = ?',
      [req.user.id]
    );
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({ user });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== FORGOT PASSWORD ROUTES ====================

// Request password reset
app.post('/api/auth/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email required' });
  }

  try {
    const user = await getOne('SELECT id, username FROM users WHERE email = ?', [email]);

    if (!user) {
      return res.json({ message: 'If your email exists, you will receive a reset link' });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 3600000); // 1 hour from now

    await query(
      'UPDATE users SET reset_token = ?, reset_token_expiry = ? WHERE id = ?',
      [resetToken, tokenExpiry, user.id]
    );

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
        console.log('RESET LINK (copy to browser):', resetLink);
      }

      res.json({ message: 'If your email exists, you will receive a reset link' });
      
    } catch (emailErr) {
      console.error('Email error:', emailErr);
      res.json({ message: 'If your email exists, you will receive a reset link' });
    }
    
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify reset token
app.post('/api/auth/verify-reset-token', async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ error: 'Token required' });
  }

  try {
    const user = await getOne(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
      [token]
    );

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    res.json({ valid: true });
    
  } catch (error) {
    console.error('Verify token error:', error);
    res.status(500).json({ error: 'Server error' });
  }
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
    const user = await getOne(
      'SELECT id FROM users WHERE reset_token = ? AND reset_token_expiry > NOW()',
      [token]
    );

    if (!user) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    await query(
      'UPDATE users SET password = ?, reset_token = NULL, reset_token_expiry = NULL WHERE id = ?',
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password reset successful' });
    
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ==================== CAPSULE ROUTES ====================

// Get all capsules for user
app.get('/api/capsules', authenticateToken, async (req, res) => {
  try {
    const capsules = await query(
      `SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_urls,
       CASE WHEN c.open_date <= NOW() THEN 1 ELSE 0 END as is_open
       FROM capsules c
       LEFT JOIN contents ct ON c.id = ct.capsule_id
       WHERE c.user_id = ?
       ORDER BY c.created_at DESC`,
      [req.user.id]
    );

    // Parse photo_urls from JSON string to array
    const processed = capsules.map(cap => ({
      ...cap,
      photo_urls: cap.photo_urls ? JSON.parse(cap.photo_urls) : []
    }));

    res.json(processed);
    
  } catch (error) {
    console.error('Get capsules error:', error);
    res.status(500).json({ error: 'Failed to fetch capsules' });
  }
});

// Create new capsule
app.post('/api/capsules', authenticateToken, upload.array('photos', 10), async (req, res) => {
  const { title, open_date, letter, secret, feeling, rating, song } = req.body;
  const files = req.files;
  
  const photoUrls = files ? files.map(f => `/uploads/${f.filename}`) : [];
  const photoUrlsJson = JSON.stringify(photoUrls);

  if (!title || !open_date) {
    return res.status(400).json({ error: 'Title and open date are required' });
  }

  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();

    // Insert capsule
    const [capsuleResult] = await connection.execute(
      'INSERT INTO capsules (user_id, title, open_date) VALUES (?, ?, ?)',
      [req.user.id, title, open_date]
    );

    const capsuleId = capsuleResult.insertId;

    // Insert contents
    await connection.execute(
      `INSERT INTO contents (capsule_id, letter, secret, feeling, rating, song, photo_urls)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [capsuleId, letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', photoUrlsJson]
    );

    await connection.commit();
    
    res.status(201).json({ 
      message: 'Capsule created successfully',
      id: capsuleId,
      photoCount: photoUrls.length
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Create capsule error:', error);
    res.status(500).json({ error: 'Failed to save capsule contents' });
  } finally {
    connection.release();
  }
});

// Get single capsule
app.get('/api/capsules/:id', authenticateToken, async (req, res) => {
  const capsuleId = req.params.id;

  try {
    const capsules = await query(
      `SELECT c.*, ct.letter, ct.secret, ct.feeling, ct.rating, ct.song, ct.photo_urls,
       CASE WHEN c.open_date <= NOW() THEN 1 ELSE 0 END as is_open
       FROM capsules c
       LEFT JOIN contents ct ON c.id = ct.capsule_id
       WHERE c.id = ? AND c.user_id = ?`,
      [capsuleId, req.user.id]
    );

    if (capsules.length === 0) {
      return res.status(404).json({ error: 'Capsule not found' });
    }

    const capsule = capsules[0];
    const photoUrls = capsule.photo_urls ? JSON.parse(capsule.photo_urls) : [];
    const now = new Date();
    const openDate = new Date(capsule.open_date);
    const isOpen = now >= openDate;

    if (!isOpen) {
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
    
  } catch (error) {
    console.error('Get capsule error:', error);
    res.status(500).json({ error: 'Failed to fetch capsule' });
  }
});

// Update capsule
app.put('/api/capsules/:id', authenticateToken, upload.array('photos', 10), async (req, res) => {
  const capsuleId = req.params.id;
  const { title, open_date, letter, secret, feeling, rating, song } = req.body;
  const files = req.files;
  
  const connection = await pool.getConnection();
  
  try {
    // Check if capsule exists and belongs to user
    const capsules = await connection.execute(
      'SELECT * FROM capsules WHERE id = ? AND user_id = ?',
      [capsuleId, req.user.id]
    );

    if (capsules[0].length === 0) {
      return res.status(404).json({ error: 'Capsule not found' });
    }

    const capsule = capsules[0][0];
    const now = new Date();
    const openDate = new Date(capsule.open_date);
    
    if (now >= openDate) {
      return res.status(403).json({ error: 'Cannot edit an opened capsule' });
    }

    await connection.beginTransaction();

    // Update capsule
    await connection.execute(
      'UPDATE capsules SET title = ?, open_date = ? WHERE id = ?',
      [title || capsule.title, open_date || capsule.open_date, capsuleId]
    );

    // Get existing photos
    const contents = await connection.execute(
      'SELECT photo_urls FROM contents WHERE capsule_id = ?',
      [capsuleId]
    );

    let existingPhotos = [];
    if (contents[0].length > 0 && contents[0][0].photo_urls) {
      existingPhotos = JSON.parse(contents[0][0].photo_urls);
    }

    // Add new photos
    const newPhotos = files ? files.map(f => `/uploads/${f.filename}`) : [];
    const allPhotos = [...existingPhotos, ...newPhotos];
    const photoUrlsJson = JSON.stringify(allPhotos);

    // Update contents
    await connection.execute(
      `UPDATE contents SET letter = ?, secret = ?, feeling = ?, rating = ?, song = ?, photo_urls = ? WHERE capsule_id = ?`,
      [letter || '', secret || '', feeling || 'happy', parseInt(rating) || 0, song || '', photoUrlsJson, capsuleId]
    );

    await connection.commit();
    
    res.json({ 
      message: 'Capsule updated successfully',
      photoCount: allPhotos.length
    });
    
  } catch (error) {
    await connection.rollback();
    console.error('Update capsule error:', error);
    res.status(500).json({ error: 'Failed to update capsule' });
  } finally {
    connection.release();
  }
});

// Delete capsule
app.delete('/api/capsules/:id', authenticateToken, async (req, res) => {
  const capsuleId = req.params.id;

  try {
    const result = await query(
      'DELETE FROM capsules WHERE id = ? AND user_id = ?',
      [capsuleId, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Capsule not found' });
    }

    res.json({ message: 'Capsule deleted successfully' });
    
  } catch (error) {
    console.error('Delete capsule error:', error);
    res.status(500).json({ error: 'Failed to delete capsule' });
  }
});

// Check for opened capsules
app.get('/api/capsules/check-opened', authenticateToken, async (req, res) => {
  try {
    const capsules = await query(
      `SELECT id, title FROM capsules 
       WHERE user_id = ? 
       AND open_date <= NOW()`,
      [req.user.id]
    );

    res.json(capsules);
    
  } catch (error) {
    console.error('Check opened error:', error);
    res.status(500).json({ error: 'Database error' });
  }
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
  console.log(`💾 Database: MySQL (${DB_HOST}/${DB_NAME})`);
});