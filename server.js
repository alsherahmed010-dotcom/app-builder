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
let notifications = [];
if (fs.existsSync('apps.json')) apps = JSON.parse(fs.readFileSync('apps.json', 'utf8'));
if (fs.existsSync('notifications.json')) notifications = JSON.parse(fs.readFileSync('notifications.json', 'utf8'));

function saveApps() { fs.writeFileSync('apps.json', JSON.stringify(apps, null, 2)); }
function saveNotifs() { fs.writeFileSync('notifications.json', JSON.stringify(notifications, null, 2)); }

const keystorePath = path.join(__dirname, 'debug.keystore');
if (!fs.existsSync(keystorePath)) {
  exec(`keytool -genkey -v -keystore ${keystorePath} -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 -storepass android -keypass android -dname "CN=Android Debug,O=Android,C=US"`, (err) => {});
}

app.get('/', (req, res) => res.json({ status: 'running' }));

// ============ التحديث اللحظي ============
app.get('/api/live-content/:id', (req, res) => {
  const appData = apps.find(a => a.id === parseInt(req.params.id));
  if (!appData) return res.status(404).send('Not found');
  
  let content = appData.content || '<h1>App</h1>';
  
  if (appData.app_type === 'url' && content) {
    content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;"><iframe src="${content}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
  }
  if (!content.includes('<html')) {
    content = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body>${content}</body></html>`;
  }
  
  // رسالة ترحيب - تحديث لحظي
  if (appData.welcome_message) {
    const welcomeScript = `
<script>
(function() {
  var maxShows = ${appData.welcome_max_shows || 1};
  var shown = parseInt(localStorage.getItem('welcome_shown') || '0');
  
  if (shown < maxShows) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:center;justify-content:center;padding:20px;';
    
    var box = document.createElement('div');
    box.style.cssText = 'background:#fff;border-radius:16px;padding:25px;text-align:center;max-width:320px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.5);';
    
    var msg = document.createElement('h3');
    msg.style.cssText = 'color:#333;font-size:16px;margin-bottom:15px;';
    msg.textContent = '${appData.welcome_message.replace(/'/g, "\\'")}';
    box.appendChild(msg);
    
    ${appData.welcome_link ? `
    var link = document.createElement('a');
    link.style.cssText = 'display:block;margin-bottom:15px;color:#00ff66;font-size:14px;font-weight:700;';
    link.href = '${appData.welcome_link}';
    link.textContent = '🔗 فتح الرابط';
    link.target = '_blank';
    box.appendChild(link);
    ` : ''}
    
    var btn = document.createElement('button');
    btn.style.cssText = 'padding:12px 30px;background:#00ff66;color:#000;border:none;border-radius:10px;font-size:14px;font-weight:900;cursor:pointer;';
    btn.textContent = 'موافق';
    btn.onclick = function() {
      localStorage.setItem('welcome_shown', (shown + 1).toString());
      overlay.remove();
    };
    box.appendChild(btn);
    
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
})();
</script>`;
    content += welcomeScript;
  }
  
  // إشعارات - تحديث لحظي
  content += `
<script>
(function() {
  var lastNotifId = 0;
  setInterval(function() {
    fetch('/api/notifications/${appData.id}')
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.notifications && d.notifications.length > 0) {
          var n = d.notifications[0];
          if (n.id !== lastNotifId) {
            lastNotifId = n.id;
            
            var maxShows = ${appData.notif_max_shows || 1};
            var shown = parseInt(localStorage.getItem('notif_' + n.id) || '0');
            
            if (shown < maxShows) {
              localStorage.setItem('notif_' + n.id, (shown + 1).toString());
              
              var div = document.createElement('div');
              div.style.cssText = 'position:fixed;top:15px;right:15px;left:15px;background:#fff;padding:15px;border-radius:12px;z-index:99998;box-shadow:0 5px 20px rgba(0,0,0,.3);';
              div.innerHTML = '<strong style="color:#333;">📢 ' + n.title + '</strong><br><span style="color:#666;">' + n.message + '</span>';
              document.body.appendChild(div);
              
              setTimeout(function() { div.remove(); }, ${appData.notif_duration * 1000 || 5000});
            }
          }
        }
      });
  }, 5000);
})();
</script>`;
  
  res.send(content);
});

// ============ الإشعارات ============
app.post('/api/notify/:id', (req, res) => {
  const { title, message, duration, max_shows } = req.body;
  const notif = {
    id: Date.now(),
    app_id: parseInt(req.params.id),
    title: title || 'إشعار',
    message: message || '',
    duration: duration || 5,
    max_shows: max_shows || 1,
    createdAt: Date.now()
  };
  notifications.unshift(notif);
  saveNotifs();
  res.json({ success: true });
});

app.get('/api/notifications/:appId', (req, res) => {
  const appNotifs = notifications.filter(n => n.app_id === parseInt(req.params.appId));
  res.json({ success: true, notifications: appNotifs });
});

// ============ التطبيقات ============
app.post('/api/apps', upload.single('icon'), (req, res) => {
  const { name, package_name, app_type, content, description, fps, welcome_message, welcome_link, welcome_max_shows, exit_message, notif_duration, notif_max_shows } = req.body;
  const icon_url = req.file ? `/uploads/${req.file.filename}` : null;
  
  const app = {
    id: Date.now(),
    name: name || 'App',
    package_name: package_name || 'com.app.app',
    app_type: app_type || 'html',
    content: content || '',
    description: description || '',
    fps: parseInt(fps) || 90,
    welcome_message: welcome_message || '',
    welcome_link: welcome_link || '',
    welcome_max_shows: parseInt(welcome_max_shows) || 1,
    exit_message: exit_message || '',
    notif_duration: parseInt(notif_duration) || 5,
    notif_max_shows: parseInt(notif_max_shows) || 1,
    icon_url,
    status: 'pending',
    apk_url: null,
    createdAt: Date.now()
  };
  
  apps.unshift(app);
  saveApps();
  res.json({ success: true, app });
});

app.get('/api/apps', (req, res) => {
  res.json({ success: true, apps });
});

app.get('/api/apps/:id', (req, res) => {
  const app = apps.find(a => a.id === parseInt(req.params.id));
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, app });
});

app.put('/api/apps/:id', upload.single('icon'), (req, res) => {
  const id = parseInt(req.params.id);
  const index = apps.findIndex(a => a.id === id);
  if (index === -1) return res.status(404).json({ error: 'Not found' });
  
  const { name, package_name, content, description, welcome_message, welcome_link, welcome_max_shows, exit_message, notif_duration, notif_max_shows } = req.body;
  if (name) apps[index].name = name;
  if (package_name) apps[index].package_name = package_name;
  if (content) apps[index].content = content;
  if (description) apps[index].description = description;
  if (welcome_message !== undefined) apps[index].welcome_message = welcome_message;
  if (welcome_link !== undefined) apps[index].welcome_link = welcome_link;
  if (welcome_max_shows) apps[index].welcome_max_shows = parseInt(welcome_max_shows);
  if (exit_message !== undefined) apps[index].exit_message = exit_message;
  if (notif_duration) apps[index].notif_duration = parseInt(notif_duration);
  if (notif_max_shows) apps[index].notif_max_shows = parseInt(notif_max_shows);
  if (req.file) apps[index].icon_url = `/uploads/${req.file.filename}`;
  
  saveApps();
  res.json({ success: true, message: '✅ تم التحديث اللحظي!' });
});

app.delete('/api/apps/:id', (req, res) => {
  apps = apps.filter(a => a.id !== parseInt(req.params.id));
  saveApps();
  res.json({ success: true });
});

// بناء APK
app.post('/api/build/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const appData = apps.find(a => a.id === id);
  if (!appData) return res.status(404).json({ error: 'Not found' });
  
  appData.status = 'building';
  saveApps();
  res.json({ success: true });
  
  try {
    const safeName = (appData.package_name || 'com.app.app').replace(/[^a-z0-9.]/g, '');
    const appDir = path.join(__dirname, 'builds', String(id));
    fs.mkdirSync(`${appDir}/assets`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/drawable`, { recursive: true });
    fs.mkdirSync(`${appDir}/res/values`, { recursive: true });
    
    // HTML يقرا من السيرفر للتحديث اللحظي
    const liveHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;"><iframe src="https://app-builder-production-ab4d.up.railway.app/api/live-content/${id}" style="width:100vw;height:100vh;border:none;"></iframe></body></html>`;
    
    fs.writeFileSync(`${appDir}/assets/index.html`, liveHtml);
    fs.writeFileSync(`${appDir}/res/values/strings.xml`, `<?xml version="1.0" encoding="utf-8"?><resources><string name="app_name">${appData.name}</string></resources>`);
    
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
        appData.status = 'failed';
        console.error(stderr || err.message);
      } else {
        appData.apk_url = `/builds/${id}/final.apk`;
        appData.status = 'completed';
        console.log('✅ Built');
      }
      saveApps();
    });
  } catch (e) {
    appData.status = 'failed';
    saveApps();
  }
});

app.get('/api/build-status/:id', (req, res) => {
  const app = apps.find(a => a.id === parseInt(req.params.id));
  if (!app) return res.status(404).json({ error: 'Not found' });
  res.json({ status: app.status, apk_url: app.apk_url });
});

app.get('/api/download/:id', (req, res) => {
  const app = apps.find(a => a.id === parseInt(req.params.id));
  if (!app || !app.apk_url) return res.status(404).json({ error: 'Not found' });
  res.download(path.join(__dirname, app.apk_url), `${app.name}.apk`);
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
