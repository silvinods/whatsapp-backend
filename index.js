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

    if (client || starting) return;

    starting = true;

    console.log("INICIANDO BOT...");

    client = new Client({

        authStrategy: new LocalAuth(),

        puppeteer: {

            headless: true,

            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-first-run",
                "--no-zygote",
                "--single-process"
            ]

        }

    });


    client.on('qr', async (qr) => {

        console.log("QR GERADO");

        currentQR = await qrcode.toDataURL(qr);

    });


    client.on('ready', () => {

        console.log("BOT CONECTADO");

        botReady = true;
        currentQR = null;
        starting = false;

    });


    client.on('auth_failure', msg => {

        console.log("ERRO AUTH", msg);

    });


    client.on('disconnected', () => {

        console.log("DESCONECTADO");

        client = null;
        botReady = false;
        starting = false;

    });


    client.on('message', async (msg) => {

        if (msg.from.includes('@g.us')) return;

        const texto = msg.body.toLowerCase();

        if (texto === 'oi') {

            msg.reply('Olá! Atendimento automático.');

        }

        if (texto === 'menu') {

            msg.reply('1 - Suporte\n2 - Horários');

        }

    });


    client.initialize().catch(err => {

        console.log("ERRO AO INICIAR", err);

        starting = false;

    });

}



// ROTAS

app.get('/status', (req, res) => {

    res.json({
        ready: botReady,
        qr: !!currentQR,
        starting: starting
    });

});


app.get('/qr', (req, res) => {

    if (currentQR) {

        res.send(`
        <html>
        <body style="background:#111;color:#fff;text-align:center">
        <h2>Escaneie o QR</h2>
        <img src="${currentQR}" width="300"/>
        <p>Atualize se nao aparecer</p>
        </body>
        </html>
        `);

    } else {

        res.send("QR ainda nao gerado");

    }

});


app.get('/', (req, res) => {

    res.send("Backend rodando");

});


const PORT = process.env.PORT || 3000;

app.listen(PORT, '0.0.0.0', () => {

    console.log("Servidor rodando");

    startBot();

});