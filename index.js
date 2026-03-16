const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');

// Garante pasta de sessão
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR);

let currentQR = null;
let sock = null;

async function connect() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Bot Teste', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { qr, connection } = update;
        if (qr) {
            console.log('QR recebido');
            currentQR = await qrcode.toDataURL(qr);
        }
        if (connection === 'open') {
            console.log('Conectado!');
            currentQR = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<img src="${currentQR}" style="width:300px;">`);
    } else {
        res.send('Aguardando QR...');
    }
});

app.get('/status', (req, res) => {
    res.json({ qr: !!currentQR, ready: sock?.user ? true : false });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    connect();
});