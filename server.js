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
    console.log('✅ DB Ready');
  } catch (e) { console.error('DB:', e.message); }
}
initDB();

const keystorePath = path.join(__dirname, 'debug.keystore');
if (!fs.existsSync(keystorePath)) {
  exec(`keytool -genkey -v -keystore ${keystorePath} -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`, (err) => {});
}

app.get('/', (req, res) => res.json({ status: 'running' }));

// API للتحديث اللحظي
app.get('/api/live-content/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM apps WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).send('Not found');
    const appData = r.rows[0];
    
    let content = appData.content || '';
    
    if (appData.app_type === 'webview' && content) {
      content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;"><iframe src="${content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    }
    
    if (!content.includes('<html')) {
      content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;">${content}</body></html>`;
    }
    
    // إضافة رسالة ترحيب مع زر موافق
    if (appData.welcome_message) {
      const welcomeScript = `
<script>
(function() {
  if (!localStorage.getItem('welcome_shown')) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = '<div style="background:#fff;border-radius:20px;padding:30px;text-align:center;max-width:300px;width:90%;"><h3 style="color:#333;font-size:18px;">${appData.welcome_message.replace(/'/g, "\\'")}</h3><button onclick="localStorage.setItem(\'welcome_shown\',\'1\');this.parentElement.parentElement.remove();" style="margin-top:20px;padding:12px 30px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;">موافق</button></div>';
    document.body.appendChild(overlay);
  }
})();
</script>`;
      content += welcomeScript;
    }
    
    // إضافة زر خروج
    if (appData.exit_message) {
      const exitScript = `
<script>
(function() {
  if (!localStorage.getItem('exit_shown')) {
    window.addEventListener('beforeunload', function(e) {
      if (!localStorage.getItem('exit_shown')) {
        localStorage.setItem('exit_shown', '1');
        e.preventDefault();
        e.returnValue = '${appData.exit_message.replace(/'/g, "\\'")}';
        return '${appData.exit_message.replace(/'/g, "\\'")}';
      }
    });
  }
})();
</script>`;
      content += exitScript;
    }
    
    // فحص الإشعارات
    const apiBase = 'https://app-builder-production-ab4d.up.railway.app';
    content += `
<script>
(function() {
  var lastNotif = 0;
  setInterval(function() {
    fetch('${apiBase}/api/notifications/${req.params.id}')
      .then(r => r.json())
      .then(d => {
        if (d.notifications && d.notifications.length > 0) {
          var n = d.notifications[0];
          if (n.id !== lastNotif) {
            lastNotif = n.id;
            var div = document.createElement('div');
            div.style.cssText = 'position:fixed;top:15px;right:15px;left:15px;background:#fff;padding:15px;border-radius:12px;z-index:99998;box-shadow:0 5px 20px rgba(0,0,0,.3);';
            div.innerHTML = '<strong>📢 ' + n.title + '</strong><br>' + n.message;
            document.body.appendChild(div);
            setTimeout(function() { div.remove(); }, 5000);
          }
        }
      });
  }, 5000);
})();
</script>`;
    
    res.send(content);
  } catch (e) { res.status(500).send('Error'); }
});

// إرسال إشعار
app.post('/api/notify/:id', async (req, res) => {
  try {
    const { title, message, type, sound } = req.body;
    await pool.query('INSERT INTO notifications (app_id, title, message, type, sound) VALUES ($1,$2,$3,$4,$5)', [req.params.id, title, message, type, sound]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// جلب الإشعارات
app.get('/api/notifications/:appId', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM notifications WHERE app_id=$1 ORDER BY created_at DESC LIMIT 10', [req.params.appId]);
    res.json({ success: true, notifications: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// إنشاء تطبيق
app.post('/api/apps', upload.single('icon'), async (req, res) => {
  try {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    const r = await pool.query(`INSERT INTO apps (name, package_name, app_type, content, icon_url, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [name, package_name, app_type, content, icon_url, description, parseInt(fps)||120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id]);
    res.json({ success: true, app: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// عرض التطبيقات
app.get('/api/apps', async (req, res) => {
  try {
    const r = await pool.query('SELECT DISTINCT ON (package_name) * FROM apps ORDER BY package_name, created_at DESC');
    res.json({ success: true, apps: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// تطبيق محدد
app.get('/api/apps/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM apps WHERE id=$1', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, app: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// تعديل
app.put('/api/apps/:id', upload.single('icon'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const old = await pool.query('SELECT * FROM apps WHERE id=$1', [id]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const oldData = old.rows[0];
    
    const { name, package_name, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const nameChanged = name && name !== oldData.name;
    const iconChanged = !!icon_url;
    const needsNewVersion = nameChanged || iconChanged;
    const newVersion = needsNewVersion ? oldData.version + 1 : oldData.version;
    
    await pool.query(`UPDATE apps SET name=COALESCE($1,name), package_name=COALESCE($2,package_name), content=COALESCE($3,content), description=COALESCE($4,description), fps=COALESCE($5,fps), welcome_message=COALESCE($6,welcome_message), exit_message=COALESCE($7,exit_message), notification_enabled=COALESCE($8,notification_enabled), admob_enabled=COALESCE($9,admob_enabled), admob_banner_id=COALESCE($10,admob_banner_id), admob_interstitial_id=COALESCE($11,admob_interstitial_id), version=$12, updated_at=NOW() WHERE id=$13`, [name, package_name, content, description, parseInt(fps)||120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, newVersion, id]);
    
    if (icon_url) await pool.query('UPDATE apps SET icon_url=$1 WHERE id=$2', [icon_url, id]);
    
    res.json({ success: true, message: needsNewVersion ? '✅ تم الحفظ! سيظهر إشعار تحديث.' : '✅ تم التحديث اللحظي!' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// حذف
app.delete('/api/apps/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM apps WHERE id=$1', [req.params.id]);
    await pool.query('DELETE FROM notifications WHERE app_id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// بناء APK
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
    
    const liveHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;"><iframe src="https://app-builder-production-ab4d.up.railway.app/api/live-content/${id}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    
    fs.writeFileSync(`${appDir}/assets/index.html`, liveHtml);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appData.name}</string></resources>`);
    
    let hasIcon = false;
    if (appData.icon_url) {
      const p = path.join(__dirname, appData.icon_url);
      if (fs.existsSync(p)) {
        const buffer = fs.readFileSync(p);
        if (buffer[0] === 0x89 && buffer[1] === 0x50) {
          fs.copyFileSync(p, `${appDir}/res/drawable/ic_launcher.png`);
          hasIcon = true;
        }
      }
    }
    
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
    
    const resCompile = hasIcon ? '$ANDROID_HOME/build-tools/34.0.0/aapt2 compile --dir res -o compiled.zip &&' : '';
    const linkRes = hasIcon ? 'compiled.zip' : '';
    
    const buildCmd = `cd ${appDir} && \
    ${resCompile} \
    javac -source 1.7 -target 1.7 -classpath $ANDROID_HOME/platforms/android-34/android.jar -d . MainActivity.java 2>/dev/null && \
    $ANDROID_HOME/build-tools/34.0.0/d8 --release --lib $ANDROID_HOME/platforms/android-34/android.jar --output . ${safeName.replace(/\./g,'/')}/MainActivity.class && \
    $ANDROID_HOME/build-tools/34.0.0/aapt2 link -o unaligned.apk -I $ANDROID_HOME/platforms/android-34/android.jar --manifest AndroidManifest.xml -A assets ${linkRes} && \
    $ANDROID_HOME/build-tools/34.0.0/aapt add unaligned.apk classes.dex && \
    $ANDROID_HOME/build-tools/34.0.0/zipalign -p -f 4 unaligned.apk app-final.apk && \
    cp /app/debug.keystore . 2>/dev/null || keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null; \
    $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android app-final.apk && \
    cp app-final.apk final.apk`;
    
    exec(buildCmd, { timeout: 180000 }, async (err, stdout, stderr) => {
      if (err) {
        console.error('Build:', stderr || err.message);
        await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]);
      } else {
        const u = `/builds/${id}/final.apk`;
        await pool.query('UPDATE apps SET apk_url=$1, latest_apk_url=$1, status=$2 WHERE id=$3', [u, 'completed', id]);
        console.log(`✅ Build: ${u}`);
      }
    });
  } catch (e) {
    console.error('Error:', e.message);
    await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]);
  }
});

app.get('/api/build-status/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT status, apk_url, version FROM apps WHERE id=$1', [req.params.id]);
    res.json({ success: true, ...r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
