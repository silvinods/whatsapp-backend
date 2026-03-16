const { default: makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let currentQR = null;
let sock = null;

// Função com logs detalhados
async function connect() {
    console.log('1️⃣ Iniciando connect()...');
    try {
        console.log('2️⃣ Buscando versão do Baileys...');
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`   ✅ Versão obtida: ${version.join('.')} (última: ${isLatest})`);

        console.log('3️⃣ Carregando estado de autenticação...');
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
        console.log('   ✅ Estado carregado.');

        console.log('4️⃣ Criando socket...');
        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Teste', 'Chrome', '1.0.0'],
            syncFullHistory: false,
        });
        console.log('   ✅ Socket criado.');

        console.log('5️⃣ Registrando eventos...');
        sock.ev.on('connection.update', async (update) => {
            console.log('   🔔 Evento connection.update:', JSON.stringify(update, null, 2));
            const { qr, connection } = update;
            if (qr) {
                console.log('   📲 QR Code recebido! Gerando imagem...');
                currentQR = await qrcode.toDataURL(qr);
            }
            if (connection === 'open') {
                console.log('   ✅ Conectado!');
                currentQR = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);
        console.log('6️⃣ Eventos registrados. Aguardando QR...');
    } catch (err) {
        console.error('💥 Erro em connect():', err);
    }
}

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<img src="${currentQR}" style="width:300px;">`);
    } else {
        res.send('Aguardando QR... (log no servidor)');
    }
});

app.get('/status', (req, res) => {
    res.json({ qr: !!currentQR, connected: sock?.user ? true : false });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connect();
});