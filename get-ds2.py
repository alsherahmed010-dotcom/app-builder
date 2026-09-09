import requests, re, json

# بنحاكي متصفح حقيقي
session = requests.Session()
session.headers.update({
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    'origin': 'https://chat.deepseek.com',
    'referer': 'https://chat.deepseek.com/'
})

# نفتح الصفحة الرئيسية
r = session.get('https://chat.deepseek.com')
print('Main page:', r.status_code)

# نستخرج الـ token من localStorage (مش موجود في HTML)
# نجرب API مباشرة
r2 = session.post('https://chat.deepseek.com/api/v0/chat_session/create', json={})
print('Session API:', r2.status_code)
print('Response:', r2.text[:300])

if r2.status_code == 200:
    session_id = r2.json()['data']['biz_data']['id']
    print(f'✅ Session ID: {session_id}')
    
    # نجرب نرسل رسالة
    chat_data = {
        'chat_session_id': session_id,
        'prompt': 'مرحبا',
        'thinking_enabled': False,
        'search_enabled': False
    }
    
    r3 = session.post('https://chat.deepseek.com/api/v0/chat/completion', json=chat_data)
    print('Chat API:', r3.status_code)
    print('Response:', r3.text[:500])
