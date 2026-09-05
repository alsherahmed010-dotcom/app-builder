import json, httpx, requests

TOKEN = "z5b87Uhoc/G6Xe0IWh7AQH05py24bCEEQLgwFUFW4j0Q/3BtMqqW/TjzNcI6VvPO"
COOKIES = "ds_session_id=edf3aee62b394b66b43aa94b676fbfcf"
BASE = 'https://chat.deepseek.com'
CP = '/api/v0/chat/completion'

def solve_pow(challenge_data):
    try:
        r = requests.post("https://dark.ps/deepseek/pow", json={"challenge": challenge_data}, timeout=60)
        data = r.json()
        return data.get('x-ds-pow-response')
    except:
        return None

def chat(prompt):
    headers = {
        'authorization': f'Bearer {TOKEN}',
        'cookie': COOKIES,
        'user-agent': 'Mozilla/5.0',
        'origin': BASE,
        'referer': f'{BASE}/',
        'content-type': 'application/json'
    }
    
    client = httpx.Client(base_url=BASE, headers=headers, timeout=120)
    
    try:
        r = client.post('/api/v0/chat_session/create', json={})
        session_id = r.json()['data']['biz_data']['id']
        print('✅ Session created')
        
        r = client.post('/api/v0/chat/create_pow_challenge', json={'target_path': CP})
        challenge_data = r.json()['data']['biz_data']
        
        pow_response = solve_pow(challenge_data)
        
        if pow_response:
            print('✅ PoW solved')
        
        chat_data = {
            'chat_session_id': session_id,
            'prompt': prompt,
            'thinking_enabled': False,
            'search_enabled': False
        }
        
        headers_pow = {'x-ds-pow-response': pow_response} if pow_response else {}
        
        with client.stream('POST', CP, json=chat_data, headers=headers_pow) as resp:
            print('Status:', resp.status_code)
            for line in resp.iter_lines():
                if line and line.startswith('data:'):
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
        print()
    except Exception as e:
        print(f'خطأ: {e}')
    finally:
        client.close()

if __name__ == '__main__':
    q = input('سؤالك: ')
    chat(q)
