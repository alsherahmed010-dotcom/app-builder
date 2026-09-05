import requests, json

API_KEY = "sk-eV8aSN0NWxNYGnTdvws5nIGAcMWvUk0G2i0u5MdGIdyl2H1Q"
BASE = "https://apihub.agnes-ai.com/v1"

def chat(prompt):
    headers = {
        'Authorization': f'Bearer {API_KEY}',
        'Content-Type': 'application/json'
    }
    
    data = {
        "model": "agnes-2.5-pro",
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 2000
    }
    
    resp = requests.post(f'{BASE}/chat/completions', headers=headers, json=data)
    print('Status:', resp.status_code)
    
    result = resp.json()
    print(json.dumps(result, indent=2, ensure_ascii=False)[:500])
    
    if resp.status_code == 200 and 'choices' in result:
        content = result['choices'][0]['message']['content']
        print('\n--- الرد ---')
        print(content)

if __name__ == '__main__':
    q = input('سؤالك: ')
    chat(q)
