const API_URL = 'https://apihub.agnes-ai.com/v1/chat/completions';
const API_KEY = 'sk-7USYYx2oANFNeZJ6M4i9nSlt80DsKCpoDJmFymiJohdGZJ2z';

const q = process.argv[2] || 'مرحبا';

fetch(API_URL, {
    method: 'POST',
    headers: {
        'Authorization': 'Bearer ' + API_KEY,
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        model: 'agnes-2.5-pro',
        messages: [{role: 'user', content: q}],
        max_tokens: 2000
    })
})
.then(r => r.json())
.then(data => {
    if (data.choices && data.choices[0]) {
        console.log(data.choices[0].message.content);
    } else {
        console.log(JSON.stringify(data, null, 2));
    }
})
.catch(e => console.error('Error:', e.message));
