import requests, json, re

url = 'https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate'
session = requests.Session()
session.headers.update({'user-agent': 'Mozilla/5.0 Chrome/123.0'})

r = session.get('https://gemini.google.com')
sn_match = re.search(r'"SNlM0e":"(.*?)"', r.text)
fdr_match = re.search(r'"FdrFJe":"([\d-]+)"', r.text)

if not sn_match or not fdr_match:
    print("فشل")
    exit(1)

sn = sn_match.group(1)
fdr = fdr_match.group(1)

q = input('سؤالك: ')

message = [q, 0, None, [], None, None, 0]
lang = ['en']
extra = [None, None, None, None, None, []]
inner = json.dumps([message, lang, extra, None, None, None, [], 0, [], [], 1, 0])
outer = json.dumps([None, inner])

data = {'at': sn, 'f.req': outer}
params = {'bl': 'Mr Dark: t.me/sii_3', 'hl': 'en', '_reqid': 12345, 'rt': 'c', 'f.sid': fdr}

resp = session.post(url, params=params, data=data, stream=True)

for line in resp.iter_lines(decode_unicode=True):
    if line:
        try:
            j = json.loads(line)
            if j and len(j[0]) > 2:
                d = json.loads(j[0][2])
                if d[4][0][1][0]:
                    print(d[4][0][1][0], end='', flush=True)
        except:
            pass
print()
