// إضافة endpoint لإعادة تعيين كلمة السر
const fs = require('fs');
let server = fs.readFileSync('server.js', 'utf8');

if (server.includes('RESET_PASSWORD_ENDPOINT')) {
    console.log('⚠️ الـ endpoint موجود بالفعل');
    process.exit(0);
}

const resetEndpoint = `
// ============ RESET_PASSWORD_ENDPOINT ============
app.post('/api/reset-password-emergency', async (req, res) => {
    const { phone, newPassword, secret } = req.body;
    if (secret !== 'reset_secret_2026') {
        return res.status(403).json({ error: 'Wrong secret' });
    }
    if (!phone || !newPassword) {
        return res.status(400).json({ error: 'Missing data' });
    }
    const user = users.find(u => u.phone === phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.password = hash(newPassword);
    saveUsers();
    console.log('🔑 Password reset for:', user.name, phone);
    res.json({ success: true, message: 'Password reset done' });
});
// ================================================

`;

// إضافتها قبل app.listen
server = server.replace(
    "app.listen(PORT,",
    resetEndpoint + "\napp.listen(PORT,"
);

fs.writeFileSync('server.js', server);
console.log('✅ تم إضافة الـ endpoint');
