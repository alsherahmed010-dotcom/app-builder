import requests, json

url = 'https://www.perplexity.ai/socket/backend/chat/completions'
headers = {
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
    'origin': 'https://www.perplexity.ai'
}

q = input('سؤالك: ')
data = {"model": "llama-3.1-sonar-small-128k-online", "messages": [{"role": "user", "content": q}]}

resp = requests.post(url, headers=headers, json=data)
print(resp.json()['choices'][0]['message']['content'])
