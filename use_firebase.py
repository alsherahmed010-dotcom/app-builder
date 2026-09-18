with open('server.js', 'r') as f:
    content = f.read()

# إضافة Firebase configuration
firebase_code = '''
// ============================================
// 🔥 FIREBASE CONFIGURATION
// ============================================
const https = require('https');
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

// ================================================

'''

if 'FIREBASE_URL' not in content:
    content = content.replace("const app = express();", firebase_code + "\nconst app = express();")
    print("✅ 1. Firebase added")

# تحويل saveUsers/loadUsers لـ async مع Firebase
content = content.replace(
    "function saveUsers() { saveJSON(path.join(__dirname, 'users.json'), users); }",
    """function saveUsers() { 
    saveJSON(path.join(__dirname, 'users.json'), users);
    // حفظ في Firebase كـ backup
    fb.set('/app_builder_users', users).catch(e => console.error('FB save error:', e));
}

async function loadUsersFromFirebase() {
    try {
        const fbUsers = await fb.get('/app_builder_users');
        if (fbUsers && Array.isArray(fbUsers) && fbUsers.length > 0) {
            console.log('✅ Loaded', fbUsers.length, 'users from Firebase');
            return fbUsers;
        }
    } catch(e) { console.error('FB load error:', e); }
    return null;
}"""
)
print("✅ 2. Save to Firebase")

# تحويل حفظ التطبيقات
content = content.replace(
    "function saveApps() { saveJSON(path.join(__dirname, 'apps.json'), allApps); }",
    """function saveApps() { 
    saveJSON(path.join(__dirname, 'apps.json'), allApps);
    fb.set('/app_builder_apps', allApps).catch(e => console.error('FB save error:', e));
}

async function loadAppsFromFirebase() {
    try {
        const fbApps = await fb.get('/app_builder_apps');
        if (fbApps && Array.isArray(fbApps) && fbApps.length > 0) {
            console.log('✅ Loaded', fbApps.length, 'apps from Firebase');
            return fbApps;
        }
    } catch(e) { console.error('FB load error:', e); }
    return null;
}"""
)
print("✅ 3. Apps to Firebase")

with open('server.js', 'w') as f:
    f.write(content)

print("\\n🎉 تم! ارفع:")
print("git add . && git commit -m 'Firebase persistence' && git push && railway up")
