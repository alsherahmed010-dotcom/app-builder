const express = require('express');
const { exec } = require('child_process');
const { Pool } = require('pg');
const multer = require('multer');
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + '.png')
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/builds', express.static('builds'));
app.use('/uploads', express.static('uploads'));

const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_INTERNAL || process.env.DATABASE_PUBLIC_URL;
const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS apps (id SERIAL PRIMARY KEY, name VARCHAR(255), package_name VARCHAR(255), app_type VARCHAR(50) DEFAULT 'html', content TEXT, icon_url TEXT, apk_url TEXT, status VARCHAR(50) DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS icon_url TEXT`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS apk_url TEXT`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending'`);
    console.log('✅ Database initialized');
  } catch (e) {
    console.error('DB error:', e.message);
  }
}
initDB();

const keystorePath = path.join(__dirname, 'debug.keystore');
if (!fs.existsSync(keystorePath)) {
  exec(`keytool -genkey -v -keystore ${keystorePath} -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`, (err) => {
    if (err) console.error('Keystore error:', err.message);
    else console.log('✅ Keystore created');
  });
}

app.get('/', (req, res) => res.json({ status: 'running' }));

app.post('/api/apps', upload.single('icon'), async (req, res) => {
  try {
    const { name, package_name, app_type, content } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    console.log('📸 Icon:', icon_url);
    
    const result = await pool.query(
      'INSERT INTO apps (name, package_name, app_type, content, icon_url) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [name, package_name, app_type, content, icon_url]
    );
    res.json({ success: true, app: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/apps', async (req, res) => {
  try {
    const result = await pool.query('SELECT DISTINCT ON (package_name) * FROM apps ORDER BY package_name, created_at DESC');
    res.json({ success: true, apps: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/apps/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, app: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/build/:id', async (req, res) => {
  const { id } = req.params;
  res.json({ success: true, message: 'Build started' });
  
  try {
    await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['building', id]);
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [id]);
    const appData = result.rows[0];
    
    const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
    const appDir = path.join(__dirname, 'builds', String(id));
    
    fs.mkdirSync(`${appDir}/assets`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/drawable`, { recursive: true });
    
    let htmlContent = appData.content;
    if (appData.app_type === 'webview') {
      htmlContent = `<!DOCTYPE html><html><body style="margin:0;padding:0;"><iframe src="${appData.content}" style="width:100%;height:100vh;border:none;"></iframe></body></html>`;
    }
    
    fs.writeFileSync(`${appDir}/assets/index.html`, htmlContent);
    
    // نسخ الأيقونة مع اسم مختلف
    let hasIcon = false;
    if (appData.icon_url) {
      const iconPath = path.join(__dirname, appData.icon_url);
      if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, `${appDir}/res/drawable/icon.png`);
        hasIcon = true;
        console.log('✅ Icon ready at res/drawable/icon.png');
      }
    }
    
    // Manifest من غير أيقونة لو مفيش
    const iconAttr = hasIcon ? ' android:icon="@drawable/icon"' : '';
    
    fs.writeFileSync(`${appDir}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${safeName}">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="${appData.name}"${iconAttr} android:usesCleartextTraffic="true">
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`);
    
    fs.writeFileSync(`${appDir}/MainActivity.java`, `package ${safeName};
import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        WebView w = new WebView(this);
        w.getSettings().setJavaScriptEnabled(true);
        w.setWebViewClient(new WebViewClient());
        w.loadUrl("file:///android_asset/index.html");
        setContentView(w);
    }
}`);
    
    // نستخدم -R res بس لو فيه أيقونة
    const resArg = hasIcon ? '-R res' : '';
    
    const buildCmd = `cd ${appDir} && \
    javac -source 1.7 -target 1.7 -classpath $ANDROID_HOME/platforms/android-34/android.jar -d . MainActivity.java 2>/dev/null && \
    $ANDROID_HOME/build-tools/34.0.0/d8 --release --lib $ANDROID_HOME/platforms/android-34/android.jar --output . ${safeName.replace(/\./g,'/')}/MainActivity.class && \
    $ANDROID_HOME/build-tools/34.0.0/aapt2 link -o unaligned.apk -I $ANDROID_HOME/platforms/android-34/android.jar --manifest AndroidManifest.xml -A assets ${resArg} && \
    $ANDROID_HOME/build-tools/34.0.0/aapt add unaligned.apk classes.dex && \
    $ANDROID_HOME/build-tools/34.0.0/zipalign -p -f 4 unaligned.apk app-final.apk && \
    cp /app/debug.keystore . 2>/dev/null || keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null; \
    $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android app-final.apk && \
    cp app-final.apk final.apk`;
    
    exec(buildCmd, { timeout: 120000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error('Build error:', stderr || err.message);
        await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]);
      } else {
        const apkUrl = `/builds/${id}/final.apk`;
        await pool.query('UPDATE apps SET apk_url=$1, status=$2 WHERE id=$3', [apkUrl, 'completed', id]);
        console.log(`✅ Build completed: ${apkUrl}`);
      }
    });
  } catch (e) {
    console.error('Error:', e.message);
    await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]);
  }
});

app.get('/api/build-status/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT status, apk_url FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, ...result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
