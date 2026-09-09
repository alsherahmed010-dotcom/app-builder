#!/bin/bash

# نسخة احتياطية
cp server.js server.js.backup

# استبدال جزء التحديث في الكود
python3 << 'PYTHON'
import re

with open('server.js', 'r') as f:
    content = f.read()

# الكود القديم للتحديث
old_update = '''    // Update on app open only
    htmlContent += `<script>
(function(){
    var apiBase = '${req.protocol}://${req.get('host')}';
    var appId = ${id};
    
    function checkUpdate() {
        fetch(apiBase + '/api/live-content/' + appId)
            .then(function(r) { return r.text(); })
            .then(function(content) {
                var savedContent = localStorage.getItem('last_content');
                if (content !== savedContent) {
                    localStorage.setItem('last_content', content);
                    document.open();
                    document.write(content);
                    document.close();
                }
            })
            .catch(function() {
                var savedContent = localStorage.getItem('last_content');
                if (savedContent) {
                    document.open();
                    document.write(savedContent);
                    document.close();
                }
            });
    }
    
    if (navigator.onLine) {
        checkUpdate();
    }
    
    window.addEventListener('online', checkUpdate);
})();
</script>`;'''

# الكود الجديد للتحديث
new_update = '''    // Update on app open - save and replace
    htmlContent += `<script>
(function(){
    var apiBase = '${req.protocol}://${req.get('host')}';
    var appId = ${id};
    
    function loadSavedContent() {
        var savedContent = localStorage.getItem('app_content_v2');
        if (savedContent) {
            document.open();
            document.write(savedContent);
            document.close();
        }
    }
    
    function checkUpdate() {
        fetch(apiBase + '/api/live-content/' + appId)
            .then(function(r) { return r.text(); })
            .then(function(content) {
                var savedContent = localStorage.getItem('app_content_v2');
                if (content !== savedContent) {
                    // حفظ المحتوى الجديد
                    localStorage.setItem('app_content_v2', content);
                    // استبدال المحتوى
                    document.open();
                    document.write(content);
                    document.close();
                }
            })
            .catch(function() {
                // مفيش نت - استخدم المحتوى المحفوظ
                loadSavedContent();
            });
    }
    
    // أول ما يفتح التطبيق
    if (navigator.onLine) {
        checkUpdate();
    } else {
        loadSavedContent();
    }
    
    // لو النت رجع
    window.addEventListener('online', checkUpdate);
})();
</script>`;'''

# استبدال الكود
if old_update in content:
    content = content.replace(old_update, new_update)
    with open('server.js', 'w') as f:
        f.write(content)
    print("✅ تم التحديث بنجاح")
else:
    print("❌ لم يتم العثور على الكود القديم")
PYTHON

git add . && git commit -m "Fix: Save and replace content properly for offline" && git push origin main && railway up 2>/dev/null
