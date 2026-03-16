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
        browser: ['Bot Teste', 'Chrome', '1.0.0']
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('📲 QR Code gerado');
            currentQR = await qrcode.toDataURL(qr);
            botReady = false;
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);
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
        // Ignora mensagens enviadas pelo próprio bot e mensagens de grupo
        if (!msg.message || msg.key.fromMe) return;
        if (msg.key.remoteJid.endsWith('@g.us')) return;

        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const from = msg.key.remoteJid;

        console.log(`📩 Mensagem recebida de ${from}: "${text}"`);

        // Responde com um eco para QUALQUER texto (teste)
        if (text) {
            try {
                await sock.sendMessage(from, { text: `Você disse: "${text}"` });
                console.log('✅ Resposta enviada (eco)');
            } catch (err) {
                console.error('❌ Erro ao enviar resposta:', err);
            }
        }
    });
}

app.get('/status', (req, res) => res.json({ ready: botReady, qr: !!currentQR }));
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;"><div style="background:#fff;padding:20px;"><img src="${currentQR}" style="width:300px;"></div></body></html>`);
    } else {
        res.status(404).send('QR não disponível');
    }
});
app.get('/', (req, res) => res.send('Bot rodando - modo eco'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connectWhatsApp();
});