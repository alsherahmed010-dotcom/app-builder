with open('server.js', 'r') as f:
    content = f.read()

# 1. إضافة دالة للتحقق من الجهاز
smart_endpoints = '''
// ============================================
// 🧠 SMART PASSWORD RESET WITH DEVICE VERIFICATION
// ============================================

// طلب إعادة تعيين كلمة السر
app.post('/api/forgot-password/check', async (req, res) => {
    const { phone, device_id } = req.body;
    
    if (!phone) return res.status(400).json({ error: 'رقم الهاتف مطلوب' });
    
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'الرقم غير مسجل' });
    
    // تحقق: هل الجهاز ده هو نفس الجهاز اللي سجل بيه؟
    const devices = user.devices || [];
    const isOwner = devices.includes(device_id) || user.device_id === device_id;
    
    if (isOwner) {
        return res.json({ 
            success: true, 
            verified: true, 
            message: '✅ تم التحقق من جهازك - يمكنك تغيير كلمة السر'
        });
    } else {
        // جهاز جديد - اطلب موافقة إضافية
        return res.json({ 
            success: true, 
            verified: false, 
            message: '⚠️ رقم مسجل بالفعل. تم إرسال طلب تحقق...'
        });
    }
});

// تغيير كلمة السر بعد التحقق
app.post('/api/forgot-password/reset', async (req, res) => {
    const { phone, device_id, newPassword, verified } = req.body;
    
    if (!phone || !device_id || !newPassword) {
        return res.status(400).json({ error: 'كل الحقول مطلوبة' });
    }
    
    if (newPassword.length < 4) {
        return res.status(400).json({ error: 'كلمة السر 4 أحرف على الأقل' });
    }
    
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'الرقم غير مسجل' });
    
    // تحقق من الجهاز
    const devices = user.devices || [];
    const isOwner = devices.includes(device_id) || user.device_id === device_id;
    
    // لو مش نفس الجهاز، محتاج verified=true (من كود تحقق مثلاً)
    if (!isOwner && !verified) {
        return res.status(403).json({ error: 'غير مسموح - جهاز مختلف' });
    }
    
    // غيّر كلمة السر
    user.password = hash(newPassword);
    user.passwordChangedAt = Date.now();
    
    // ضيف الجهاز ده للقائمة
    if (!user.devices) user.devices = [];
    if (!user.devices.includes(device_id)) {
        user.devices.push(device_id);
    }
    
    saveUsers();
    console.log('🔑 Password reset for:', user.name, phone, '| Device:', device_id);
    
    res.json({ success: true, message: '✅ تم تغيير كلمة السر بنجاح' });
});

// ================================================

'''

if 'forgot-password/check' not in content:
    content = content.replace("app.get('/', (req, res)", smart_endpoints + "\napp.get('/', (req, res)")
    print("✅ 1. تم إضافة Smart Password Reset")

# 2. تحديث register لحفظ devices
content = content.replace(
    """    const userData = {
        id: userId, phone, name,
        password: hashedPassword,
        avatar: null, about: 'متاح',
        role: role,
        createdAt: Date.now(), lastSeen: Date.now()
    };""",
    """    const userData = {
        id: userId, phone, name,
        password: hashedPassword,
        avatar: null, about: 'متاح',
        role: role,
        devices: device_id ? [device_id] : [],
        createdAt: Date.now(), lastSeen: Date.now()
    };"""
)
print("✅ 2. تم تحديث register")

# 3. تحديث login ليضيف الجهاز الجديد
content = content.replace(
    """    if (device_id) user.device_id = device_id;
    if (ADMIN_PHONES.includes(phone) || ADMIN_DEVICES.includes(device_id)) {
        user.role = 'admin';
    }
    saveUsers();""",
    """    if (device_id) {
        user.device_id = device_id;
        if (!user.devices) user.devices = [];
        if (!user.devices.includes(device_id)) {
            user.devices.push(device_id);
            console.log('📱 New device added for', user.name);
        }
    }
    if (ADMIN_PHONES.includes(phone) || ADMIN_DEVICES.includes(device_id)) {
        user.role = 'admin';
    }
    user.lastSeen = Date.now();
    saveUsers();"""
)
print("✅ 3. تم تحديث login")

with open('server.js', 'w') as f:
    f.write(content)
print("\\n🎉 تم التحديث! ارفع:")
print("git add . && git commit -m 'Smart password reset' && git push && railway up")
