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

const PORT = process.env.PORT || 10000; // Render usa 10000 como padrão
const SESSION_DIR = path.join(__dirname, 'auth_info'); // pasta para salvar a sessão

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

        // ========== LISTENER DE ERROS INTERNOS DO BAILEYS ==========
        sock.ev.on('error', (err) => {
            console.error('⚠️ Erro interno do Baileys (ignorado):', err);
        });

        // ========== ATUALIZAÇÕES DE CONEXÃO ==========
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

        // ========== SALVAR CREDENCIAIS (SESSÃO) ==========
        sock.ev.on('creds.update', saveCreds);

        // ========== PROCESSAMENTO DE MENSAGENS ==========
        sock.ev.on('messages.upsert', async ({ messages }) => {
            try {
                const msg = messages[0];
                if (!msg.message || msg.key.fromMe) return; // ignora mensagens do próprio bot
                if (msg.key.remoteJid.endsWith('@g.us')) return; // ignora grupos

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
                    // Opcional: ignorar mensagens não reconhecidas
                    return;
                }

                if (resposta) {
                    // Tenta enviar a mensagem e loga o resultado detalhadamente
                    try {
                        const sent = await sock.sendMessage(from, { text: resposta });
                        console.log(`✅ Resposta enviada com sucesso! ID: ${sent.key.id}, para: ${sent.key.remoteJid}`);
                    } catch (sendErr) {
                        console.error('❌ Falha no envio da mensagem:', sendErr);
                    }
                }
            } catch (err) {
                console.error('❌ Erro ao processar mensagem (ignorado):', err);
            }
        });

    } catch (err) {
        console.error('💥 Erro na inicialização do socket:', err);
        setTimeout(connectWhatsApp, 10000); // tenta reconectar após 10s
    }
}

// ==================== ROTAS DA API ====================
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR });
});

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
        res.status(404).send('QR Code não disponível no momento. Aguarde...');
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot Silvino rodando. Acesse /status e /qr.');
});

// ==================== INICIALIZAÇÃO DO SERVIDOR ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connectWhatsApp(); // inicia o bot
});