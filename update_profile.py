with open('server.js', 'r') as f:
    content = f.read()

# إضافة endpoint لتحديث الملف الشخصي
profile_endpoint = '''
// ============================================
// 👤 UPDATE PROFILE
// ============================================
app.put('/api/profile', upload.single('avatar'), async (req, res) => {
    const token = req.headers['x-auth-token'];
    if (!token || !sessions[token]) return res.status(401).json({ error: 'Unauthorized' });
    
    const user = users.find(u => u.id === sessions[token].userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    
    if (req.body.name && req.body.name.trim().length >= 2) {
        user.name = req.body.name.trim();
    }
    
    if (req.file) {
        user.avatar = `/uploads/${req.file.filename}`;
    }
    
    // للأدمن: تغيير لون/رمز مخصص
    if (req.body.admin_color && user.role === 'admin') {
        user.admin_color = req.body.admin_color;
    }
    
    user.updatedAt = Date.now();
    saveUsers();
    console.log('👤 Profile updated:', user.name);
    
    res.json({ 
        success: true, 
        message: 'تم التحديث',
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

// ================================================

'''

if "/api/profile" not in content:
    content = content.replace("app.get('/', (req, res)", profile_endpoint + "app.get('/', (req, res)")
    print("✅ 1. تم إضافة /api/profile")

# تحديث login و me لترجع admin_color
content = content.replace(
    "res.json({ success: true, token, user: { id: user.id, name: user.name, phone: user.phone, about: user.about, avatar: user.avatar, role: user.role || 'user' } });",
    "res.json({ success: true, token, user: { id: user.id, name: user.name, phone: user.phone, about: user.about, avatar: user.avatar, role: user.role || 'user', admin_color: user.admin_color } });"
)

# me endpoint
old_me = "res.json({ success: true, user });"
new_me = "res.json({ success: true, user: { id: user.id, name: user.name, phone: user.phone, role: user.role, avatar: user.avatar, about: user.about, admin_color: user.admin_color } });"
content = content.replace(old_me, new_me)

with open('server.js', 'w') as f:
    f.write(content)

print("✅ 2. تم تحديث login/me")
print("\\n🎉 ارفع:")
print("git add . && git commit -m 'Add profile update' && git push && railway up")
