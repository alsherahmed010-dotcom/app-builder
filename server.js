const express = require('express');
const { exec } = require('child_process');
const { Pool } = require('pg');
const multer = require('multer');
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

let admin = null;
const rawKey = process.env.FIREBASE_PRIVATE_KEY || '';
let privateKey = rawKey.replace(/\\n/g, '\n');
if (!privateKey.includes('\n') && privateKey.includes('BEGIN')) {
  const base64Part = privateKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').trim();
  const chunks = base64Part.match(/.{1,64}/g) || [];
  privateKey = '-----BEGIN PRIVATE KEY-----\n' + chunks.join('\n') + '\n-----END PRIVATE KEY-----\n';
}
if (privateKey && process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL) {
  try { admin = require('firebase-admin'); admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, privateKey, clientEmail: process.env.FIREBASE_CLIENT_EMAIL }) }); } catch (e) {}
}

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const storage = multer.diskStorage({ destination: (req, file, cb) => cb(null, uploadDir), filename: (req, file, cb) => cb(null, Date.now() + '.png') });
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
    await pool.query(`CREATE TABLE IF NOT EXISTS apps (id SERIAL PRIMARY KEY, name VARCHAR(255), package_name VARCHAR(255), app_type VARCHAR(50) DEFAULT 'html', content TEXT, icon_url TEXT, apk_url TEXT, status VARCHAR(50) DEFAULT 'pending', description TEXT, fps INTEGER DEFAULT 120, welcome_message TEXT, exit_message TEXT, notification_enabled BOOLEAN DEFAULT false, admob_enabled BOOLEAN DEFAULT false, admob_banner_id TEXT, admob_interstitial_id TEXT, version INTEGER DEFAULT 1, latest_apk_url TEXT, fcm_token TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, app_id INTEGER, title VARCHAR(255), message TEXT, type VARCHAR(50), sound VARCHAR(50), created_at TIMESTAMP DEFAULT NOW())`);
    console.log('✅ DB');
  } catch (e) { console.error('DB:', e.message); }
}
initDB();

const keystorePath = path.join(__dirname, 'debug.keystore');
if (!fs.existsSync(keystorePath)) {
  exec(`keytool -genkey -v -keystore ${keystorePath} -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`, (err) => {});
}

app.get('/', (req, res) => res.json({ status: 'running' }));

// صفحة الإصدار
app.get('/version/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT name, version, apk_url, latest_apk_url FROM apps WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const appData = r.rows[0];
    res.send(`
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>${appData.name} - الإصدار</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:20px;padding:30px;text-align:center;max-width:350px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
h1{font-size:20px;color:#333;margin-bottom:5px}
.version-badge{display:inline-block;background:#667eea;color:#fff;padding:5px 20px;border-radius:20px;font-size:14px;font-weight:700;margin:10px 0}
p{color:#666;font-size:13px;line-height:1.8}
.download-btn{display:inline-block;margin-top:20px;padding:15px 40px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border-radius:12px;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 5px 20px rgba(102,126,234,0.4)}
.download-btn:hover{transform:translateY(-2px)}
</style>
</head>
<body>
<div class="card">
    <h1>📱 ${appData.name}</h1>
    <div class="version-badge">الإصدار ${appData.version}</div>
    <p>أحدث إصدار متاح للتحميل</p>
    <a href="${appData.latest_apk_url || appData.apk_url}" class="download-btn" download>⬇️ تحميل الآن</a>
</div>
</body>
</html>`);
  } catch (e) { res.status(500).send('Error'); }
});

// محتوى التطبيق
app.get('/api/app-content/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM apps WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const appData = r.rows[0];
    const apiBase = 'https://app-builder-production-ab4d.up.railway.app';

    if (appData.app_type === 'webview' && appData.content) {
      return res.redirect(appData.content);
    }

    let content = appData.content || '';
    if (!content.includes('<!DOCTYPE') && !content.includes('<html')) {
      content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;">${content}</body></html>`;
    }

    // رسالة تحديث جميلة + فحص مستمر
    content += `
<style>
.update-overlay{position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:99999;display:none;align-items:center;justify-content:center;backdrop-filter:blur(5px)}
.update-card{background:linear-gradient(135deg,#fff,#f8f9ff);border-radius:25px;padding:35px 25px;text-align:center;max-width:340px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,0.5);animation:slideUp 0.5s}
@keyframes slideUp{from{transform:translateY(50px);opacity:0}to{transform:translateY(0);opacity:1}}
.update-icon{font-size:60px;margin-bottom:15px}
.update-title{font-size:20px;font-weight:800;color:#333;margin-bottom:10px;letter-spacing:-0.5px}
.update-text{font-size:14px;color:#666;margin-bottom:20px;line-height:1.6}
.update-btn{display:inline-block;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;padding:15px 35px;border-radius:15px;text-decoration:none;font-weight:700;font-size:15px;box-shadow:0 5px 20px rgba(102,126,234,0.5);transition:all 0.3s}
.update-btn:hover{transform:translateY(-3px);box-shadow:0 8px 30px rgba(102,126,234,0.7)}
.update-later{display:block;margin-top:15px;background:none;border:none;color:#999;font-size:12px;cursor:pointer;text-decoration:underline}
</style>
<div class="update-overlay" id="updateOverlay">
    <div class="update-card">
        <div class="update-icon">🔄</div>
        <div class="update-title">يوجد إصدار جديد!</div>
        <div class="update-text">تم تحديث التطبيق.<br>يرجى تحميل النسخة الأحدث</div>
        <a href="#" class="update-btn" id="updateBtn" download>⬇️ تحديث الآن</a>
        <button class="update-later" onclick="document.getElementById('updateOverlay').style.display='none'">لاحقًا</button>
    </div>
</div>
<script>
(function() {
    var currentVersion = ${parseInt(appData.version) || 1};
    var lastNotifId = 0;

    function checkForUpdate() {
        fetch('${apiBase}/api/check-update/${req.params.id}')
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.version > currentVersion && d.latest_apk_url) {
                    document.getElementById('updateBtn').href = '${apiBase}' + d.latest_apk_url;
                    document.getElementById('updateOverlay').style.display = 'flex';
                }
            }).catch(function() {});
    }

    function checkNotifications() {
        fetch('${apiBase}/api/notifications/${req.params.id}')
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (d.notifications && d.notifications.length > 0) {
                    var last = d.notifications[0];
                    if (last.id !== lastNotifId) {
                        lastNotifId = last.id;
                        var notif = document.createElement('div');
                        notif.style.cssText = 'position:fixed;top:15px;right:15px;left:15px;background:#fff;padding:15px 20px;border-radius:15px;z-index:99998;box-shadow:0 5px 20px rgba(0,0,0,0.3);font-family:Segoe UI,sans-serif;';
                        notif.innerHTML = '<strong style="font-size:14px;">📢 ' + last.title + '</strong><br><span style="font-size:12px;color:#666;">' + last.message + '</span>';
                        document.body.appendChild(notif);
                        setTimeout(function() { if (notif.parentElement) notif.remove(); }, 5000);
                    }
                }
            }).catch(function() {});
    }

    checkForUpdate();
    checkNotifications();
    setInterval(checkForUpdate, 3000);
    setInterval(checkNotifications, 3000);
})();
</script>`;

    res.send(content);
  } catch (e) { res.status(500).send('Error'); }
});

app.post('/api/notify/:id', async (req, res) => {
  try {
    const { title, message, type, sound } = req.body;
    await pool.query('INSERT INTO notifications (app_id, title, message, type, sound) VALUES ($1,$2,$3,$4,$5)', [req.params.id, title, message, type, sound]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications/:appId', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notifications WHERE app_id=$1 ORDER BY created_at DESC LIMIT 10', [req.params.appId]); res.json({ success: true, notifications: r.rows }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/check-update/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT version, latest_apk_url FROM apps WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, version: r.rows[0].version, latest_apk_url: r.rows[0].latest_apk_url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/apps', upload.single('icon'), async (req, res) => {
  try {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    const r = await pool.query(`INSERT INTO apps (name, package_name, app_type, content, icon_url, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [name, package_name, app_type, content, icon_url, description, parseInt(fps)||120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id]);
    res.json({ success: true, app: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apps', async (req, res) => {
  try { const r = await pool.query('SELECT DISTINCT ON (package_name) * FROM apps ORDER BY package_name, created_at DESC'); res.json({ success: true, apps: r.rows }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apps/:id', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM apps WHERE id=$1', [req.params.id]); if (r.rows.length===0) return res.status(404).json({error:'Not found'}); res.json({success:true, app:r.rows[0]}); } catch (e) { res.status(500).json({error:e.message}); }
});

app.put('/api/apps/:id', upload.single('icon'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const old = await pool.query('SELECT * FROM apps WHERE id=$1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const oldData = old.rows[0];
    const { name, package_name, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    const nameChanged = name && name !== oldData.name;
    const packageChanged = package_name && package_name !== oldData.package_name;
    const iconChanged = !!icon_url;
    const needsNewVersion = nameChanged || packageChanged || iconChanged;
    const newVersion = needsNewVersion ? oldData.version + 1 : oldData.version;

    await pool.query(`UPDATE apps SET name=COALESCE($1,name), package_name=COALESCE($2,package_name), content=COALESCE($3,content), description=COALESCE($4,description), fps=COALESCE($5,fps), welcome_message=COALESCE($6,welcome_message), exit_message=COALESCE($7,exit_message), notification_enabled=COALESCE($8,notification_enabled), admob_enabled=COALESCE($9,admob_enabled), admob_banner_id=COALESCE($10,admob_banner_id), admob_interstitial_id=COALESCE($11,admob_interstitial_id), version=$12, updated_at=NOW() WHERE id=$13`, [name, package_name, content, description, parseInt(fps)||120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, newVersion, id]);
    if (icon_url) await pool.query('UPDATE apps SET icon_url=$1 WHERE id=$2', [icon_url, id]);
    res.json({ success: true, message: needsNewVersion ? '✅ تم الحفظ! سيظهر إشعار إصدار جديد.' : '✅ تم التحديث اللحظي!', needsNewVersion });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/apps/:id', async (req, res) => {
  try { await pool.query('DELETE FROM apps WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/build/:id', async (req, res) => {
  const { id } = req.params;
  res.json({ success: true, message: 'Build started' });
  try {
    await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['building', id]);
    const result = await pool.query('SELECT * FROM apps WHERE id=$1', [id]);
    const appData = result.rows[0];
    const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
    const appDir = path.join(__dirname, 'builds', String(id));
    fs.mkdirSync(`${appDir}/assets`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/drawable`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/values`, { recursive: true });

    const liveHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;"><iframe src="https://app-builder-production-ab4d.up.railway.app/api/app-content/${id}" style="width:100%;height:100vh;border:none;"></iframe></body></html>`;
    fs.writeFileSync(`${appDir}/assets/index.html`, liveHtml);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appData.name}</string></resources>`);

    let hasIcon = false;
    if (appData.icon_url) { const p = path.join(__dirname, appData.icon_url); if (fs.existsSync(p)) { fs.copyFileSync(p, `${appDir}/res/drawable/ic_launcher.png`); hasIcon = true; } }

    fs.writeFileSync(`${appDir}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${safeName}">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="@string/app_name"${hasIcon ? ' android:icon="@drawable/ic_launcher"' : ''} android:usesCleartextTraffic="true">
        <activity android:name=".MainActivity" android:exported="true" android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`);

    const javaUrl = appData.app_type === 'webview' && appData.content ? `"${appData.content}"` : '"file:///android_asset/index.html"';
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
        s.setAllowFileAccess(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        w.setWebViewClient(new WebViewClient());
        w.loadUrl(${javaUrl});
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
      if (err) { console.error('Build:', stderr || err.message); await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]); }
      else { const u = `/builds/${id}/final.apk`; await pool.query('UPDATE apps SET apk_url=$1, latest_apk_url=$1, status=$2 WHERE id=$3', [u, 'completed', id]); console.log(`✅ Build: ${u}`); }
    });
  } catch (e) { console.error('Error:', e.message); await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]); }
});

app.get('/api/build-status/:id', async (req, res) => {
  try { const r = await pool.query('SELECT status, apk_url, version FROM apps WHERE id=$1', [req.params.id]); res.json({ success: true, ...r.rows[0] }); } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
