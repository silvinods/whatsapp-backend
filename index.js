const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

let client = null;
let currentQR = null;
let botReady = false;
let botAtivo = true;

// Função para normalizar texto (remove acentos e pontuação)
function normalizarTexto(texto) {
    return texto
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove acentos
        .replace(/[^\w\s]/g, ''); // remove pontuação (mantém letras, números, espaços)
}

async function getBotNumber() {
    if (client && botReady) {
        const info = await client.info;
        return info.wid._serialized;
    }
    return null;
}

function iniciarBot() {
    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--no-zygote',
                '--single-process'
            ]
        }
    });

    client.on('qr', async (qr) => {
        console.log('📲 QR Code gerado');
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log('✅ Bot pronto!');
        botReady = true;
        currentQR = null;
    });

    client.on('message', async (message) => {
        // Filtros importantes
        if (message.from.includes('@g.us')) return; // ignora grupos
        if (message.fromMe) return; // ignora próprias mensagens
        if (message.type !== 'chat') return; // ignora status, mídia, etc.
        if (!message.body) return; // ignora mensagens sem texto

        const textoOriginal = message.body;
        const texto = normalizarTexto(textoOriginal);
        console.log(`📩 Mensagem de ${message.from}: original="${textoOriginal}", normalizada="${texto}"`);

        const info = await client.info;
        const isOwner = message.from === info.wid._serialized;

        // Comandos do dono
        if (isOwner) {
            if (texto === '!desligar' || texto === '!off' || texto === 'desligar' || texto === 'off') {
                botAtivo = false;
                await message.reply('🔴 Bot desativado.');
                console.log('🔴 Bot desativado pelo dono');
                return;
            }
            if (texto === '!ligar' || texto === '!on' || texto === 'ligar' || texto === 'on') {
                botAtivo = true;
                await message.reply('🟢 Bot ativado.');
                console.log('🟢 Bot ativado pelo dono');
                return;
            }
        }

        if (!botAtivo) {
            console.log('🤖 Bot desativado, ignorando mensagem');
            return;
        }

        // Respostas automáticas (chaves já normalizadas)
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

        let resposta = null;
        for (const [key, value] of Object.entries(respostas)) {
            if (texto.includes(key)) {
                resposta = value;
                break;
            }
        }

        if (!resposta) {
            resposta = 'Desculpe, não entendi. Digite "ajuda" para ver os comandos.';
        }

        await message.reply(resposta);
        console.log('✅ Resposta enviada');
    });

    client.initialize();
}

// Rotas da API
app.get('/status', async (req, res) => {
    const numeroBot = botReady ? (await client.info).wid._serialized : null;
    res.json({
        ready: botReady,
        qr: !!currentQR,
        botAtivo: botAtivo,
        numeroBot: numeroBot
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

app.post('/toggle', (req, res) => {
    const { ativo } = req.body;
    if (typeof ativo === 'boolean') {
        botAtivo = ativo;
        console.log(`Bot ${ativo ? 'ativado' : 'desativado'} via API`);
        res.json({ success: true, botAtivo });
    } else {
        res.status(400).json({ error: 'Parâmetro "ativo" booleano obrigatório' });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot WhatsApp rodando. Acesse /qr para conectar e /status para ver estado.');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    iniciarBot();
});