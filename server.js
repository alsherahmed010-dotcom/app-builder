const express = require('express');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { exec } = require('child_process');
const Jimp = require('jimp');

const app = express();
const PORT = process.env.PORT || 8080;
const FIREBASE_URL = 'https://otp-5acda-default-rtdb.firebaseio.com';

function fbReq(method, p, data = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(FIREBASE_URL + p + '.json');
        const req = https.request({
            hostname: url.hostname, path: url.pathname, method,
            headers: { 'Content-Type': 'application/json' }
        }, (res) => {
            let body = '';
            res.on('data', d => body += d);
            res.on('end', () => {
                try { resolve(body ? JSON.parse(body) : null); } catch(e) { resolve(body); }
            });
        });
        req.on('error', reject);
        if (data) req.write(JSON.stringify(data));
        req.end();
    });
}

const fb = {
    get: (p) => fbReq('GET', p),
    set: (p, d) => fbReq('PUT', p, d),
    push: (p, d) => fbReq('POST', p, d),
    update: (p, d) => fbReq('PATCH', p, d),
    delete: (p) => fbReq('DELETE', p)
};

const ADMIN_PHONES = ['01555085382'];
const uploadsDir = path.join(__dirname, 'uploads');
const buildsDir = path.join(__dirname, 'builds');
[uploadsDir, buildsDir].forEach(d => fs.mkdirSync(d, { recursive: true }));

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, Date.now() + '_' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_'))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use('/uploads', express.static(uploadsDir));
app.use('/builds', express.static(buildsDir));

function hash(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = ((h << 5) - h) + str.charCodeAt(i);
    return 'h_' + Math.abs(h).toString(36);
}
function genToken() {
    return 'tk_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 16);
}

let users = [], sessions = {}, allApps = [];

async function loadFromFirebase() {
    try {
        const [u, a, s] = await Promise.all([
            fb.get('/app_builder/users'),
            fb.get('/app_builder/apps'),
            fb.get('/app_builder/sessions')
        ]);
        if (u) users = Object.values(u);
        if (a) allApps = Object.values(a);
        if (s) sessions = s;
        console.log('✅ Loaded', users.length, 'users,', allApps.length, 'apps');
    } catch(e) { console.error('FB:', e.message); }
}

function saveUsers() {
    const obj = {}; users.forEach(u => obj[u.id] = u);
    fb.set('/app_builder/users', obj).catch(() => {});
}
function saveApps() {
    const obj = {}; allApps.forEach(a => obj[a.id] = a);
    fb.set('/app_builder/apps', obj).catch(() => {});
}
function saveSessions() { fb.set('/app_builder/sessions', sessions).catch(() => {}); }

app.get('/', (req, res) => res.json({ status: 'running', version: '10.0', users: users.length, apps: allApps.length }));

function auth(req, res, next) {
    const token = req.headers['x-auth-token'] || req.query.token;
    if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
    const user = users.find(u => u.id === sessions[token].userId);
    if (!user) return res.status(401).json({ error: 'Not found' });
    req.user = user; req.token = token; next();
}
function isAdmin(u) { return u.role === 'admin'; }

app.post('/api/register', (req, res) => {
    const { name, phone, password, device_id } = req.body;
    if (!name || !phone || !password) return res.status(400).json({ error: 'كل الحقول مطلوبة' });
    if (phone.length < 11) return res.status(400).json({ error: 'رقم غير صحيح' });
    if (password.length < 4) return res.status(400).json({ error: 'كلمة قصيرة' });
    if (users.find(u => u.phone === phone)) return res.status(400).json({ error: 'الرقم مسجل' });
    const role = ADMIN_PHONES.includes(phone) ? 'admin' : 'user';
    const newUser = {
        id: 'u_' + Date.now(), name, phone, password: hash(password), role,
        avatar: null, devices: device_id ? [device_id] : [],
        admin_color: role === 'admin' ? 'gold' : null,
        createdAt: Date.now(), lastSeen: Date.now()
    };
    users.push(newUser); saveUsers();
    const token = genToken();
    sessions[token] = { userId: newUser.id };
    saveSessions();
    res.json({ success: true, token, user: { id: newUser.id, name, phone, role, avatar: null, admin_color: newUser.admin_color } });
});

app.post('/api/login', (req, res) => {
    const { phone, password, device_id } = req.body;
    if (!phone || !password) return res.status(400).json({ error: 'حقول ناقصة' });
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(400).json({ error: 'الرقم غير مسجل' });
    if (user.password !== hash(password)) return res.status(400).json({ error: 'كلمة خطأ' });
    if (device_id) {
        if (!user.devices) user.devices = [];
        if (!user.devices.includes(device_id)) user.devices.push(device_id);
    }
    if (ADMIN_PHONES.includes(phone)) user.role = 'admin';
    user.lastSeen = Date.now(); saveUsers();
    const token = genToken();
    sessions[token] = { userId: user.id };
    saveSessions();
    res.json({ success: true, token, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, avatar: user.avatar, admin_color: user.admin_color } });
});

app.get('/api/me', auth, (req, res) => {
    const u = req.user;
    res.json({ success: true, user: { id: u.id, name: u.name, phone: u.phone, role: u.role, avatar: u.avatar, admin_color: u.admin_color } });
});

app.post('/api/logout', auth, (req, res) => {
    delete sessions[req.token]; saveSessions();
    res.json({ success: true });
});

app.put('/api/profile', auth, upload.single('avatar'), async (req, res) => {
    const user = req.user;
    if (req.body.name && req.body.name.trim().length >= 2) user.name = req.body.name.trim();
    if (req.file) {
        const p = path.join(uploadsDir, req.file.filename);
        try {
            const img = await Jimp.read(p);
            img.resize(256, 256).quality(85);
            const newPath = path.join(uploadsDir, 'avatar_' + Date.now() + '.jpg');
            await img.writeAsync(newPath);
            fs.unlinkSync(p);
            user.avatar = '/uploads/' + path.basename(newPath);
        } catch(e) {
            user.avatar = '/uploads/' + req.file.filename;
        }
    }
    if (req.body.admin_color && user.role === 'admin') user.admin_color = req.body.admin_color;
    saveUsers();
    res.json({ success: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, avatar: user.avatar, admin_color: user.admin_color } });
});

app.post('/api/forgot-password/check', (req, res) => {
    const { phone, device_id } = req.body;
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'غير مسجل' });
    const isOwner = (user.devices || []).includes(device_id);
    res.json({ success: true, verified: isOwner, message: isOwner ? 'تم التحقق' : 'جهاز مختلف' });
});

app.post('/api/forgot-password/reset', (req, res) => {
    const { phone, device_id, newPassword, verified } = req.body;
    if (!phone || !newPassword) return res.status(400).json({ error: 'حقول ناقصة' });
    if (newPassword.length < 4) return res.status(400).json({ error: 'كلمة قصيرة' });
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'غير مسجل' });
    const isOwner = (user.devices || []).includes(device_id);
    if (!isOwner && !verified) return res.status(403).json({ error: 'جهاز مختلف' });
    user.password = hash(newPassword);
    saveUsers();
    res.json({ success: true });
});

app.get('/api/apps', auth, (req, res) => {
    const filtered = isAdmin(req.user) ? allApps : allApps.filter(a => a.user_id === req.user.id);
    res.json({ success: true, apps: filtered, is_admin: isAdmin(req.user) });
});

app.post('/api/apps', auth, upload.single('icon'), async (req, res) => {
    const { name, package_name, app_type, content, welcome_message, permissions } = req.body;
    if (!name) return res.status(400).json({ error: 'اسم مطلوب' });
    
    // ✅ تحويل الأيقونة لـ PNG
    let icon_url = null;
    if (req.file) {
        const p = path.join(uploadsDir, req.file.filename);
        try {
            const img = await Jimp.read(p);
            img.resize(512, 512).quality(90);
            const newPath = path.join(uploadsDir, 'icon_' + Date.now() + '.png');
            await img.writeAsync(newPath);
            fs.unlinkSync(p);
            icon_url = '/uploads/' + path.basename(newPath);
            console.log('✅ Icon converted to PNG');
        } catch(e) {
            console.log('⚠️ Icon conversion failed:', e.message);
            icon_url = '/uploads/' + req.file.filename;
        }
    }
    
    let perms = [];
    if (permissions) { try { perms = JSON.parse(permissions); } catch(e) {} }
    
    const appData = {
        id: Date.now(), user_id: req.user.id, user_name: req.user.name,
        name, package_name: package_name || 'com.app.app',
        app_type: app_type || 'html', content: content || '',
        welcome_message: welcome_message || '',
        icon_url, permissions: perms,
        status: 'pending', apk_url: null, version: 1, createdAt: Date.now()
    };
    allApps.unshift(appData); saveApps();
    res.json({ success: true, app: appData });
});

app.get('/api/apps/:id', auth, (req, res) => {
    const a = allApps.find(x => x.id === parseInt(req.params.id));
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (isAdmin(req.user) || a.user_id === req.user.id) res.json({ success: true, app: a });
    else res.status(403).json({ error: 'Denied' });
});

app.put('/api/apps/:id', auth, upload.single('icon'), async (req, res) => {
    const id = parseInt(req.params.id);
    const i = allApps.findIndex(a => a.id === id);
    if (i === -1) return res.status(404).json({ error: 'Not found' });
    if (!isAdmin(req.user) && allApps[i].user_id !== req.user.id) return res.status(403).json({ error: 'Denied' });
    
    const { name, package_name, content, welcome_message } = req.body;
    if (name) allApps[i].name = name;
    if (package_name) allApps[i].package_name = package_name;
    if (content) allApps[i].content = content;
    if (welcome_message) allApps[i].welcome_message = welcome_message;
    
    if (req.file) {
        const p = path.join(uploadsDir, req.file.filename);
        try {
            const img = await Jimp.read(p);
            img.resize(512, 512).quality(90);
            const newPath = path.join(uploadsDir, 'icon_' + Date.now() + '.png');
            await img.writeAsync(newPath);
            fs.unlinkSync(p);
            allApps[i].icon_url = '/uploads/' + path.basename(newPath);
        } catch(e) {
            allApps[i].icon_url = '/uploads/' + req.file.filename;
        }
    }
    
    allApps[i].version++;
    saveApps();
    res.json({ success: true });
});

app.delete('/api/apps/:id', auth, (req, res) => {
    const id = parseInt(req.params.id);
    const a = allApps.find(x => x.id === id);
    if (!a) return res.status(404).json({ error: 'Not found' });
    if (!isAdmin(req.user) && a.user_id !== req.user.id) return res.status(403).json({ error: 'Denied' });
    allApps = allApps.filter(x => x.id !== id); saveApps();
    res.json({ success: true });
});

app.get('/api/live-content/:id', (req, res) => {
    const a = allApps.find(x => x.id === parseInt(req.params.id));
    if (!a) return res.status(404).send('Not found');
    let content = a.content || '<h1>App</h1>';
    if (a.app_type === 'url' && content) {
        content = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;"><iframe src="${content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    }
    if (!content.includes('<html')) {
        content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body style="margin:0;padding:0;">${content}</body></html>`;
    }
    res.send(content);
});

app.post('/api/build/:id', auth, async (req, res) => {
    const id = parseInt(req.params.id);
    const appData = allApps.find(a => a.id === id);
    if (!appData) return res.status(404).json({ error: 'Not found' });
    if (!isAdmin(req.user) && appData.user_id !== req.user.id) return res.status(403).json({ error: 'Denied' });

    res.json({ success: true, message: 'Build started' });

    const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
    const appDir = path.join(buildsDir, String(id));
    fs.mkdirSync(`${appDir}/assets`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/drawable`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/values`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/mipmap-hdpi`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/mipmap-mdpi`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/mipmap-xhdpi`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/mipmap-xxhdpi`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/mipmap-xxxhdpi`, { recursive: true });

    // ✅ HTML Content
    let htmlContent = appData.content || '<h1>App</h1>';
    if (appData.app_type === 'url' && appData.content) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body style="margin:0;padding:0;"><iframe src="${appData.content}" style="width:100vw;height:100vh;border:none;" allow="camera;microphone;geolocation;fullscreen"></iframe></body></html>`;
    }
    if (!htmlContent.includes('<html')) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body style="margin:0;padding:0;">${htmlContent}</body></html>`;
    }

    // ✅ CSS - ملء الشاشة الكاملة
    htmlContent = htmlContent.replace('</head>', `<style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { 
            width: 100vw; 
            height: 100vh; 
            margin: 0 !important; 
            padding: 0 !important; 
            overflow: hidden;
            -webkit-tap-highlight-color: rgba(0,0,0,0.1);
        }
        button, a, input, select, textarea, [onclick] {
            cursor: pointer;
            -webkit-tap-highlight-color: rgba(0,0,0,0.1);
            pointer-events: auto;
        }
    </style>
    <meta name="theme-color" content="#ffffff">
    </head>`);

    // ✅ JavaScript للتحديث اللحظي
    // ✅ كود بسيط - مش بيعمل document.write
    htmlContent += `<script>
(function() {
    // تفعيل الأزرار
    function enableButtons() {
        var els = document.querySelectorAll('button, a, [onclick], input, select, textarea');
        for (var i = 0; i < els.length; i++) {
            els[i].style.pointerEvents = 'auto';
            els[i].style.cursor = 'pointer';
        }
    }
    
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', enableButtons);
    } else {
        enableButtons();
    }
    
    // التحديث اللحظي - بس بنسبة الأيقونة بس
    setInterval(function() {
        if (!navigator.onLine) return;
        fetch('${req.protocol}://${req.get('host')}/api/check-update-icon/${id}')
            .then(function(r) { return r.json(); })
            .then(function(data) {
                if (data.updated) {
                    console.log('App updated - reload recommended');
                }
            })
            .catch(function() {});
    }, 60000);
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
    
    // ✅ strings.xml
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${appData.name}</string>
</resources>`);
    
    // ✅ styles.xml - Android 16
    // ✅ الأيقونة - تحويل من أي صيغة لـ PNG
    let hasIcon = false;
    if (appData.icon_url) {
        const iconPath = path.join(__dirname, appData.icon_url.replace(/^\//, ''));
        if (fs.existsSync(iconPath)) {
            try {
                const img = await Jimp.read(iconPath);
                // جميع الأحجام
                await img.clone().resize(192, 192).writeAsync(`${appDir}/res/mipmap-xxxhdpi/ic_launcher.png`);
                await img.clone().resize(144, 144).writeAsync(`${appDir}/res/mipmap-xxhdpi/ic_launcher.png`);
                await img.clone().resize(96, 96).writeAsync(`${appDir}/res/mipmap-xhdpi/ic_launcher.png`);
                await img.clone().resize(72, 72).writeAsync(`${appDir}/res/mipmap-hdpi/ic_launcher.png`);
                await img.clone().resize(48, 48).writeAsync(`${appDir}/res/mipmap-mdpi/ic_launcher.png`);
                await img.clone().resize(192, 192).writeAsync(`${appDir}/res/drawable/ic_launcher.png`);
                hasIcon = true;
                console.log('✅ Icons generated (all sizes)');
            } catch(e) {
                console.log('⚠️ Icon gen failed:', e.message);
            }
        } else {
            console.log('⚠️ Icon file not found:', iconPath);
        }
    } else {
        console.log('⚠️ No icon uploaded');
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
        android:hardwareAccelerated="true">
        <activity 
            android:name=".MainActivity" 
            android:exported="true"
            android:theme="@android:style/Theme.NoTitleBar.Fullscreen"
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|density">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`);

    // ✅ MainActivity محسّن لـ Android 16
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
        s.setAllowContentAccess(true);
        s.setAllowFileAccessFromFileURLs(true);
        s.setAllowUniversalAccessFromFileURLs(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        final String serverUrl = "${req.protocol}://${req.get('host')}/api/live-content/${id}";
        final String localUrl = "file:///android_asset/index.html";
        
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    view.loadUrl(localUrl);
                }
            }
            
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse errorResponse) {
                if (request.isForMainFrame()) {
                    view.loadUrl(localUrl);
                }
            }
        });
        
        webView.loadUrl(serverUrl);
        setContentView(w);
    }
    @Override
    public void onBackPressed() {
        super.onBackPressed();
    }
}`);

    // ✅ دايمًا نعمل compile للـ resources
    const buildCmd = `cd ${appDir} && $ANDROID_HOME/build-tools/34.0.0/aapt2 compile --dir res -o compiled.zip && javac -encoding UTF-8 -source 1.8 -target 1.8 -classpath $ANDROID_HOME/platforms/android-34/android.jar -d . MainActivity.java && $ANDROID_HOME/build-tools/34.0.0/d8 --release --lib $ANDROID_HOME/platforms/android-34/android.jar --output . ${safeName.replace(/\./g,'/')}/MainActivity.class && $ANDROID_HOME/build-tools/34.0.0/aapt2 link -o unaligned.apk -I $ANDROID_HOME/platforms/android-34/android.jar --manifest AndroidManifest.xml -A assets compiled.zip && $ANDROID_HOME/build-tools/34.0.0/aapt add unaligned.apk classes.dex && $ANDROID_HOME/build-tools/34.0.0/zipalign -f 4 unaligned.apk aligned.apk && (cp /app/debug.keystore . 2>/dev/null || keytool -genkey -v -keystore debug.keystore -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US") && $ANDROID_HOME/build-tools/34.0.0/apksigner sign --ks debug.keystore --ks-pass pass:android --key-pass pass:android --out final.apk aligned.apk`;

    exec(buildCmd, { timeout: 180000 }, (err, stdout, stderr) => {
        const idx = allApps.findIndex(a => a.id === id);
        if (err) {
            console.error('Build error:', stderr || err.message);
            if (idx !== -1) allApps[idx].status = 'failed';
        } else {
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
    const a = allApps.find(x => x.id === parseInt(req.params.id));
    if (!a) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, status: a.status, apk_url: a.apk_url });
});

app.get('/api/users', auth, (req, res) => {
    if (!isAdmin(req.user)) return res.status(403).json({ error: 'Admin only' });
    res.json({
        success: true,
        users: users.map(u => ({
            id: u.id, name: u.name, phone: u.phone, role: u.role,
            avatar: u.avatar, admin_color: u.admin_color,
            apps_count: allApps.filter(a => a.user_id === u.id).length
        }))
    });
});

loadFromFirebase().then(() => {
    app.listen(PORT, () => {
        console.log('═══════════════════════════════════');
        console.log('🚀 APP BUILDER v10.0 FINAL');
        console.log('═══════════════════════════════════');
        console.log('👥 Users:', users.length, '| 📱 Apps:', allApps.length);
        console.log('✅ Jimp: icon conversion enabled');
        console.log('✅ aapt2: always compiles res');
        console.log('✅ Android 16: fullscreen ready');
        console.log('═══════════════════════════════════');
    });
});
