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
  try {
    admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert({ projectId: process.env.FIREBASE_PROJECT_ID, privateKey, clientEmail: process.env.FIREBASE_CLIENT_EMAIL }) });
    console.log('✅ Firebase initialized');
  } catch (e) { console.error('❌ Firebase:', e.message); }
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
app.use('/libs', express.static('libs'));

const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_URL_INTERNAL || process.env.DATABASE_PUBLIC_URL;
const pool = new Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

async function initDB() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS apps (id SERIAL PRIMARY KEY, name VARCHAR(255), package_name VARCHAR(255), app_type VARCHAR(50) DEFAULT 'html', content TEXT, icon_url TEXT, apk_url TEXT, status VARCHAR(50) DEFAULT 'pending', description TEXT, fps INTEGER DEFAULT 120, welcome_message TEXT, exit_message TEXT, notification_enabled BOOLEAN DEFAULT false, admob_enabled BOOLEAN DEFAULT false, admob_banner_id TEXT, admob_interstitial_id TEXT, admob_rewarded_id TEXT, admob_appopen_id TEXT, version INTEGER DEFAULT 1, latest_apk_url TEXT, fcm_token TEXT, created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS admob_rewarded_id TEXT`);
    await pool.query(`ALTER TABLE apps ADD COLUMN IF NOT EXISTS admob_appopen_id TEXT`);
    await pool.query(`CREATE TABLE IF NOT EXISTS notifications (id SERIAL PRIMARY KEY, app_id INTEGER, title VARCHAR(255), message TEXT, type VARCHAR(50), sound VARCHAR(50), created_at TIMESTAMP DEFAULT NOW())`);
    console.log('✅ Database initialized');
  } catch (e) { console.error('DB:', e.message); }
}
initDB();

const keystorePath = path.join(__dirname, 'debug.keystore');
if (!fs.existsSync(keystorePath)) {
  exec(`keytool -genkey -v -keystore ${keystorePath} -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`, (err) => {
    if (err) console.error('Keystore:', err.message);
    else console.log('✅ Keystore created');
  });
}

app.get('/', (req, res) => res.json({ status: 'running', firebase: admin ? 'connected' : 'not connected' }));

app.post('/api/notify/:id', async (req, res) => {
  try {
    const { title, message, type, sound } = req.body;
    await pool.query('INSERT INTO notifications (app_id, title, message, type, sound) VALUES ($1,$2,$3,$4,$5)', [req.params.id, title, message, type, sound]);
    const appResult = await pool.query('SELECT fcm_token FROM apps WHERE id = $1', [req.params.id]);
    const fcmToken = appResult.rows[0]?.fcm_token;
    if (fcmToken && admin) {
      await admin.messaging().send({ token: fcmToken, notification: { title, body: message }, android: { priority: 'high', notification: { sound: 'default', channelId: 'default' } } });
      console.log('📢 FCM sent');
      res.json({ success: true, message: '✅ تم إرسال الإشعار!' });
    } else {
      res.json({ success: true, message: '✅ تم الحفظ!' });
    }
  } catch (e) { console.error('FCM:', e.message); res.status(500).json({ error: e.message }); }
});

app.post('/api/register-token/:id', async (req, res) => {
  try { await pool.query('UPDATE apps SET fcm_token = $1 WHERE id = $2', [req.body.token, req.params.id]); res.json({ success: true }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/app-content/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM apps WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const appData = result.rows[0];
    let content = appData.content || '';
    const apiBase = 'https://app-builder-production-ab4d.up.railway.app';
    if (appData.welcome_message) content = `<script>alert('${appData.welcome_message.replace(/'/g, "\\'")}');</script>${content}`;
    content += `<script>(function(){var v=${parseInt(appData.version)||1},n=0;setInterval(function(){fetch('${apiBase}/api/check-update/${req.params.id}').then(r=>r.json()).then(d=>{if(d.version>v&&d.latest_apk_url){if(confirm('🔄 يوجد تحديث جديد!\\n\\nتحميل الآن؟'))window.open('${apiBase}'+d.latest_apk_url,'_blank')}}).catch(()=>{})},30000);setInterval(function(){fetch('${apiBase}/api/notifications/${req.params.id}').then(r=>r.json()).then(d=>{if(d.notifications&&d.notifications.length>0){var l=d.notifications[0];if(l.id!==n){n=l.id;if(${appData.notification_enabled?'true':'false'})alert('📢 '+l.title+'\\n\\n'+l.message)}}}).catch(()=>{})},10000)})();</script>`;
    res.send(content);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/check-update/:id', async (req, res) => {
  try { const r = await pool.query('SELECT version, latest_apk_url FROM apps WHERE id=$1', [req.params.id]); res.json({ success: true, ...r.rows[0] }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications/:appId', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM notifications WHERE app_id=$1 ORDER BY created_at DESC LIMIT 20', [req.params.appId]); res.json({ success: true, notifications: r.rows }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/apps', upload.single('icon'), async (req, res) => {
  try {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, admob_rewarded_id, admob_appopen_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    const r = await pool.query(`INSERT INTO apps (name, package_name, app_type, content, icon_url, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, admob_rewarded_id, admob_appopen_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [name, package_name, app_type, content, icon_url, description, parseInt(fps)||120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, admob_rewarded_id, admob_appopen_id]);
    res.json({ success: true, app: r.rows[0] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apps', async (req, res) => {
  try { const r = await pool.query('SELECT DISTINCT ON (package_name) * FROM apps ORDER BY package_name, created_at DESC'); res.json({ success: true, apps: r.rows }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/apps/:id', async (req, res) => {
  try { const r = await pool.query('SELECT * FROM apps WHERE id=$1', [req.params.id]); if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' }); res.json({ success: true, app: r.rows[0] }); } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/apps/:id', upload.single('icon'), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, admob_rewarded_id, admob_appopen_id } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    await pool.query(`UPDATE apps SET name=COALESCE($1,name), package_name=COALESCE($2,package_name), content=COALESCE($3,content), description=COALESCE($4,description), fps=COALESCE($5,fps), welcome_message=COALESCE($6,welcome_message), exit_message=COALESCE($7,exit_message), notification_enabled=COALESCE($8,notification_enabled), admob_enabled=COALESCE($9,admob_enabled), admob_banner_id=COALESCE($10,admob_banner_id), admob_interstitial_id=COALESCE($11,admob_interstitial_id), admob_rewarded_id=COALESCE($12,admob_rewarded_id), admob_appopen_id=COALESCE($13,admob_appopen_id), version=version+1 WHERE id=$14`, [name, package_name, content, description, parseInt(fps)||120, welcome_message, exit_message, notification_enabled, admob_enabled, admob_banner_id, admob_interstitial_id, admob_rewarded_id, admob_appopen_id, id]);
    if (icon_url) await pool.query('UPDATE apps SET icon_url=$1 WHERE id=$2', [icon_url, id]);
    res.json({ success: true, message: '✅ تم الحفظ!' });
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
    fs.mkdirSync(`${appDir}/libs`, { recursive: true });
    
    // نسخ مكتبة AdMob
    const admobLib = path.join(__dirname, 'libs', 'play-services-ads.jar');
    if (fs.existsSync(admobLib)) { fs.copyFileSync(admobLib, `${appDir}/libs/play-services-ads.jar`); }
    
    const liveHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0;padding:0;"><iframe src="https://app-builder-production-ab4d.up.railway.app/api/app-content/${id}" style="width:100%;height:100vh;border:none;"></iframe></body></html>`;
    fs.writeFileSync(`${appDir}/assets/index.html`, liveHtml);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">App</string></resources>`);
    
    let hasIcon = false;
    if (appData.icon_url) { const p = path.join(__dirname, appData.icon_url); if (fs.existsSync(p)) { fs.copyFileSync(p, `${appDir}/res/drawable/ic_launcher.png`); hasIcon = true; } }
    
    const admobMeta = appData.admob_enabled && appData.admob_banner_id ? `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${appData.admob_banner_id.split('/')[0]}"/>` : '';
    
    fs.writeFileSync(`${appDir}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${safeName}">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
    <uses-permission android:name="android.permission.INTERNET" />
    <application android:label="App"${hasIcon ? ' android:icon="@drawable/ic_launcher"' : ''} android:usesCleartextTraffic="true" android:hardwareAccelerated="true">${admobMeta}
        <activity android:name=".MainActivity" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`);
    
    // MainActivity مع إعلانات + FCM
    const hasAdmob = appData.admob_enabled && fs.existsSync(`${appDir}/libs/play-services-ads.jar`);
    const bannerCode = hasAdmob && appData.admob_banner_id ? `
        com.google.android.gms.ads.MobileAds.initialize(this);
        android.widget.LinearLayout layout = new android.widget.LinearLayout(this);
        layout.setOrientation(android.widget.LinearLayout.VERTICAL);
        com.google.android.gms.ads.AdView adView = new com.google.android.gms.ads.AdView(this);
        adView.setAdSize(com.google.android.gms.ads.AdSize.BANNER);
        adView.setAdUnitId("${appData.admob_banner_id}");
        adView.loadAd(new com.google.android.gms.ads.AdRequest.Builder().build());
        layout.addView(adView, new android.widget.LinearLayout.LayoutParams(-1, -2));
        layout.addView(w, new android.widget.LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(layout);` : 'setContentView(w);';
    
    // Interstitial إعلان
    const interstitialCode = hasAdmob && appData.admob_interstitial_id ? `
        com.google.android.gms.ads.InterstitialAd.load(this, "${appData.admob_interstitial_id}", new com.google.android.gms.ads.AdRequest.Builder().build(), new com.google.android.gms.ads.interstitial.InterstitialAdLoadCallback() {
            @Override
            public void onAdLoaded(com.google.android.gms.ads.interstitial.InterstitialAd ad) { ad.show(MainActivity.this); }
        });` : '';
    
    // App Open إعلان
    const appOpenCode = hasAdmob && appData.admob_appopen_id ? `
        com.google.android.gms.ads.appopen.AppOpenAd.load(this, "${appData.admob_appopen_id}", new com.google.android.gms.ads.AdRequest.Builder().build(), new com.google.android.gms.ads.appopen.AppOpenAd.AppOpenAdLoadCallback() {
            @Override
            public void onAdLoaded(com.google.android.gms.ads.appopen.AppOpenAd ad) { ad.show(MainActivity.this); }
        });` : '';
    
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
        ${bannerCode}
        ${interstitialCode}
        ${appOpenCode}
    }
}`);
    
    const admobClasspath = hasAdmob ? `${appDir}/libs/play-services-ads.jar` : '';
    const buildCmd = `cd ${appDir} && \
    $ANDROID_HOME/build-tools/34.0.0/aapt2 compile --dir res -o compiled.zip && \
    javac -source 1.7 -target 1.7 -classpath $ANDROID_HOME/platforms/android-34/android.jar:${admobClasspath} -d . MainActivity.java 2>/dev/null && \
    $ANDROID_HOME/build-tools/34.0.0/d8 --release --lib $ANDROID_HOME/platforms/android-34/android.jar --lib ${admobClasspath} --output . ${safeName.replace(/\./g,'/')}/MainActivity.class && \
    $ANDROID_HOME/build-tools/34.0.0/aapt2 link -o unaligned.apk -I $ANDROID_HOME/platforms/android-34/android.jar --manifest AndroidManifest.xml -A assets compiled.zip && \
    $ANDROID_HOME/build-tools/34.0.0/aapt add unaligned.apk classes.dex && \
    $ANDROID_HOME/build-tools/34.0.0/zipalign -p -f 4 unaligned.apk app-final.apk && \
    cp /app/debug.keystore . 2>/dev/null || keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US" 2>/dev/null; \
    $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android app-final.apk && \
    cp app-final.apk final.apk`;
    
    exec(buildCmd, { timeout: 180000 }, async (err, stdout, stderr) => {
      if (err) { console.error('Build:', stderr || err.message); await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]); }
      else { const u = `/builds/${id}/final.apk`; await pool.query('UPDATE apps SET apk_url=$1, latest_apk_url=$1, status=$2, version=version+1 WHERE id=$3', [u, 'completed', id]); console.log(`✅ Build: ${u}`); }
    });
  } catch (e) { console.error('Error:', e.message); await pool.query('UPDATE apps SET status=$1 WHERE id=$2', ['failed', id]); }
});

app.get('/api/build-status/:id', async (req, res) => {
  try { const r = await pool.query('SELECT status, apk_url, version FROM apps WHERE id=$1', [req.params.id]); res.json({ success: true, ...r.rows[0] }); } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
