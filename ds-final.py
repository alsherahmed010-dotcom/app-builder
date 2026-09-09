import requests, json, base64, hashlib, time, struct

TOKEN = "z5b87Uhoc/G6Xe0IWh7AQH05py24bCEEQLgwFUFW4j0Q/3BtMqqW/TjzNcI6VvPO"
COOKIES = "ds_session_id=edf3aee62b394b66b43aa94b676fbfcf"

headers = {
    'authorization': f'Bearer {TOKEN}',
    'cookie': COOKIES,
    'user-agent': 'Mozilla/5.0',
    'content-type': 'application/json',
    'origin': 'https://chat.deepseek.com',
    'referer': 'https://chat.deepseek.com/'
}

session = requests.Session()
session.headers.update(headers)

q = input('سؤالك: ')

# جلسة
r = session.post('https://chat.deepseek.com/api/v0/chat_session/create', json={})
session_id = r.json()['data']['biz_data']['id']

# PoW Challenge
r = session.post('https://chat.deepseek.com/api/v0/chat/create_pow_challenge', json={'target_path': '/api/v0/chat/completion'})
challenge_data = r.json()['data']['biz_data']
print('Challenge:', json.dumps(challenge_data)[:100])

# حل PoW عن بعد
try:
    r_pow = requests.post('https://dark.ps/deepseek/pow', json={'challenge': challenge_data}, timeout=30)
    pow_response = r_pow.json().get('x-ds-pow-response')
except:
    pow_response = None

if pow_response:
    headers['x-ds-pow-response'] = pow_response

# إرسال
chat_data = {
    'chat_session_id': session_id,
    'parent_message_id': None,
    'prompt': q,
    'ref_file_ids': [],
    'thinking_enabled': False,
    'search_enabled': False,
    'action': None,
    'preempt': False,
    'image_ids': []
}

r2 = session.post('https://chat.deepseek.com/api/v0/chat/completion', json=chat_data, headers=headers)
print('Status:', r2.status_code)
print(r2.text[:1000])
