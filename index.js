const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const SESSION_DIR = path.join(__dirname, 'auth_info');

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let sock = null;
let currentQR = null;
let botReady = false;

async function connectWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['Bot Silvino', 'Chrome', '1.0.0']
    });

    // Listener para erros internos (evita crash)
    sock.ev.on('error', (err) => {
        console.error('⚠️ Erro ignorado (Baileys):', err);
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📲 QR gerado');
            currentQR = await qrcode.toDataURL(qr);
            botReady = false;
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada, reconectar?', shouldReconnect);
            botReady = false;
            currentQR = null;
            if (shouldReconnect) setTimeout(connectWhatsApp, 5000);
        } else if (connection === 'open') {
            console.log('✅ Bot pronto!');
            botReady = true;
            currentQR = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid.endsWith('@g.us')) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;

        console.log(`📩 Mensagem de ${from}: "${text}"`);

        if (text.toLowerCase() === 'oi') {
            await sock.sendMessage(from, { text: 'Olá! Atendimento automático.' });
        } else if (text.toLowerCase() === 'menu') {
            await sock.sendMessage(from, { text: '1 - Suporte\n2 - Horários' });
        } else if (text) {
            // echo para teste
            await sock.sendMessage(from, { text: `Eco: "${text}"` });
        }
    });
}

app.get('/status', (req, res) => res.json({ ready: botReady, qr: !!currentQR }));
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;"><div style="background:#fff;padding:20px;"><img src="${currentQR}" style="width:300px;"></div></body></html>`);
    } else {
        res.status(404).send('QR não disponível');
    }
});
app.get('/', (req, res) => res.send('Bot rodando'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    connectWhatsApp();
});