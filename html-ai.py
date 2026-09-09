import requests, json, re

q = input('وصف الموقع اللي عايزه: ')

url = 'https://api.flowgpt.com/v1/chat/completions'
headers = {
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0'
}

prompt = f"أنشئ كود HTML كامل مع CSS و JavaScript للموقع التالي: {q}. اعرض الكود فقط في ```html```"

data = {
    "model": "gpt-3.5-turbo",
    "messages": [{"role": "user", "content": prompt}]
}

try:
    resp = requests.post(url, headers=headers, json=data, timeout=30)
    result = resp.json()['choices'][0]['message']['content']
    
    html_match = re.search(r'```html\n(.*?)```', result, re.DOTALL)
    code = html_match.group(1) if html_match else result
    
    with open('generated.html', 'w', encoding='utf-8') as f:
        f.write(code)
    
    print('✅ تم حفظ الكود في generated.html')
except Exception as e:
    print(f'FlowGPT فشل: {e}')
    print('نجرب طريقة تانية...')
    
    # طريقة تانية: AI Horde
    url2 = 'https://horde.koboldai.net/api/v1/generate/text'
    data2 = {"prompt": f"Create HTML code for: {q}\n\n```html\n", "max_length": 2000}
    resp2 = requests.post(url2, json=data2, timeout=30)
    result2 = resp2.json()['results'][0]['text']
    code2 = '```html\n' + result2 + '```'
    
    html_match2 = re.search(r'```html\n(.*?)```', code2, re.DOTALL)
    final_code = html_match2.group(1) if html_match2 else code2
    
    with open('generated.html', 'w', encoding='utf-8') as f:
        f.write(final_code)
    print('✅ تم الحفظ بطريقة AI Horde')
