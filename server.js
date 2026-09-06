const express = require('express');
const { exec } = require('child_process');
const multer = require('multer');
const app = express();
const cors = require('cors');
const fs = require('fs');
const path = require('path');

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

function saveApps() {
    fs.writeFileSync('apps.json', JSON.stringify(apps, null, 2));
}

app.get('/', (req, res) => res.json({ status: 'running' }));

app.post('/api/apps', upload.single('icon'), (req, res) => {
    const { name, package_name, app_type, content, description, fps, welcome_message, exit_message } = req.body;
    const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
    
    const appData = {
        id: Date.now(),
        name: name || 'App',
        package_name: package_name || 'com.app.app',
        app_type: app_type || 'html',
        content: content || '',
        description: description || '',
        fps: parseInt(fps) || 90,
        welcome_message: welcome_message || '',
        exit_message: exit_message || '',
        icon_url,
        status: 'pending',
        apk_url: null,
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
    
    saveApps();
    res.json({ success: true, message: '✅ تم التحديث' });
});

app.delete('/api/apps/:id', (req, res) => {
    apps = apps.filter(a => a.id !== parseInt(req.params.id));
    saveApps();
    res.json({ success: true });
});

app.post('/api/build/:id', async (req, res) => {
    const id = parseInt(req.params.id);
    const appData = apps.find(a => a.id === id);
    if (!appData) return res.status(404).json({ error: 'Not found' });
    
    appData.status = 'building';
    saveApps();
    res.json({ success: true, message: 'Build started' });
    
    try {
        const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
        const appDir = path.join(__dirname, 'builds', String(id));
        
        fs.mkdirSync(`${appDir}/assets`, { recursive: true });
        fs.mkdirSync(`${appDir}/res/values`, { recursive: true });
        
        let htmlContent = appData.content || '<h1>App</h1>';
        if (appData.app_type === 'url' && appData.content) {
            htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body style="margin:0;padding:0;"><iframe src="${appData.content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
        }
        if (!htmlContent.includes('<html')) {
            htmlContent = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body>${htmlContent}</body></html>`;
        }
        
        fs.writeFileSync(`${appDir}/assets/index.html`, htmlContent);
        fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appData.name}</string></resources>`);
        
        let hasIcon = false;
        if (appData.icon_url) {
            const p = path.join(__dirname, appData.icon_url);
            if (fs.existsSync(p)) {
                const buf = fs.readFileSync(p);
                if (buf[0] === 0x89 && buf[1] === 0x50) {
                    fs.mkdirSync(`${appDir}/res/drawable`, { recursive: true });
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
                appData.status = 'failed';
            } else {
                appData.apk_url = `/builds/${id}/final.apk`;
                appData.status = 'completed';
                console.log('✅ Built');
            }
            saveApps();
        });
    } catch (e) {
        console.error('Error:', e.message);
        appData.status = 'failed';
        saveApps();
    }
});

app.get('/api/build-status/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData) return res.status(404).json({ error: 'Not found' });
    res.json({ status: appData.status, apk_url: appData.apk_url });
});

app.get('/api/download/:id', (req, res) => {
    const appData = apps.find(a => a.id === parseInt(req.params.id));
    if (!appData || !appData.apk_url) return res.status(404).json({ error: 'Not found' });
    res.download(path.join(__dirname, appData.apk_url), `${appData.name}.apk`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
