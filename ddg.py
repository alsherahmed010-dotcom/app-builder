import requests, json

url = 'https://duckduckgo.com/duckchat/v1/status'
headers = {'x-vqd-accept': '1', 'user-agent': 'Mozilla/5.0'}

r = requests.get(url, headers=headers)
vqd = r.headers.get('x-vqd-4')

q = input('سؤالك: ')

chat_url = 'https://duckduckgo.com/duckchat/v1/chat'
data = {'model': 'gpt-3.5-turbo', 'messages': [{'role': 'user', 'content': q}]}
resp = requests.post(chat_url, headers={'x-vqd-4': vqd, 'content-type': 'application/json', 'user-agent': 'Mozilla/5.0'}, json=data, stream=True)

for line in resp.iter_lines(decode_unicode=True):
    if line and line.startswith('data: '):
        try:
            j = json.loads(line[6:])
            msg = j.get('message', '')
            if msg:
                print(msg, end='', flush=True)
        except:
            pass
print()
