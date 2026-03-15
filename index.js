const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');

const app = express();
app.use(cors());
app.use(express.json());

let client = null;
let currentQR = null;
let botReady = false;
let starting = false;


function startBot() {

    if (client || starting) {
        return;
    }

    starting = true;

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--no-first-run",
                "--no-zygote",
                "--single-process"
            ]
        }
    });


    client.on('qr', async (qr) => {

        console.log("QR RECEBIDO Silvino");

        currentQR = await qrcode.toDataURL(qr);

    });


    client.on('ready', () => {

        console.log("BOT PRONTO Silvino Soares");

        botReady = true;
        currentQR = null;

    });


    client.on('message', async (message) => {

        // ignorar grupos
        if (message.from.includes('@g.us')) return;

        const texto = message.body.toLowerCase();


        if (texto === 'oi') {

            message.reply('Olá, atendimento automático.');

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

    res.send("Bot iniciado agora está pronto");

});


// status
app.get('/status', (req, res) => {

    res.json({
        ready: botReady,
        qr: currentQR ? true : false
    });

});


// qr
app.get('/qr', (req, res) => {

    res.json({
        qr: currentQR
    });

});


// home
app.get('/', (req, res) => {

    res.send("Backend rodando Silvino");

});


const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

    console.log("Servidor rodando agora Silvino");

});