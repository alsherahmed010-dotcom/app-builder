import requests, json

url = 'https://www.bing.com/chat'
session = requests.Session()
session.headers.update({
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
})

q = input('سؤالك: ')

try:
    resp = session.post(url, json={'message': q}, timeout=30)
    data = resp.json()
    print(data.get('response', 'فشل'))
except Exception as e:
    print(f'خطأ: {e}')
