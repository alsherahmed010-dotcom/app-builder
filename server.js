const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
require('dotenv').config();
const buildService = require('./build-service');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use('/builds', express.static('builds'));

const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_INTERNAL || process.env.DATABASE_PUBLIC_URL;

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false }
});

async function initDB() {
  try {
    // إنشاء الجدول لو مش موجود
    await pool.query(`
      CREATE TABLE IF NOT EXISTS apps (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        package_name VARCHAR(255) NOT NULL,
        app_type VARCHAR(50) NOT NULL DEFAULT 'html',
        content TEXT,
        icon_url TEXT,
        apk_url TEXT,
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // إضافة الأعمدة الناقصة
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS apk_url TEXT`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'`);
    
    console.log('✅ Database initialized');
  } catch (error) {
    console.error('❌ Database error:', error.message);
    setTimeout(initDB, 5000);
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
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/apps/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'App not found' });
    res.json({ success: true, app: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/apps/:id', async (req, res) => {
  try {
    const { name, content, app_type } = req.body;
    const result = await pool.query(
      'UPDATE apps SET name = $1, content = $2, app_type = $3, updated_at = NOW() WHERE id = $4 RETURNING *',
      [name, content, app_type, req.params.id]
    );
    res.json({ success: true, app: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/apps/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM apps WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/build/:id', async (req, res) => {
  const { id } = req.params;
  res.json({ success: true, message: 'Build started in background' });
  
  try {
    await pool.query('UPDATE apps SET status = $1 WHERE id = $2', ['building', id]);
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [id]);
    const appData = result.rows[0];
    
    let buildResult;
    if (appData.app_type === 'html') {
      buildResult = await buildService.buildHTMLApp({
        name: appData.name,
        packageName: appData.package_name,
        htmlContent: appData.content,
        iconPath: null
      });
    } else {
      buildResult = await buildService.buildWebViewApp({
        name: appData.name,
        packageName: appData.package_name,
        url: appData.content,
        iconPath: null
      });
    }
    
    const apkPath = await buildService.buildAPK(buildResult.buildDir, buildResult.buildId);
    const apkUrl = `/builds/${path.basename(apkPath)}`;
    
    await pool.query(
      'UPDATE apps SET apk_url = $1, status = $2 WHERE id = $3',
      [apkUrl, 'completed', id]
    );
    
    console.log(`✅ Build completed: ${apkUrl}`);
  } catch (error) {
    console.error('Build error:', error.message);
    await pool.query('UPDATE apps SET status = $1 WHERE id = $2', ['failed', id]);
  }
});

app.get('/api/build-status/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT status, apk_url FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, ...result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/download/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0 || !result.rows[0].apk_url) return res.status(404).json({ error: 'APK not found' });
    res.download(path.join(__dirname, result.rows[0].apk_url), `${result.rows[0].name}.apk`);
  } catch (error) {
    res.status(500).json({ error: 'Download failed' });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
