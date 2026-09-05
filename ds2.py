import requests, json

API_KEY = "sk-05632ab762744f2788a28839c878f815"

q = input('سؤالك: ')

headers = {
    'Authorization': f'Bearer {API_KEY}',
    'Content-Type': 'application/json'
}

data = {
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": q}]
}

resp = requests.post('https://api.deepseek.com/chat/completions', headers=headers, json=data)
print(resp.status_code)
print(resp.text)
