// CORREÇÃO CRÍTICA: garante que o crypto esteja disponível globalmente
const crypto = require('crypto');
global.crypto = crypto;

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const express = require('express');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;
const SESSION_DIR = path.join(__dirname, 'auth_info');

if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

let sock = null;
let currentQR = null;
let botAtivo = true;

// ========== FUNÇÃO PARA OBTER O NÚMERO DO BOT ==========
function getBotNumber() {
    return sock?.user?.id ? sock.user.id.split(':')[0] + '@s.whatsapp.net' : null;
}

// ========== RESPOSTAS AUTOMÁTICAS ==========
const respostas = {
    'oi': 'Olá! Como posso ajudar?',
    'ola': 'Olá! Como posso ajudar?',
    'nino': 'Olá! O Silvino não está no momento, mas deixe sua mensagem que ele retorna assim que possível.',
    'esta em casa': 'O Silvino não está em casa agora. Deixe seu recado!',
    'ta por onde': 'Ele não está por perto no momento. Em que posso ajudar?',
    'vem aqui': 'Infelizmente ele não pode ir agora. Deixe sua mensagem.',
    'oi meu anjo': 'Olá! 😊 Como posso ajudar você?',
    'bom dia': 'Bom dia! Em que posso ser útil?',
    'boa tarde': 'Boa tarde! Como posso ajudar?',
    'boa noite': 'Boa noite! Em que posso auxiliar?',
    'menu': '📋 *Menu de opções*\n1 - Informações\n2 - Suporte\n3 - Horários',
    'ajuda': 'Comandos disponíveis: oi, menu, info, suporte, horarios, contato',
    'tchau': 'Até logo! Se precisar, estou aqui.',
    'obrigado': 'Por nada! Estou à disposição.'
};

// ========== CONEXÃO COM WHATSAPP ==========
async function connectWhatsApp() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

        sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: ['Bot Silvino', 'Chrome', '1.0.0'],
            syncFullHistory: false,
            markOnlineOnConnect: true
        });

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                console.log('📲 QR Code gerado!');
                currentQR = await qrcode.toDataURL(qr);
            }

            if (connection === 'close') {
                const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
                console.log('❌ Conexão fechada. Reconectar?', shouldReconnect);
                currentQR = null;
                if (shouldReconnect) {
                    setTimeout(connectWhatsApp, 5000);
                }
            } else if (connection === 'open') {
                console.log('✅ Bot pronto e conectado!');
                console.log('📞 Número do bot:', getBotNumber());
                currentQR = null;
            }
        });

        sock.ev.on('creds.update', saveCreds);

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
                const lowerText = text.toLowerCase().trim();

                console.log(`📩 Mensagem de ${from}: "${text}"`);

                // Verifica se é o dono (mesmo número do bot)
                const isOwner = from === getBotNumber();

                // Comandos do dono (só funcionam se enviados do próprio número do bot)
                if (isOwner) {
                    if (lowerText === '!desligar' || lowerText === '!off') {
                        botAtivo = false;
                        await sock.sendMessage(from, { text: '🔴 Bot desativado.' });
                        console.log('🔴 Bot desativado');
                        return;
                    }
                    if (lowerText === '!ligar' || lowerText === '!on') {
                        botAtivo = true;
                        await sock.sendMessage(from, { text: '🟢 Bot ativado.' });
                        console.log('🟢 Bot ativado');
                        return;
                    }
                }

                // Se o bot estiver desligado, não responde ninguém (exceto comandos do dono, já tratados)
                if (!botAtivo) {
                    console.log('🤖 Bot desligado, ignorando mensagem');
                    return;
                }

                // Busca resposta automática
                let resposta = null;
                for (const [key, value] of Object.entries(respostas)) {
                    if (lowerText.includes(key)) {
                        resposta = value;
                        break;
                    }
                }

                if (!resposta) {
                    resposta = 'Desculpe, não entendi. Digite "ajuda" para ver os comandos.';
                }

                await sock.sendMessage(from, { text: resposta });
                console.log(`✅ Resposta enviada para ${from}`);

            } catch (err) {
                console.error('❌ Erro ao processar mensagem:', err);
            }
        });

    } catch (err) {
        console.error('💥 Erro fatal na conexão:', err);
        setTimeout(connectWhatsApp, 10000);
    }
}

// ========== ROTAS PARA O FRONTEND ==========
app.get('/status', (req, res) => {
    res.json({
        ready: sock?.user ? true : false,
        qr: !!currentQR,
        botAtivo,
        numeroBot: getBotNumber()
    });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
            <img src="${currentQR}" style="width:300px;">
        </body></html>`);
    } else {
        res.status(404).send('QR Code não disponível. Aguarde...');
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot WhatsApp rodando. Acesse /qr para conectar e /status para ver estado.');
});

// ========== INICIALIZAÇÃO ==========
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    connectWhatsApp();
});