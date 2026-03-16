const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino'); // opcional: reduzir logs

// ==================== CONFIGURAÇÕES ====================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');
const RESET_KEY = '123';

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ==================== TRATAMENTO DE ERROS ====================
process.on('uncaughtException', (err) => console.error('🔥 Exceção:', err));
process.on('unhandledRejection', (err) => console.error('🔥 Rejeição:', err));

// ==================== ESTADO ====================
let sock = null;
let currentQR = null;
let botReady = false;

// ==================== CONEXÃO WHATSAPP ====================
async function connectWhatsApp() {
    try {
        // Busca a versão mais recente compatível
        const { version, isLatest } = await fetchLatestBaileysVersion();
        console.log(`📦 Versão do Baileys: ${version.join('.')} (última: ${isLatest})`);

        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Silvino', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true,
            defaultQueryTimeoutMs: 60000, // aumenta timeout
            logger: pino({ level: 'silent' }) // silencia logs internos (opcional)
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

        // ========== PROCESSAR MENSAGENS ==========
        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return;
                if (msg.key.remoteJid.endsWith('@g.us')) return;

                const text = msg.message.conversation ||
                            msg.message.extendedTextMessage?.text ||
                            msg.message.imageMessage?.caption ||
                            '';
                const from = msg.key.remoteJid;

                console.log(`📩 Mensagem de ${from}: "${text}"`);

                // Comandos (adicione quantos quiser)
                const lowerText = text.toLowerCase();
                let resposta = null;
                if (lowerText === 'oi') resposta = 'Olá! Atendimento automático Silvino.';
                else if (lowerText === 'menu') resposta = '1 - Suporte\n2 - Horários';
                else if (lowerText === 'status') resposta = 'Bot online e funcionando!';
                else return;

                const sent = await sock.sendMessage(from, { text: resposta });
                console.log(`✅ Resposta enviada, ID: ${sent.key.id}`);
            } catch (err) {
                console.error('❌ Erro ao processar mensagem:', err);
            }
        });

    } catch (err) {
        console.error('💥 Erro fatal na conexão:', err);
        setTimeout(connectWhatsApp, 10000);
    }
}

// ==================== ROTAS ====================
app.get('/status', (req, res) => res.json({ ready: botReady, qr: !!currentQR }));

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="background:#fff;padding:20px;border-radius:10px;">
                <img src="${currentQR}" style="width:300px;">
            </div></body></html>`);
    } else {
        res.status(404).send('QR não disponível');
    }
});

app.get('/reset', (req, res) => {
    if (req.query.key !== RESET_KEY) return res.status(403).send('Chave inválida');
    try {
        if (fs.existsSync(SESSION_DIR)) fs.rmSync(SESSION_DIR, { recursive: true, force: true });
        if (sock) sock.end();
        botReady = false;
        currentQR = null;
        setTimeout(connectWhatsApp, 2000);
        res.send('✅ Sessão resetada. Acesse /qr em instantes.');
    } catch (err) {
        res.status(500).send('Erro ao resetar');
    }
});

app.get('/', (req, res) => res.send('✅ Bot rodando. Acesse /qr ou /reset?key=123'));

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    connectWhatsApp();
});