const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================
// 🔥 FIREBASE CONFIG
// ============================================
const FIREBASE_URL = 'https://otp-5acda-default-rtdb.firebaseio.com';

function fbRequest(method, p, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(FIREBASE_URL + p + '.json');
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method,
            headers: { 'Content-Type': 'application/json' }
        };
        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve(body ? JSON.parse(body) : null); }
                catch(e) { resolve(body); }
            });
        });
        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

const fb = {
    get: (p) => fbRequest('GET', p),
    set: (p, d) => fbRequest('PUT', p, d),
    push: (p, d) => fbRequest('POST', p, d),
    update: (p, d) => fbRequest('PATCH', p, d),
    delete: (p) => fbRequest('DELETE', p)
};

// ============================================
// 🔑 ADMIN CONFIG
// ============================================
const ADMIN_PHONES = ['01555085382'];

// ============================================
// 📁 FOLDERS
// ============================================
const uploadsDir = path.join(__dirname, 'uploads');
const buildsDir = path.join(__dirname, 'builds');
[uploadsDir, buildsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

// ============================================
// 📦 MULTER
// ============================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ============================================
// 🛠️ MIDDLEWARE
// ============================================
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static('public'));
app.use('/uploads', express.static(uploadsDir));
app.use('/builds', express.static(buildsDir));

// ============================================
// 💾 HELPERS
// ============================================
function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = ((h << 5) - h) + str.charCodeAt(i);
        h = h & h;
    }
    return 'h_' + Math.abs(h).toString(36);
}

function genToken() {
    return 'tk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 16);
}

// In-memory cache
let users = [];
let sessions = {};
let allApps = [];

async function loadFromFirebase() {
    console.log('🔥 Loading from Firebase...');
    try {
        const [fbUsers, fbApps, fbSessions] = await Promise.all([
            fb.get('/app_builder/users'),
            fb.get('/app_builder/apps'),
            fb.get('/app_builder/sessions')
        ]);
        
        if (fbUsers) {
            users = Object.values(fbUsers);
            console.log('✅ Loaded', users.length, 'users from Firebase');
        } else {
            users = [];
            console.log('📝 No users yet');
        }
        
        if (fbApps) {
            allApps = Object.values(fbApps);
            console.log('✅ Loaded', allApps.length, 'apps from Firebase');
        } else {
            allApps = [];
        }
        
        if (fbSessions) {
            sessions = fbSessions;
            console.log('✅ Loaded', Object.keys(sessions).length, 'sessions');
        }
    } catch(e) {
        console.error('❌ Firebase load error:', e.message);
    }
}

function saveUsers() {
    const obj = {};
    users.forEach(u => { obj[u.id] = u; });
    fb.set('/app_builder/users', obj).catch(e => console.error('FB save users:', e.message));
}

function saveApps() {
    const obj = {};
    allApps.forEach(a => { obj[a.id] = a; });
    fb.set('/app_builder/apps', obj).catch(e => console.error('FB save apps:', e.message));
}

function saveSessions() {
    fb.set('/app_builder/sessions', sessions).catch(e => console.error('FB save sessions:', e.message));
}

// ============================================
// 🏠 HOME
// ============================================
app.get('/', (req, res) => {
    res.json({ 
        status: 'running', 
        service: 'App Builder Pro', 
        version: '5.0',
        users: users.length,
        apps: allApps.length,
        storage: 'Firebase'
    });
});

// ============================================
// 🎫 AUTH MIDDLEWARE
// ============================================
function auth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
    const user = users.find(u => u.id === sessions[token].userId);
    if (!user) {
        delete sessions[token];
        saveSessions();
        return res.status(401).json({ error: 'User not found' });
    }
    req.user = user;
    req.token = token;
    next();
}

function isAdmin(user) {
    return user.role === 'admin';
}

// ============================================
// 📝 REGISTER
// ============================================
app.post('/api/register', async (req, res) => {
    const { name, phone, password, device_id } = req.body;
    
    if (!name || !phone || !password) {
        return res.status(400).json({ error: 'كل الحقول مطلوبة' });
    }
    
    if (name.length < 2) {
        return res.status(400).json({ error: 'الاسم قصير جداً' });
    }
    
    if (phone.length < 11 || !/^\d+$/.test(phone)) {
        return res.status(400).json({ error: 'رقم الهاتف غير صحيح' });
    }
    
    if (password.length < 4) {
        return res.status(400).json({ error: 'كلمة السر 4 أحرف على الأقل' });
    }
    
    if (users.find(u => u.phone === phone)) {
        return res.status(400).json({ error: 'رقم الهاتف مسجل بالفعل' });
    }
    
    const role = ADMIN_PHONES.includes(phone) ? 'admin' : 'user';
    
    const newUser = {
        id: 'u_' + Date.now(),
        name,
        phone,
        password: hash(password),
        role: role,
        avatar: null,
        about: 'متاح',
        devices: device_id ? [device_id] : [],
        device_id: device_id || null,
        admin_color: role === 'admin' ? 'gold' : null,
        createdAt: Date.now(),
        lastSeen: Date.now()
    };
    
    users.push(newUser);
    saveUsers();
    
    const token = genToken();
    sessions[token] = { userId: newUser.id, createdAt: Date.now() };
    saveSessions();
    
    console.log('✅ Registered:', name, phone, '| Role:', role);
    
    res.json({
        success: true,
        token,
        user: {
            id: newUser.id,
            name: newUser.name,
            phone: newUser.phone,
            role: newUser.role,
            avatar: newUser.avatar,
            about: newUser.about,
            admin_color: newUser.admin_color
        }
    });
});

// ============================================
// 🔐 LOGIN
// ============================================
app.post('/api/login', async (req, res) => {
    const { phone, password, device_id } = req.body;
    
    if (!phone || !password) {
        return res.status(400).json({ error: 'كل الحقول مطلوبة' });
    }
    
    const user = users.find(u => u.phone === phone);
    if (!user) {
        return res.status(400).json({ error: 'رقم الهاتف غير مسجل' });
    }
    
    if (user.password !== hash(password)) {
        return res.status(400).json({ error: 'كلمة السر غير صحيحة' });
    }
    
    if (device_id) {
        user.device_id = device_id;
        if (!user.devices) user.devices = [];
        if (!user.devices.includes(device_id)) {
            user.devices.push(device_id);
        }
    }
    
    if (ADMIN_PHONES.includes(phone)) {
        user.role = 'admin';
    }
    
    user.lastSeen = Date.now();
    saveUsers();
    
    const token = genToken();
    sessions[token] = { userId: user.id, createdAt: Date.now() };
    saveSessions();
    
    console.log('🔐 Login:', user.name);
    
    res.json({
        success: true,
        token,
        user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            role: user.role,
            avatar: user.avatar,
            about: user.about,
            admin_color: user.admin_color
        }
    });
});

// ============================================
// 👤 ME
// ============================================
app.get('/api/me', auth, (req, res) => {
    res.json({
        success: true,
        user: {
            id: req.user.id,
            name: req.user.name,
            phone: req.user.phone,
            role: req.user.role,
            avatar: req.user.avatar,
            about: req.user.about,
            admin_color: req.user.admin_color
        }
    });
});

// ============================================
// 🚪 LOGOUT
// ============================================
app.post('/api/logout', auth, (req, res) => {
    delete sessions[req.token];
    saveSessions();
    res.json({ success: true });
});

// ============================================
// 👤 UPDATE PROFILE
// ============================================
app.put('/api/profile', auth, upload.single('avatar'), (req, res) => {
    const user = req.user;
    
    if (req.body.name && req.body.name.trim().length >= 2) {
        user.name = req.body.name.trim();
    }
    
    if (req.file) {
        user.avatar = `/uploads/${req.file.filename}`;
    }
    
    if (req.body.admin_color && user.role === 'admin') {
        user.admin_color = req.body.admin_color;
    }
    
    user.updatedAt = Date.now();
    saveUsers();
    
    res.json({
        success: true,
        user: {
            id: user.id,
            name: user.name,
            phone: user.phone,
            role: user.role,
            avatar: user.avatar,
            about: user.about,
            admin_color: user.admin_color
        }
    });
});

// ============================================
// 🔑 FORGOT PASSWORD
// ============================================
app.post('/api/forgot-password/check', async (req, res) => {
    const { phone, device_id } = req.body;
    
    if (!phone) return res.status(400).json({ error: 'رقم مطلوب' });
    
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'الرقم غير مسجل' });
    
    const devices = user.devices || [];
    const isOwner = devices.includes(device_id) || user.device_id === device_id;
    
    if (isOwner) {
        return res.json({ 
            success: true, 
            verified: true, 
            message: 'تم التحقق من جهازك'
        });
    }
    
    return res.json({ 
        success: true, 
        verified: false, 
        message: 'جهاز مختلف - غير مسموح'
    });
});

app.post('/api/forgot-password/reset', async (req, res) => {
    const { phone, device_id, newPassword, verified } = req.body;
    
    if (!phone || !device_id || !newPassword) {
        return res.status(400).json({ error: 'كل الحقول مطلوبة' });
    }
    
    if (newPassword.length < 4) {
        return res.status(400).json({ error: 'كلمة السر 4 أحرف' });
    }
    
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'غير مسجل' });
    
    const devices = user.devices || [];
    const isOwner = devices.includes(device_id) || user.device_id === device_id;
    
    if (!isOwner && !verified) {
        return res.status(403).json({ error: 'جهاز مختلف' });
    }
    
    user.password = hash(newPassword);
    user.passwordChangedAt = Date.now();
    
    if (!user.devices) user.devices = [];
    if (!user.devices.includes(device_id)) {
        user.devices.push(device_id);
    }
    
    saveUsers();
    console.log('🔑 Password reset:', user.name);
    
    res.json({ success: true, message: 'تم تغيير كلمة السر' });
});

// ============================================
// 📱 APPS
// ============================================
app.get('/api/apps', auth, (req, res) => {
    const admin = isAdmin(req.user);
    let filteredApps;
    
    if (admin) {
        filteredApps = allApps;
    } else {
        filteredApps = allApps.filter(a => a.user_id === req.user.id);
    }
    
    res.json({
        success: true,
        apps: filteredApps,
        is_admin: admin,
        total: filteredApps.length
    });
});

app.post('/api/apps', auth, upload.single('icon'), (req, res) => {
    const { name, package_name, app_type, content, welcome_message, permissions } = req.body;
    
    if (!name) return res.status(400).json({ error: 'اسم مطلوب' });
    
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    let perms = [];
    if (permissions) {
        try { perms = JSON.parse(permissions); } catch(e) {}
    }
    
    const appData = {
        id: Date.now(),
        user_id: req.user.id,
        user_name: req.user.name,
        name,
        package_name: package_name || 'com.app.app',
        app_type: app_type || 'html',
        content: content || '',
        welcome_message: welcome_message || '',
        icon_url,
        permissions: perms,
        status: 'pending',
        apk_url: null,
        version: 1,
        createdAt: Date.now()
    };
    
    allApps.unshift(appData);
    saveApps();
    
    console.log('✅ App:', name, '| By:', req.user.name);
    res.json({ success: true, app: appData });
});

app.get('/api/apps/:id', auth, (req, res) => {
    const appData = allApps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    
    if (isAdmin(req.user) || appData.user_id === req.user.id) {
        res.json({ success: true, app: appData });
    } else {
        res.status(403).json({ error: 'Access denied' });
    }
});

app.put('/api/apps/:id', auth, upload.single('icon'), (req, res) => {
    const id = parseInt(req.params.id);
    const index = allApps.findIndex(a => a.id === id);
    
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    
    if (!isAdmin(req.user) && allApps[index].user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    const { name, package_name, content, welcome_message } = req.body;
    if (name) allApps[index].name = name;
    if (package_name) allApps[index].package_name = package_name;
    if (content) allApps[index].content = content;
    if (welcome_message) allApps[index].welcome_message = welcome_message;
    if (req.file) allApps[index].icon_url = `/uploads/${req.file.filename}`;
    
    allApps[index].version++;
    allApps[index].updatedAt = Date.now();
    saveApps();
    
    res.json({ success: true });
});

app.delete('/api/apps/:id', auth, (req, res) => {
    const id = parseInt(req.params.id);
    const appData = allApps.find(a => a.id === id);
    
    if (!appData) return res.status(404).json({ error: 'Not found' });
    
    if (!isAdmin(req.user) && appData.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    allApps = allApps.filter(a => a.id !== id);
    saveApps();
    res.json({ success: true });
});

// ============================================
// 📄 LIVE CONTENT
// ============================================
app.get('/api/live-content/:id', (req, res) => {
    const appData = allApps.find(a => a.id === parseInt(req.params.id));
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

// ============================================
// 🔨 BUILD APK
// ============================================
app.post('/api/build/:id', auth, (req, res) => {
    const id = parseInt(req.params.id);
    const appData = allApps.find(a => a.id === id);
    
    if (!appData) return res.status(404).json({ error: 'Not found' });
    
    if (!isAdmin(req.user) && appData.user_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied' });
    }
    
    res.json({ success: true, message: 'Build started' });
    
    const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
    const appDir = path.join(buildsDir, String(id));
    
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
    var dbName = 'app_db_' + appId;
    
    function openDB() {
        return new Promise(function(resolve, reject) {
            var req = indexedDB.open(dbName, 1);
            req.onupgradeneeded = function(e) {
                var db = e.target.result;
                if (!db.objectStoreNames.contains('content')) db.createObjectStore('content');
            };
            req.onsuccess = function(e) { resolve(e.target.result); };
            req.onerror = function(e) { reject(e.target.error); };
        });
    }
    
    function saveContent(db, content) {
        return new Promise(function(resolve) {
            var tx = db.transaction(['content'], 'readwrite');
            tx.objectStore('content').put(content, 'app_content');
            tx.oncomplete = resolve;
        });
    }
    
    function loadContent(db) {
        return new Promise(function(resolve) {
            var req = db.transaction(['content'], 'readonly').objectStore('content').get('app_content');
            req.onsuccess = function(e) { resolve(e.target.result); };
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
})();
</script>`;
    
    if (appData.welcome_message) {
        htmlContent = htmlContent.replace('</body>', `<div id="wc" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
            <div style="background:#fff;border-radius:16px;padding:25px;text-align:center;max-width:300px;">
                <h3 style="margin:0 0 15px;color:#222;font-family:sans-serif;">${appData.welcome_message}</h3>
                <button onclick="document.getElementById('wc').remove();localStorage.setItem('welcome_shown','1');" style="padding:12px 30px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">موافق</button>
            </div>
        </div>
        <script>if(localStorage.getItem('welcome_shown')){document.getElementById('wc')?.remove();}</script></body>`);
    }
    
    fs.writeFileSync(`${appDir}/assets/index.html`, htmlContent);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appData.name}</string></resources>`);
    
    // Icon handling - no jimp, just copy if PNG
    let hasIcon = false;
    if (appData.icon_url) {
        const p = path.join(__dirname, appData.icon_url.replace(/^\//, ''));
        if (fs.existsSync(p)) {
            try {
                const buf = fs.readFileSync(p);
                if (buf[0] === 0x89 && buf[1] === 0x50) {
                    fs.copyFileSync(p, `${appDir}/res/drawable/ic_launcher.png`);
                    hasIcon = true;
                } else {
                    // غير PNG - تجاهل
                    console.log('⚠️ Icon not PNG, skipping');
                }
            } catch(e) { console.error('Icon error:', e.message); }
        }
    }
    
    const PERMISSIONS_MAP = {
        'INTERNET': 'android.permission.INTERNET',
        'ACCESS_NETWORK_STATE': 'android.permission.ACCESS_NETWORK_STATE',
        'POST_NOTIFICATIONS': 'android.permission.POST_NOTIFICATIONS',
        'CAMERA': 'android.permission.CAMERA',
        'RECORD_AUDIO': 'android.permission.RECORD_AUDIO',
        'READ_MEDIA_IMAGES': 'android.permission.READ_MEDIA_IMAGES',
        'READ_MEDIA_VIDEO': 'android.permission.READ_MEDIA_VIDEO',
        'READ_MEDIA_AUDIO': 'android.permission.READ_MEDIA_AUDIO',
        'READ_EXTERNAL_STORAGE': 'android.permission.READ_EXTERNAL_STORAGE',
        'WRITE_EXTERNAL_STORAGE': 'android.permission.WRITE_EXTERNAL_STORAGE',
        'ACCESS_FINE_LOCATION': 'android.permission.ACCESS_FINE_LOCATION',
        'ACCESS_COARSE_LOCATION': 'android.permission.ACCESS_COARSE_LOCATION',
        'READ_CONTACTS': 'android.permission.READ_CONTACTS',
        'VIBRATE': 'android.permission.VIBRATE',
        'WAKE_LOCK': 'android.permission.WAKE_LOCK'
    };
    
    const perms = appData.permissions || ['INTERNET', 'ACCESS_NETWORK_STATE'];
    const permLines = perms.map(p => {
        const perm = PERMISSIONS_MAP[p];
        return perm ? `    <uses-permission android:name="${perm}" />` : '';
    }).filter(Boolean).join('\n');
    
    fs.writeFileSync(`${appDir}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${safeName}">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
${permLines}
    <application 
        android:label="@string/app_name"${hasIcon ? ' android:icon="@drawable/ic_launcher"' : ''}
        android:usesCleartextTraffic="true"
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
        <activity 
            android:name=".MainActivity" 
            android:exported="true"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|density">
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
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.webkit.WebChromeClient;
import android.graphics.Color;
import android.os.Build;

public class MainActivity extends Activity {
    private WebView webView;
    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        getWindow().requestFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            window.getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.loadUrl("file:///android_asset/index.html");
        setContentView(webView);
    }
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN |
                View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION |
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
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
            const idx = allApps.findIndex(a => a.id === id);
            if (idx !== -1) allApps[idx].status = 'failed';
        } else {
            const idx = allApps.findIndex(a => a.id === id);
            if (idx !== -1) {
                allApps[idx].apk_url = `/builds/${id}/final.apk`;
                allApps[idx].status = 'completed';
            }
            console.log('✅ Built:', appData.name);
        }
        saveApps();
    });
});

app.get('/api/build-status/:id', auth, (req, res) => {
    const appData = allApps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, status: appData.status, apk_url: appData.apk_url });
});

// ============================================
// 👑 USERS (Admin)
// ============================================
app.get('/api/users', auth, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
    
    res.json({
        success: true,
        users: users.map(u => ({
            id: u.id,
            name: u.name,
            phone: u.phone,
            role: u.role,
            avatar: u.avatar,
            admin_color: u.admin_color,
            createdAt: u.createdAt,
            lastSeen: u.lastSeen,
            apps_count: allApps.filter(a => a.user_id === u.id).length
        }))
    });
});

// ============================================
// 🚀 START
// ============================================
loadFromFirebase().then(() => {
    app.listen(PORT, () => {
        console.log('═══════════════════════════════════');
        console.log('🚀 APP BUILDER PRO v5.0');
        console.log('═══════════════════════════════════');
        console.log('🌐 Port: ' + PORT);
        console.log('🔥 Storage: Firebase');
        console.log('👥 Users: ' + users.length);
        console.log('📱 Apps: ' + allApps.length);
        console.log('═══════════════════════════════════');
    });
});
