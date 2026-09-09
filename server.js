const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const uploadDir = path.join(__dirname, 'uploads');
const musicDir = path.join(__dirname, 'music');
const videoDir = path.join(__dirname, 'videos');
const imagesDir = path.join(__dirname, 'images');

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(musicDir, { recursive: true });
fs.mkdirSync(videoDir, { recursive: true });
fs.mkdirSync(imagesDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        if (file.fieldname === 'music') cb(null, musicDir);
        else if (file.fieldname === 'video') cb(null, videoDir);
        else if (file.fieldname === 'image') cb(null, imagesDir);
        else cb(null, uploadDir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));
app.use(express.static('public'));
app.use('/builds', express.static('builds'));
app.use('/uploads', express.static('uploads'));
app.use('/music', express.static('music'));
app.use('/videos', express.static('videos'));
app.use('/images', express.static('images'));

let apps = [];
if (fs.existsSync('apps.json')) {
    apps = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
}

let pages = {};
if (fs.existsSync('pages.json')) {
    pages = JSON.parse(fs.readFileSync('pages.json', 'utf8'));
}

let mediaContent = {};
if (fs.existsSync('media.json')) {
    mediaContent = JSON.parse(fs.readFileSync('media.json', 'utf8'));
}

let notifications = [];
if (fs.existsSync('notifications.json')) {
    notifications = JSON.parse(fs.readFileSync('notifications.json', 'utf8'));
}

let users = {};
if (fs.existsSync('users.json')) {
    users = JSON.parse(fs.readFileSync('users.json', 'utf8'));
}

function saveApps() { fs.writeFileSync('apps.json', JSON.stringify(apps, null, 2)); }
function savePages() { fs.writeFileSync('pages.json', JSON.stringify(pages, null, 2)); }
function saveMedia() { fs.writeFileSync('media.json', JSON.stringify(mediaContent, null, 2)); }
function saveNotifications() { fs.writeFileSync('notifications.json', JSON.stringify(notifications, null, 2)); }
function saveUsers() { fs.writeFileSync('users.json', JSON.stringify(users, null, 2)); }

// تسجيل مستخدم
app.post('/api/register-device', (req, res) => {
    const { app_id, token, device_id } = req.body;
    console.log('Registering:', { app_id, device_id: device_id?.substring(0, 20) });
    
    if (!app_id || !token) return res.status(400).json({ error: 'Missing data' });
    
    const appId = String(app_id);
    if (!users[appId]) users[appId] = {};
    
    const uniqueId = device_id || token;
    
    if (!users[appId][uniqueId]) {
        users[appId][uniqueId] = {
            token, device_id, first_seen: Date.now(), last_seen: Date.now(), open_count: 1
        };
        console.log('✅ New user! Total:', Object.keys(users[appId]).length);
    } else {
        users[appId][uniqueId].last_seen = Date.now();
        users[appId][uniqueId].open_count++;
    }
    
    saveUsers();
    res.json({ success: true, total_users: Object.keys(users[appId]).length });
});

// إشعارات داخل التطبيق
app.post('/api/notifications', (req, res) => {
    const { app_id, title, message } = req.body;
    const notification = { id: Date.now(), app_id: String(app_id), title, message, created_at: Date.now() };
    notifications.unshift(notification);
    saveNotifications();
    res.json({ success: true, notification });
});

app.get('/api/notifications/:app_id', (req, res) => {
    const appNotifications = notifications.filter(n => n.app_id === String(req.params.app_id));
    res.json({ success: true, notifications: appNotifications });
});

// المستخدمين
app.get('/api/users/:app_id', (req, res) => {
    const appId = String(req.params.app_id);
    const appUsers = users[appId] || {};
    res.json({ success: true, total_users: Object.keys(appUsers).length });
});

// الصفحات المخصصة
app.post('/api/pages', (req, res) => {
    const { app_id, page_name, password, background_url, music_url, music_loop } = req.body;
    const pageId = Date.now();
    
    if (!pages[app_id]) pages[app_id] = [];
    
    pages[app_id].push({
        id: pageId,
        name: page_name,
        password: password || null,
        background_url: background_url || null,
        music_url: music_url || null,
        music_loop: music_loop || false,
        created_at: Date.now()
    });
    
    savePages();
    res.json({ success: true, page: pages[app_id][pages[app_id].length - 1] });
});

app.get('/api/pages/:app_id', (req, res) => {
    const appId = String(req.params.app_id);
    res.json({ success: true, pages: pages[appId] || [] });
});

app.delete('/api/pages/:app_id/:page_id', (req, res) => {
    const appId = String(req.params.app_id);
    const pageId = parseInt(req.params.page_id);
    if (pages[appId]) {
        pages[appId] = pages[appId].filter(p => p.id !== pageId);
        savePages();
    }
    res.json({ success: true });
});

// رفع موسيقى
app.post('/api/upload-music', upload.single('music'), (req, res) => {
    const { app_id, music_name, icon_url } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    if (!mediaContent[app_id]) mediaContent[app_id] = { music: [], videos: [], images: [] };
    if (!mediaContent[app_id].music) mediaContent[app_id].music = [];
    
    mediaContent[app_id].music.push({
        id: Date.now(),
        name: music_name || req.file.originalname,
        url: '/music/' + req.file.filename,
        icon_url: icon_url || null,
        created_at: Date.now()
    });
    
    saveMedia();
    res.json({ success: true, music: mediaContent[app_id].music });
});

// رفع فيديو
app.post('/api/upload-video', upload.single('video'), (req, res) => {
    const { app_id, video_name } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    if (!mediaContent[app_id]) mediaContent[app_id] = { music: [], videos: [], images: [] };
    if (!mediaContent[app_id].videos) mediaContent[app_id].videos = [];
    
    mediaContent[app_id].videos.push({
        id: Date.now(),
        name: video_name || req.file.originalname,
        url: '/videos/' + req.file.filename,
        created_at: Date.now()
    });
    
    saveMedia();
    res.json({ success: true, videos: mediaContent[app_id].videos });
});

// رفع صورة
app.post('/api/upload-image', upload.single('image'), (req, res) => {
    const { app_id, image_name } = req.body;
    if (!req.file) return res.status(400).json({ error: 'No file' });
    
    if (!mediaContent[app_id]) mediaContent[app_id] = { music: [], videos: [], images: [] };
    if (!mediaContent[app_id].images) mediaContent[app_id].images = [];
    
    mediaContent[app_id].images.push({
        id: Date.now(),
        name: image_name || req.file.originalname,
        url: '/images/' + req.file.filename,
        created_at: Date.now()
    });
    
    saveMedia();
    res.json({ success: true, images: mediaContent[app_id].images });
});

// جلب المحتوى
app.get('/api/media/:app_id', (req, res) => {
    const appId = String(req.params.app_id);
    res.json({ success: true, media: mediaContent[appId] || { music: [], videos: [], images: [] } });
});

app.get('/', (req, res) => res.json({ status: 'running' }));

app.post('/api/apps', upload.single('icon'), (req, res) => {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const appData = {
        id: Date.now(),
        name,
        package_name,
        app_type: app_type || 'webview',
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
    
    const { name, package_name, content, welcome_message, exit_message } = req.body;
    if (name) apps[index].name = name;
    if (package_name) apps[index].package_name = package_name;
    if (content) apps[index].content = content;
    if (welcome_message) apps[index].welcome_message = welcome_message;
    if (exit_message) apps[index].exit_message = exit_message;
    if (req.file) apps[index].icon_url = `/uploads/${req.file.filename}`;
    
    apps[index].version = (apps[index].version || 1) + 1;
    saveApps();
    res.json({ success: true, message: 'Update saved' });
});

app.delete('/api/apps/:id', (req, res) => {
    apps = apps.filter(a => a.id !== parseInt(req.params.id));
    saveApps();
    res.json({ success: true });
});

// المحتوى المباشر
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
    
    res.send(content);
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
        html, body { width: 100%; height: 100%; margin: 0 !important; padding: 0 !important; overflow: hidden; }
    </style></head>`);
    
    htmlContent += `<script>
(function(){
    var apiBase = '${req.protocol}://${req.get('host')}';
    var appId = ${id};
    
    function getDeviceId() {
        try {
            var deviceId = localStorage.getItem('device_id');
            if (!deviceId) {
                deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('device_id', deviceId);
            }
            return deviceId;
        } catch(e) { return 'device_' + Date.now(); }
    }
    
    function registerUser() {
        try {
            fetch(apiBase + '/api/register-device', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ app_id: appId, token: getDeviceId(), device_id: getDeviceId() })
            }).then(r => r.json()).then(data => console.log('Registered:', data.total_users));
        } catch(e) {}
    }
    
    registerUser();
    
    var dbName = 'app_db_' + appId;
    var storeName = 'content_store';
    
    function openDB() {
        return new Promise(function(resolve, reject) {
            var request = indexedDB.open(dbName, 1);
            request.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
            };
            request.onsuccess = function(e) { resolve(e.target.result); };
            request.onerror = function(e) { reject(e.target.error); };
        });
    }
    
    function saveContent(db, content) {
        return new Promise(function(resolve, reject) {
            var transaction = db.transaction([storeName], 'readwrite');
            transaction.objectStore(storeName).put(content, 'app_content');
            transaction.oncomplete = resolve;
            transaction.onerror = reject;
        });
    }
    
    function loadContent(db) {
        return new Promise(function(resolve, reject) {
            var request = db.transaction([storeName], 'readonly').objectStore(storeName).get('app_content');
            request.onsuccess = function(e) { resolve(e.target.result); };
            request.onerror = reject;
        });
    }
    
    function applyContent(content) {
        if (content) { document.open(); document.write(content); document.close(); }
    }
    
    function checkUpdate() {
        fetch(apiBase + '/api/live-content/' + appId)
            .then(r => r.text())
            .then(content => {
                openDB().then(db => {
                    loadContent(db).then(saved => {
                        if (content !== saved) {
                            saveContent(db, content).then(() => applyContent(content));
                        }
                    });
                });
            })
            .catch(() => {
                openDB().then(db => loadContent(db).then(saved => applyContent(saved)));
            });
    }
    
    openDB().then(db => {
        loadContent(db).then(saved => {
            if (saved) applyContent(saved);
            if (navigator.onLine) checkUpdate();
        });
    });
    
    window.addEventListener('online', function() { registerUser(); checkUpdate(); });
})();
</script>`;
    
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
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
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
        w.setWebViewClient(new WebViewClient());
        w.setBackgroundColor(Color.BLACK);
        w.loadUrl("file:///android_asset/index.html");
        setContentView(w);
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
            const index = apps.findIndex(a => a.id === id);
            if (index !== -1) {
                apps[index].apk_url = `/builds/${id}/final.apk`;
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
