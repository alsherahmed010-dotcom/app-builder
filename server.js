const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

let apps = [];
if (fs.existsSync('apps.json')) {
    apps = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
}

function saveApps() { fs.writeFileSync('apps.json', JSON.stringify(apps, null, 2)); }

// أذونات آمنة بس
const PERMISSIONS_MAP = {
    'INTERNET': 'android.permission.INTERNET',
    'ACCESS_NETWORK_STATE': 'android.permission.ACCESS_NETWORK_STATE',
    'POST_NOTIFICATIONS': 'android.permission.POST_NOTIFICATIONS',
    'CAMERA': 'android.permission.CAMERA',
    'RECORD_AUDIO': 'android.permission.RECORD_AUDIO',
    'READ_EXTERNAL_STORAGE': 'android.permission.READ_EXTERNAL_STORAGE',
    'WRITE_EXTERNAL_STORAGE': 'android.permission.WRITE_EXTERNAL_STORAGE',
    'ACCESS_FINE_LOCATION': 'android.permission.ACCESS_FINE_LOCATION',
    'ACCESS_COARSE_LOCATION': 'android.permission.ACCESS_COARSE_LOCATION',
    'VIBRATE': 'android.permission.VIBRATE',
    'WAKE_LOCK': 'android.permission.WAKE_LOCK'
};

app.get('/', (req, res) => res.json({ status: 'running' }));

app.post('/api/apps', upload.single('icon'), (req, res) => {
    const { name, package_name, app_type, content, welcome_message, exit_message, permissions } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    let selectedPermissions = [];
    if (permissions) {
        try { selectedPermissions = JSON.parse(permissions); } catch(e) {}
    }
    
    const mandatory = ['INTERNET', 'ACCESS_NETWORK_STATE'];
    const finalPermissions = [...new Set([...mandatory, ...selectedPermissions])];
    
    const appData = {
        id: Date.now(),
        name,
        package_name,
        app_type: app_type || 'html',
        content,
        welcome_message,
        exit_message,
        icon_url,
        permissions: finalPermissions,
        status: 'pending',
        apk_url: null,
        version: 1,
        createdAt: Date.now()
    };
    
    apps.unshift(appData);
    saveApps();
    res.json({ success: true, app: appData });
});

app.get('/api/apps', (req, res) => res.json({ success: true, apps }));

app.get('/api/apps/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true, app: appData });
});

app.put('/api/apps/:id', upload.single('icon'), (req, res) => {
    const id = parseInt(req.params.id);
    const index = apps.findIndex(a => a.id === id);
    if (index === -1) return res.status(404).json({ error: 'Not found' });
    
    const { name, package_name, content, welcome_message, exit_message, permissions } = req.body;
    if (name) apps[index].name = name;
    if (package_name) apps[index].package_name = package_name;
    if (content) apps[index].content = content;
    if (welcome_message) apps[index].welcome_message = welcome_message;
    if (exit_message) apps[index].exit_message = exit_message;
    if (req.file) apps[index].icon_url = `/uploads/${req.file.filename}`;
    if (permissions) {
        try {
            const selected = JSON.parse(permissions);
            const mandatory = ['INTERNET', 'ACCESS_NETWORK_STATE'];
            apps[index].permissions = [...new Set([...mandatory, ...selected])];
        } catch(e) {}
    }
    
    apps[index].version = (apps[index].version || 1) + 1;
    saveApps();
    res.json({ success: true, message: 'Update saved' });
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
    
    // تجهيز HTML
    let htmlContent = appData.content || '<h1>App</h1>';
    if (appData.app_type === 'url' && appData.content) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;"><iframe src="${appData.content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    }
    if (!htmlContent.includes('<html')) {
        htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover"></head><body style="margin:0;padding:0;">${htmlContent}</body></html>`;
    }
    
    // CSS كامل الشاشة
    htmlContent = htmlContent.replace('</head>', `<style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        html, body { 
            width: 100%; 
            height: 100%; 
            margin: 0; 
            padding: 0; 
            overflow: hidden;
            background: transparent;
        }
    </style></head>`);
    
    // التحديث اللحظي
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
    
    // رسالة ترحيب
    if (appData.welcome_message) {
        htmlContent = htmlContent.replace('</body>', `<div id="wc" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;">
            <div style="background:#fff;border-radius:16px;padding:25px;text-align:center;max-width:300px;">
                <h3 style="margin:0 0 15px;color:#222;font-family:sans-serif;">${appData.welcome_message}</h3>
                <button onclick="document.getElementById('wc').remove();" style="padding:12px 30px;background:#22c55e;color:#fff;border:none;border-radius:10px;font-size:14px;cursor:pointer;">موافق</button>
            </div>
        </div></body>`);
    }
    
    fs.writeFileSync(`${appDir}/assets/index.html`, htmlContent);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appData.name}</string></resources>`);
    
    // أيقونة
    let hasIcon = false;
    if (appData.icon_url) {
        const p = path.join(__dirname, appData.icon_url);
        if (fs.existsSync(p)) {
            const buf = fs.readFileSync(p);
            if (buf[0] === 0x89 && buf[1] === 0x50) {
                fs.copyFileSync(p, `${appDir}/res/drawable/ic_launcher.png`);
                hasIcon = true;
            }
        }
    }
    
    // الأذونات
    const selectedPermissions = appData.permissions || ['INTERNET', 'ACCESS_NETWORK_STATE'];
    const permissionsLines = selectedPermissions.map(p => {
        const perm = PERMISSIONS_MAP[p];
        return perm ? `    <uses-permission android:name="${perm}" />` : '';
    }).filter(Boolean).join('\n');
    
    // AndroidManifest - نسخة نظيفة زي فيسبوك
    fs.writeFileSync(`${appDir}/AndroidManifest.xml`, `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="${safeName}">
    <uses-sdk android:minSdkVersion="21" android:targetSdkVersion="34" />
${permissionsLines}
    
    <application 
        android:label="@string/app_name"${hasIcon ? ' android:icon="@drawable/ic_launcher"' : ''} 
        android:usesCleartextTraffic="true" 
        android:hardwareAccelerated="true"
        android:theme="@android:style/Theme.NoTitleBar.Fullscreen">
        <activity 
            android:name=".MainActivity" 
            android:exported="true" 
            android:configChanges="orientation|screenSize|keyboardHidden|screenLayout|smallestScreenSize|density"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>`);
    
    // MainActivity - نسخة بسيطة زي فيسبوك
    fs.writeFileSync(`${appDir}/MainActivity.java`, `package ${safeName};

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;
    
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // 1. تفعيل Fullscreen edge-to-edge زي فيسبوك
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_FULLSCREEN,
            WindowManager.LayoutParams.FLAG_FULLSCREEN
        );
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            Window window = getWindow();
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.setStatusBarColor(Color.TRANSPARENT);
            window.setNavigationBarColor(Color.TRANSPARENT);
            
            // Edge-to-edge - خلي المحتوى يمتد تحت الشرائط
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                window.setDecorFitsSystemWindows(false);
            } else {
                window.getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                    | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                    | View.SYSTEM_UI_FLAG_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                );
            }
        }
        
        // 2. إنشاء WebView
        webView = new WebView(this);
        webView.setBackgroundColor(Color.TRANSPARENT);
        
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setSupportZoom(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient());
        webView.setScrollBarStyle(View.SCROLLBARS_INSIDE_OVERLAY);
        webView.setVerticalScrollBarEnabled(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.loadUrl("file:///android_asset/index.html");
        
        setContentView(webView);
    }
    
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus && Build.VERSION.SDK_INT >= Build.VERSION_CODES.KITKAT) {
            getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            );
        }
    }
    
    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
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
