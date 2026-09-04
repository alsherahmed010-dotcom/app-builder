const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        package_name VARCHAR(255) NOT NULL,
        app_type VARCHAR(50) NOT NULL DEFAULT 'html',
        content TEXT,
        icon_url TEXT,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('Database initialized');
  } catch (error) {
    console.error('Database error:', error);
  }
}

initDB();

app.get('/', (req, res) => {
  res.json({ status: 'running', service: 'App Builder API' });
});

app.post('/api/apps', upload.single('icon'), async (req, res) => {
  try {
    const { name, package_name, app_type, content } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const result = await pool.query(
      'INSERT INTO apps (name, package_name, app_type, content, icon_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, package_name, app_type, content, icon_url]
    );
    
    res.json({ success: true, app: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/apps', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps ORDER BY created_at DESC');
    res.json({ success: true, apps: result.rows });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/apps/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    res.json({ success: true, app: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/apps/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, content, app_type } = req.body;
    
    const result = await pool.query(
      'UPDATE apps SET name = $1, content = $2, app_type = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, content, app_type, id]
    );
    
    res.json({ success: true, app: result.rows[0] });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/apps/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM apps WHERE id = $1', [id]);
    res.json({ success: true, message: 'App deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/build/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'App not found' });
    }
    
    const appData = result.rows[0];
    res.json({ success: true, message: `Building ${appData.name}...`, app: appData });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
