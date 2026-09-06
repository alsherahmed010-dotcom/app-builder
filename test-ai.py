import requests, json

API_URL = 'https://apihub.agnes-ai.com/v1/chat/completions'
API_KEY = 'sk-7USYYx2oANFNeZJ6M4i9nSlt80DsKCpoDJmFymiJohdGZJ2z'

q = input('سؤالك: ')

headers = {
    'Authorization': 'Bearer ' + API_KEY,
    'Content-Type': 'application/json'
}

data = {
    'model': 'agnes-2.5-pro',
    'messages': [{'role': 'user', 'content': q}],
    'max_tokens': 2000
}

response = requests.post(API_URL, headers=headers, json=data)

print('Status:', response.status_code)
result = response.json()
if 'choices' in result:
    print(result['choices'][0]['message']['content'])
else:
    print(json.dumps(result, indent=2, ensure_ascii=False))
