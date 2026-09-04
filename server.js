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
    await pool.query(`CREATE TABLE IF NOT EXISTS apps (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      package_name VARCHAR(255) NOT NULL,
      app_type VARCHAR(50) DEFAULT 'html',
      content TEXT,
      icon_url TEXT,
      apk_url TEXT,
      status VARCHAR(50) DEFAULT 'pending',
      description TEXT,
      fps INTEGER DEFAULT 120,
      welcome_message TEXT,
      exit_message TEXT,
      notification_enabled BOOLEAN DEFAULT false,
      admob_enabled BOOLEAN DEFAULT false,
      admob_banner_id TEXT,
      admob_interstitial_id TEXT,
      version INTEGER DEFAULT 1,
      latest_apk_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      app_id INTEGER,
      title VARCHAR(255),
      message TEXT,
      type VARCHAR(50),
      sound VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )`);
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

app.get('/api/app-content/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    
    const appData = result.rows[0];
    let content = appData.content || '';
    const apiBase = 'https://app-builder-production-ab4d.up.railway.app';
    
    if (appData.welcome_message) {
      content = `<script>alert('${appData.welcome_message.replace(/'/g, "\\'")}');</script>${content}`;
    }
    
    content += `
<script>
(function() {
    var _appVersion = ${parseInt(appData.version) || 1};
    var _lastNotifId = 0;
    setInterval(function() {
        try {
            fetch('${apiBase}/api/check-update/${req.params.id}')
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (data.version > _appVersion && data.latest_apk_url) {
                        if (confirm('🔄 يوجد تحديث جديد!\\n\\nتحميل الآن؟')) {
                            window.open('${apiBase}' + data.latest_apk_url, '_blank');
                        }
                    }
                })
                .catch(function() {});
        } catch(e) {}
    }, 30000);
    setInterval(function() {
        try {
            fetch('${apiBase}/api/notifications/${req.params.id}')
                .then(function(res) { return res.json(); })
                .then(function(data) {
                    if (data.notifications && data.notifications.length > 0) {
                        var last = data.notifications[0];
                        if (last.id !== _lastNotifId) {
                            _lastNotifId = last.id;
                            if (${appData.notification_enabled ? 'true' : 'false'}) {
                                if (last.type === 'in-app' || last.type === 'both') {
                                    alert('📢 ' + last.title + '\\n\\n' + last.message);
                                }
                            }
                        }
                    }
                })
                .catch(function() {});
        } catch(e) {}
    }, 10000);
})();
</script>`;
    
    res.send(content);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/notify/:id', async (req, res) => {
  try {
    const { title, message, type, sound } = req.body;
    await pool.query('INSERT INTO notifications (app_id, title, message, type, sound) VALUES ($1,$2,$3,$4,$5)', [req.params.id, title, message, type, sound]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/notifications/:appId', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications WHERE app_id = $1 ORDER BY created_at DESC LIMIT 20', [req.params.appId]);
    res.json({ success: true, notifications: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/check-update/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT version, latest_apk_url FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, version: result.rows[0].version, latest_apk_url: result.rows[0].latest_apk_url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/apps', upload.single('icon'), async (req, res) => {
  try {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const result = await pool.query(
      `INSERT INTO apps (name, package_name, app_type, content, icon_url, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [name, package_name, app_type, content, icon_url, description, parseInt(fps) || 120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id]
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

app.put('/api/apps/:id', upload.single('icon'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    await pool.query(
      `UPDATE apps SET 
        name = COALESCE($1, name),
        package_name = COALESCE($2, package_name),
        app_type = COALESCE($3, app_type),
        content = COALESCE($4, content),
        description = COALESCE($5, description),
        fps = COALESCE($6, fps),
        welcome_message = COALESCE($7, welcome_message),
        exit_message = COALESCE($8, exit_message),
        notification_enabled = COALESCE($9, notification_enabled),
        admob_enabled = COALESCE($10, admob_enabled),
        admob_banner_id = COALESCE($11, admob_banner_id),
        admob_interstitial_id = COALESCE($12, admob_interstitial_id),
        version = version + 1,
        updated_at = NOW()
      WHERE id = $13`,
      [name, package_name, app_type, content, description, parseInt(fps) || 120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, id]
    );
    
    if (icon_url) await pool.query('UPDATE apps SET icon_url = $1 WHERE id = $2', [icon_url, id]);
    res.json({ success: true, message: '✅ تم الحفظ!' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/apps/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM apps WHERE id = $1', [req.params.id]);
    res.json({ success: true });
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
    fs.mkdirSync(`${appDir}/res/values`, { recursive: true });
    
    const liveHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;">
    <iframe src="https://app-builder-production-ab4d.up.railway.app/api/app-content/${id}" style="width:100%;height:100vh;border:none;"></iframe>
</body>
</html>`;
    
    fs.writeFileSync(`${appDir}/assets/index.html`, liveHtml);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">App</string></resources>`);
    
    let hasIcon = false;
    if (appData.icon_url) {
      const iconPath = path.join(__dirname, appData.icon_url);
      if (fs.existsSync(iconPath)) {
        fs.copyFileSync(iconPath, `${appDir}/res/drawable/ic_launcher.png`);
        hasIcon = true;
      }
    }
    
    fs.writeFileSync(`${appDir}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${safeName}">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="App"${hasIcon ? ' android:icon="@drawable/ic_launcher"' : ''} android:usesCleartextTraffic="true" android:hardwareAccelerated="true">
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
import android.webkit.WebSettings;
public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        w.setWebViewClient(new WebViewClient());
        w.loadUrl("file:///android_asset/index.html");
        setContentView(w);
    }
}`);
    
    const buildCmd = `cd ${appDir} && \
    $ANDROID_HOME/build-tools/34.0.0/aapt2 compile --dir res -o compiled.zip && \
    javac -source 1.7 -target 1.7 -classpath $ANDROID_HOME/platforms/android-34/android.jar -d . MainActivity.java 2>/dev/null && \
    $ANDROID_HOME/build-tools/34.0.0/d8 --release --lib $ANDROID_HOME/platforms/android-34/android.jar --output . ${safeName.replace(/\./g,'/')}/MainActivity.class && \
    $ANDROID_HOME/build-tools/34.0.0/aapt2 link -o unaligned.apk -I $ANDROID_HOME/platforms/android-34/android.jar --manifest AndroidManifest.xml -A assets compiled.zip && \
    $ANDROID_HOME/build-tools/34.0.0/aapt add unaligned.apk classes.dex && \
    $ANDROID_HOME/build-tools/34.0.0/zipalign -p -f 4 unaligned.apk app-final.apk && \
    cp /app/debug.keystore . 2>/dev/null || keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null; \
    $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android app-final.apk && \
    cp app-final.apk final.apk`;
    
    exec(buildCmd, { timeout: 180000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error('Build error:', stderr || err.message);
        await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]);
      } else {
        const apkUrl = `/builds/${id}/final.apk`;
        await pool.query('UPDATE apps SET apk_url=$1, latest_apk_url=$1, status=$2, version=version+1 WHERE id=$3', [apkUrl, 'completed', id]);
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
    const result = await pool.query('SELECT status, apk_url, version FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, ...result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
