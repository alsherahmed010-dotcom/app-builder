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

// تخزين محلي
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
    
    const app = {
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
        status: 'completed',
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
    
    const { name, package_name, content, description, welcome_message, exit_message } = req.body;
    
    if (name) apps[index].name = name;
    if (package_name) apps[index].package_name = package_name;
    if (content) apps[index].content = content;
    if (description) apps[index].description = description;
    if (welcome_message) apps[index].welcome_message = welcome_message;
    if (exit_message) apps[index].exit_message = exit_message;
    if (req.file) apps[index].icon_url = `/uploads/${req.file.filename}`;
    
    saveApps();
    res.json({ success: true, message: '✅ تم التحديث اللحظي!' });
});

app.delete('/api/apps/:id', (req, res) => {
    apps = apps.filter(a => a.id !== parseInt(req.params.id));
    saveApps();
    res.json({ success: true });
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server on ${PORT}`));
