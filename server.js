const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

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

let apps = [];
if (fs.existsSync('apps.json')) {
    apps = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
}

let notifications = [];
if (fs.existsSync('notifications.json')) {
    notifications = JSON.parse(fs.readFileSync('notifications.json', 'utf8'));
}

let deviceTokens = [];
if (fs.existsSync('tokens.json')) {
    deviceTokens = JSON.parse(fs.readFileSync('tokens.json', 'utf8'));
}

function saveApps() { fs.writeFileSync('apps.json', JSON.stringify(apps, null, 2)); }
function saveNotifications() { fs.writeFileSync('notifications.json', JSON.stringify(notifications, null, 2)); }
function saveTokens() { fs.writeFileSync('tokens.json', JSON.stringify(deviceTokens, null, 2)); }

// FCM Configuration من متغيرات البيئة
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'pubg-skin-362e2';
const CLIENT_EMAIL = process.env.FIREBASE_CLIENT_EMAIL;
const PRIVATE_KEY = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

async function getAccessToken() {
    const auth = new google.auth.GoogleAuth({
        credentials: {
            type: 'service_account',
            project_id: PROJECT_ID,
            client_email: CLIENT_EMAIL,
            private_key: PRIVATE_KEY
        },
        scopes: ['https://www.googleapis.com/auth/firebase.messaging']
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token.token;
}

async function sendFCMMessage(token, title, body, appId) {
    try {
        const accessToken = await getAccessToken();
        
        const message = {
            message: {
                token: token,
                notification: {
                    title: title,
                    body: body
                },
                data: {
                    app_id: String(appId)
                },
                android: {
                    priority: 'high',
                    notification: {
                        sound: 'default',
                        channel_id: 'default'
                    }
                }
            }
        };
        
        const response = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(message)
        });
        
        const result = await response.json();
        console.log('FCM Response:', result);
        return { success: true, result };
    } catch (error) {
        console.error('FCM Error:', error);
        return { success: false, error: error.message };
    }
}

app.post('/api/register-device', (req, res) => {
    const { app_id, token } = req.body;
    if (!app_id || !token) return res.status(400).json({ error: 'Missing app_id or token' });
    
    const existing = deviceTokens.findIndex(d => d.token === token && d.app_id === app_id);
    if (existing === -1) {
        deviceTokens.push({ app_id, token, created_at: Date.now() });
        saveTokens();
    }
    
    res.json({ success: true, total_devices: deviceTokens.length });
});

app.post('/api/notifications', async (req, res) => {
    const { app_id, title, message } = req.body;
    
    const notification = {
        id: Date.now(),
        app_id,
        title,
        message,
        created_at: Date.now()
    };
    notifications.unshift(notification);
    saveNotifications();
    
    const appTokens = deviceTokens.filter(d => d.app_id === parseInt(app_id));
    
    let sentCount = 0;
    const results = [];
    
    for (const deviceToken of appTokens) {
        const result = await sendFCMMessage(deviceToken.token, title, message, app_id);
        if (result.success) sentCount++;
        results.push(result);
    }
    
    res.json({ 
        success: true, 
        notification, 
        sent_to: sentCount,
        total_devices: appTokens.length,
        results
    });
});

app.get('/api/notifications/:app_id', (req, res) => {
    const appNotifications = notifications.filter(n => n.app_id === parseInt(req.params.app_id));
    res.json({ success: true, notifications: appNotifications });
});

let stats = {};
if (fs.existsSync('stats.json')) {
    stats = JSON.parse(fs.readFileSync('stats.json', 'utf8'));
}

app.post('/api/stats/:app_id', (req, res) => {
    const appId = req.params.app_id;
    if (!stats[appId]) stats[appId] = { opens: 0, installs: 0 };
    stats[appId].opens++;
    fs.writeFileSync('stats.json', JSON.stringify(stats, null, 2));
    res.json({ success: true });
});

app.get('/api/stats/:app_id', (req, res) => {
    const appId = req.params.app_id;
    res.json({ success: true, stats: stats[appId] || { opens: 0, installs: 0 } });
});

app.get('/', (req, res) => res.json({ status: 'running' }));

app.post('/api/apps', upload.single('icon'), (req, res) => {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const appData = {
        id: Date.now(),
        name,
        package_name,
        app_type,
        content,
        description,
        fps: parseInt(fps) || 90,
        welcome_message,
        exit_message,
        icon_url,
        status: 'pending',
        apk_url: null,
        version: 1,
        createdAt: Date.now()
    };
    
    apps.unshift(appData);
    saveApps();
    res.json({ success: true, app: appData });
});

app.get('/api/apps', (req, res) => {
    res.json({ success: true, apps });
});

app.get('/api/apps/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, app: appData });
});

app.put('/api/apps/:id', upload.single('icon'), (req, res) => {
    const id = parseInt(req.params.id);
    const index = apps.findIndex(a => a.id === id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    
    const { name, package_name, content, description, welcome_message, exit_message } = req.body;
    if (name) apps[index].name = name;
    if (package_name) apps[index].package_name = package_name;
    if (content) apps[index].content = content;
    if (description) apps[index].description = description;
    if (welcome_message) apps[index].welcome_message = welcome_message;
    if (exit_message) apps[index].exit_message = exit_message;
    if (req.file) apps[index].icon_url = `/uploads/${req.file.filename}`;
    
    apps[index].version = (apps[index].version || 1) + 1;
    
    saveApps();
    res.json({ success: true, message: 'Update saved', version: apps[index].version });
});

app.delete('/api/apps/:id', (req, res) => {
    apps = apps.filter(a => a.id !== parseInt(req.params.id));
    saveApps();
    res.json({ success: true });
});

app.get('/api/live-content/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).send('Not found');
    
    let content = appData.content || '<h1>App</h1>';
    
    if (appData.app_type === 'url' && content) {
        content = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;"><iframe src="${content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    }
    if (!content.includes('<html')) {
        content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body style="margin:0;padding:0;">${content}</body></html>`;
    }
    
    if (appData.welcome_message) {
        content = content.replace('</body>', `<div id="welcome-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;">
            <div style="background:#fff;border-radius:20px;padding:30px;text-align:center;max-width:280px;">
                <h3 style="margin:0;color:#333;">${appData.welcome_message}</h3>
                <button onclick="document.getElementById('welcome-overlay').remove();localStorage.setItem('welcome_shown','1');" style="margin-top:20px;padding:12px 30px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">موافق</button>
            </div>
        </div>
        <script>if(localStorage.getItem('welcome_shown')){document.getElementById('welcome-overlay')?.remove();}</script></body>`);
    }
    
    if (appData.exit_message) {
        content = content.replace('</body>', `<script>window.addEventListener('beforeunload',function(e){if(!localStorage.getItem('exit_shown')){localStorage.setItem('exit_shown','1');e.preventDefault();e.returnValue='${appData.exit_message}';return '${appData.exit_message}';}});</script></body>`);
    }
    
    res.send(content);
});

app.get('/api/check-update/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    
    const currentVersion = parseInt(req.query.version) || 0;
    const hasUpdate = appData.version > currentVersion;
    
    res.json({ 
        success: true, 
        has_update: hasUpdate,
        current_version: appData.version,
        update_url: hasUpdate ? `/builds/${appData.id}/final.apk` : null
    });
});

app.post('/api/build/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const appData = apps.find(a => a.id === id);
    if (!appData) return res.status(404).json({ error: 'Not found' });
    
    res.json({ success: true, message: 'Build started' });
    
    const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
    const appDir = path.join(__dirname, 'builds', String(id));
    
    fs.mkdirSync(`${appDir}/assets`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/drawable`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/values`, { recursive: true });
    
    let htmlContent = appData.content || '<h1>App</h1>';
    if (appData.app_type === 'url' && appData.content) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;"><iframe src="${appData.content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    }
    if (!htmlContent.includes('<html')) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body style="margin:0;padding:0;">${htmlContent}</body></html>`;
    }
    
    htmlContent = htmlContent.replace('</head>', `<style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { 
            width: 100%; 
            height: 100%; 
            margin: 0 !important; 
            padding: 0 !important; 
            overflow: hidden;
        }
    </style></head>`);
    
    htmlContent += `<script>
(function(){
    var apiBase = '${req.protocol}://${req.get('host')}';
    var appId = ${id};
    
    var dbName = 'app_db_' + appId;
    var storeName = 'content_store';
    
    function openDB() {
        return new Promise(function(resolve, reject) {
            var request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(storeName)) {
                    db.createObjectStore(storeName);
                }
            };
            request.onsuccess = function(e) { resolve(e.target.result); };
            request.onerror = function(e) { reject(e.target.error); };
        });
    }
    
    function saveContent(db, content) {
        return new Promise(function(resolve, reject) {
            var transaction = db.transaction([storeName], 'readwrite');
            var store = transaction.objectStore(storeName);
            store.put(content, 'app_content');
            transaction.oncomplete = function() { resolve(); };
            transaction.onerror = function(e) { reject(e.target.error); };
        });
    }
    
    function loadContent(db) {
        return new Promise(function(resolve, reject) {
            var transaction = db.transaction([storeName], 'readonly');
            var store = transaction.objectStore(storeName);
            var request = store.get('app_content');
            request.onsuccess = function(e) { resolve(e.target.result); };
            request.onerror = function(e) { reject(e.target.error); };
        });
    }
    
    function applyContent(content) {
        if (content) {
            document.open();
            document.write(content);
            document.close();
        }
    }
    
    function sendStats() {
        fetch(apiBase + '/api/stats/' + appId, {method: 'POST'})
            .catch(function() {});
    }
    
    function checkUpdate() {
        fetch(apiBase + '/api/live-content/' + appId)
            .then(function(r) { return r.text(); })
            .then(function(content) {
                openDB().then(function(db) {
                    loadContent(db).then(function(savedContent) {
                        if (content !== savedContent) {
                            saveContent(db, content).then(function() {
                                applyContent(content);
                            });
                        }
                    });
                });
            })
            .catch(function() {
                openDB().then(function(db) {
                    loadContent(db).then(function(savedContent) {
                        applyContent(savedContent);
                    });
                });
            });
    }
    
    openDB().then(function(db) {
        loadContent(db).then(function(savedContent) {
            if (savedContent) {
                applyContent(savedContent);
            }
            if (navigator.onLine) {
                checkUpdate();
                sendStats();
            }
        });
    });
    
    window.addEventListener('online', checkUpdate);
})();
</script>`;
    
    if (appData.welcome_message) {
        htmlContent = htmlContent.replace('</body>', `<div id="welcome-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:99999;display:flex;align-items:center;justify-content:center;">
            <div style="background:#fff;border-radius:20px;padding:30px;text-align:center;max-width:280px;">
                <h3 style="margin:0;color:#333;">${appData.welcome_message}</h3>
                <button onclick="document.getElementById('welcome-overlay').remove();localStorage.setItem('welcome_shown','1');" style="margin-top:20px;padding:12px 30px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">موافق</button>
            </div>
        </div>
        <script>if(localStorage.getItem('welcome_shown')){document.getElementById('welcome-overlay')?.remove();}</script></body>`);
    }
    
    if (appData.exit_message) {
        htmlContent = htmlContent.replace('</body>', `<script>window.addEventListener('beforeunload',function(e){if(!localStorage.getItem('exit_shown')){localStorage.setItem('exit_shown','1');e.preventDefault();e.returnValue='${appData.exit_message}';return '${appData.exit_message}';}});</script></body>`);
    }
    
    fs.writeFileSync(`${appDir}/assets/index.html`, htmlContent);
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
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.VIBRATE" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    
    <application android:label="@string/app_name"${hasIcon ? ' android:icon="@drawable/ic_launcher"' : ''} android:usesCleartextTraffic="true" android:hardwareAccelerated="true">
        <activity android:name=".MainActivity" android:exported="true" android:theme="@android:style/Theme.NoTitleBar.Fullscreen" android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|density">
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
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.graphics.Color;
import android.os.Build;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        
        getWindow().requestFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.BLACK);
            window.setNavigationBarColor(Color.BLACK);
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
        
        WebView w = new WebView(this);
        WebSettings s = w.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportZoom(false);
        
        w.setWebViewClient(new WebViewClient());
        w.setBackgroundColor(Color.BLACK);
        w.setPadding(0, 0, 0, 0);
        w.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        w.loadUrl("file:///android_asset/index.html");
        setContentView(w);
    }
    
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE |
                View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_FULLSCREEN |
                View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }
}`);
    
    const resCompile = hasIcon ? '$ANDROID_HOME/build-tools/34.0.0/aapt2 compile --dir res -o compiled.zip &&' : '';
    const linkRes = hasIcon ? 'compiled.zip' : '';
    
    const buildCmd = `cd ${appDir} && ${resCompile} javac -encoding UTF-8 -source 1.8 -target 1.8 -classpath $ANDROID_HOME/platforms/android-34/android.jar -d . MainActivity.java && $ANDROID_HOME/build-tools/34.0.0/d8 --release --lib $ANDROID_HOME/platforms/android-34/android.jar --output . ${safeName.replace(/\./g,'/')}/MainActivity.class && $ANDROID_HOME/build-tools/34.0.0/aapt2 link -o unaligned.apk -I $ANDROID_HOME/platforms/android-34/android.jar --manifest AndroidManifest.xml -A assets ${linkRes} && $ANDROID_HOME/build-tools/34.0.0/aapt add unaligned.apk classes.dex && $ANDROID_HOME/build-tools/34.0.0/zipalign -f 4 unaligned.apk aligned.apk && (cp /app/debug.keystore . 2>/dev/null || keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US") && $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out final.apk aligned.apk`;
    
    exec(buildCmd, { timeout: 180000 }, (err, stdout, stderr) => {
        if (err) {
            console.error('Build error:', stderr || err.message);
            const index = apps.findIndex(a => a.id === id);
            if (index !== -1) apps[index].status = 'failed';
            saveApps();
        } else {
            const apkUrl = `/builds/${id}/final.apk`;
            const index = apps.findIndex(a => a.id === id);
            if (index !== -1) {
                apps[index].apk_url = apkUrl;
                apps[index].status = 'completed';
            }
            saveApps();
            console.log('Build done');
        }
    });
});

app.get('/api/build-status/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, status: appData.status, apk_url: appData.apk_url });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
