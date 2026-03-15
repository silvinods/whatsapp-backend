const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let client;
let currentQR = null;
let botReady = false;

function startBot() {

    if (client) return;

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }
    });

    client.on('qr', async (qr) => {
        currentQR = await qrcode.toDataURL(qr);
        console.log("QR gerado");
    });

    client.on('ready', () => {
        botReady = true;
        console.log("Bot pronto");
    });

    client.on('message', async (message) => {

        if (message.from.includes('@g.us')) return;

        const texto = message.body.toLowerCase();

        if (texto === 'oi') {
            message.reply('Olá! Atendimento automático.');
        }

        if (texto === 'menu') {
            message.reply(
                'Menu:\n1 - Horário\n2 - Suporte\n3 - Atendente'
            );
        }

    });

    client.initialize();
}


// iniciar bot
app.get('/start', (req, res) => {
    startBot();
    res.send("Bot iniciado");
});


// status
app.get('/status', (req, res) => {
    res.json({
        ready: botReady
    });
});


// qr
app.get('/qr', (req, res) => {
    res.json({
        qr: currentQR
    });
});


app.get('/', (req, res) => {
    res.send("Backend rodando");
});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log("Servidor rodando");
});