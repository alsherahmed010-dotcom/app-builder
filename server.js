const express = require('express');
const app = express();
const cors = require('cors');

app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.json({ status: 'running', service: 'App Builder' });
});

app.post('/build', (req, res) => {
    const { app_name, html_content } = req.body;
    res.json({ status: 'building', app_name });
});

app.listen(process.env.PORT || 8080, () => console.log('Running'));
