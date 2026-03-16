const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

// ==================== CONFIGURAÇÕES ====================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');
const RESET_KEY = '123'; // 🔐 Chave simples para segurança (mude se quiser)

// Garante que a pasta de sessão existe
if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

// ==================== TRATAMENTO GLOBAL DE ERROS ====================
process.on('uncaughtException', (err) => {
    console.error('🔥 Exceção não capturada (ignorada):', err);
});
process.on('unhandledRejection', (err) => {
    console.error('🔥 Rejeição não tratada (ignorada):', err);
});

// ==================== ESTADO DO BOT ====================
let sock = null;
let currentQR = null;
let botReady = false;

// ==================== FUNÇÃO PRINCIPAL DE CONEXÃO ====================
async function connectWhatsApp() {
    try {
        console.log('🔄 Iniciando conexão com WhatsApp...');
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Silvino', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        sock.ev.on('error', (err) => {
            console.error('⚠️ Erro interno do Baileys (ignorado):', err);
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📲 QR Code gerado!');
                currentQR = await qrcode.toDataURL(qr);
                botReady = false;
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);
                botReady = false;
                currentQR = null;
                if (shouldReconnect) {
                    setTimeout(connectWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ Bot pronto e conectado!');
                botReady = true;
                currentQR = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);

        // ========== PROCESSAMENTO DE MENSAGENS ==========
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

                // ===== RESPOSTAS AUTOMÁTICAS =====
                let resposta = null;
                if (text.toLowerCase() === 'oi') {
                    resposta = 'Olá! Atendimento automático Silvino.';
                } else if (text.toLowerCase() === 'menu') {
                    resposta = '1 - Suporte\n2 - Horários';
                } else if (text.toLowerCase() === 'status') {
                    resposta = 'Bot está online e funcionando!';
                } else {
                    return; // ignora mensagens não reconhecidas
                }

                if (resposta) {
                    try {
                        const sent = await sock.sendMessage(from, { text: resposta });
                        console.log(`✅ Resposta enviada! ID: ${sent.key.id}`);
                    } catch (sendErr) {
                        console.error('❌ Falha no envio:', sendErr);
                    }
                }
            } catch (err) {
                console.error('❌ Erro ao processar mensagem:', err);
            }
        });

    } catch (err) {
        console.error('💥 Erro na inicialização:', err);
        setTimeout(connectWhatsApp, 10000);
    }
}

// ==================== ROTAS DA API ====================

// Rota de status
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR });
});

// Rota do QR code
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html>
            <body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;">
                <div style="background:#fff;padding:20px;border-radius:10px;">
                    <img src="${currentQR}" style="width:300px;">
                </div>
            </body>
        </html>`);
    } else {
        res.status(404).send('QR Code não disponível. Aguarde...');
    }
});

// 🚀 ROTA DE RESET (com chave de segurança)
app.get('/reset', (req, res) => {
    const key = req.query.key;
    
    if (key !== RESET_KEY) {
        return res.status(403).send('Chave inválida!');
    }

    try {
        // Remove a pasta de sessão
        if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log('🗑️ Pasta de sessão removida via /reset');
        }

        // Desconecta o socket se estiver ativo
        if (sock) {
            sock.end();
            sock = null;
        }
        
        botReady = false;
        currentQR = null;

        // Reinicia o processo de conexão
        setTimeout(connectWhatsApp, 2000);

        res.send('✅ Sessão resetada! Acesse /qr em alguns segundos para escanear o novo código.');
    } catch (err) {
        console.error('Erro ao resetar:', err);
        res.status(500).send('Erro ao resetar sessão.');
    }
});

// Rota raiz
app.get('/', (req, res) => {
    res.send('✅ Bot rodando. Acesse /qr para conectar ou /reset?key=123 para resetar.');
});

// ==================== INICIALIZAÇÃO ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor na porta ${PORT}`);
    connectWhatsApp();
});