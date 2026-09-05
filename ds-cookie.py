import json, httpx, requests, re

TOKEN = "z5b87Uhoc/G6Xe0IWh7AQH05py24bCEEQLgwFUFW4j0Q/3BtMqqW/TjzNcI6VvPO"
COOKIES = "ds_session_id=edf3aee62b394b66b43aa94b676fbfcf; smidV2=202609050017572a37a9fa5d56679d626724d8c4113706005dee11dc0e711c0"
BASE = 'https://chat.deepseek.com'

def chat(prompt):
    headers = {
        'authorization': f'Bearer {TOKEN}',
        'cookie': COOKIES,
        'user-agent': 'Mozilla/5.0 (Linux; Android 10) Chrome/124.0 Mobile Safari/537.36',
        'origin': BASE,
        'referer': f'{BASE}/',
        'content-type': 'application/json',
        'accept': '*/*',
        'x-app-version': '2.0.0',
        'x-client-version': '2.0.0',
        'x-client-platform': 'web',
        'x-client-locale': 'en_US',
        'x-client-bundle-id': 'com.deepseek.chat'
    }
    
    client = httpx.Client(base_url=BASE, headers=headers, timeout=120)
    
    try:
        # جلسة جديدة
        r = client.post('/api/v0/chat_session/create', json={})
        session_id = r.json()['data']['biz_data']['id']
        print(f'✅ Session: {session_id[:20]}...')
        
        # نجرب نرسل من غير PoW الأول
        chat_data = {
            'chat_session_id': session_id,
            'parent_message_id': None,
            'prompt': prompt,
            'thinking_enabled': False,
            'search_enabled': False,
            'model_type': 'default',
            'action': None,
            'preempt': False,
            'image_ids': []
        }
        
        with client.stream('POST', '/api/v0/chat/completion', json=chat_data) as resp:
            print('Status:', resp.status_code)
            body = ''
            for line in resp.iter_lines():
                if line:
                    body += line + '\n'
                    if line.startswith('data:'):
                        try:
                            j = json.loads(line[5:])
                            if isinstance(j, dict) and 'v' in j:
                                fragments = j['v'].get('response', {}).get('fragments', [])
                                if fragments:
                                    text = fragments[-1].get('content', '')
                                    if text and text != 'FINISHED':
                                        print(text, end='', flush=True)
                        except:
                            pass
            if resp.status_code != 200:
                print('\n--- BODY ---')
                print(body[:500])
        print()
    except Exception as e:
        print(f'خطأ: {e}')
    finally:
        client.close()

if __name__ == '__main__':
    q = input('سؤالك: ')
    chat(q)
