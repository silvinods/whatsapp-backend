const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const qrcode = require('qrcode');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;
const REGRAS_FILE = path.join(__dirname, 'regras.json');

// Carrega regras do arquivo, se existir
let regras = {};
if (fs.existsSync(REGRAS_FILE)) {
    try {
        regras = JSON.parse(fs.readFileSync(REGRAS_FILE, 'utf8'));
    } catch (e) {
        console.error('Erro ao ler regras.json', e);
    }
}

let client = null;
let currentQR = null;
let botReady = false;
let botAtivo = true;

// Função para salvar regras
function salvarRegras() {
    fs.writeFileSync(REGRAS_FILE, JSON.stringify(regras, null, 2));
}

// Função para obter número do bot
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
        // Ignora mensagens de status (tipo "status@broadcast")
        if (message.from.includes('@status') || message.from.includes('@broadcast')) {
            return;
        }
        if (message.from.includes('@g.us')) return; // grupos
        if (message.fromMe) return; // próprias mensagens

        const texto = message.body.toLowerCase().trim();
        console.log(`📩 Mensagem de ${message.from}: ${texto}`);

        // Verifica se é o dono
        const info = await client.info;
        const isOwner = message.from === info.wid._serialized;

        // Comandos do dono por mensagem
        if (isOwner) {
            if (texto === '!desligar' || texto === '!off') {
                botAtivo = false;
                await message.reply('🔴 Bot desativado.');
                console.log('🔴 Bot desativado pelo dono');
                return;
            }
            if (texto === '!ligar' || texto === '!on') {
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

        // Busca resposta nas regras (palavra-chave -> resposta)
        let resposta = null;
        for (const [palavra, resp] of Object.entries(regras)) {
            if (texto.includes(palavra)) {
                resposta = resp;
                break;
            }
        }

        // Se não encontrou, usa resposta padrão
        if (!resposta) {
            resposta = 'Desculpe, não entendi. Digite "ajuda" para ver os comandos.';
        }

        await message.reply(resposta);
        console.log('✅ Resposta enviada');
    });

    client.initialize();
}

// Rotas da API

// Status
app.get('/status', async (req, res) => {
    const numeroBot = botReady ? (await client.info).wid._serialized : null;
    res.json({
        ready: botReady,
        qr: !!currentQR,
        botAtivo,
        numeroBot
    });
});

// QR
app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
            <img src="${currentQR}" style="width:300px;">
        </body></html>`);
    } else {
        res.status(404).send('QR Code não disponível. Aguarde...');
    }
});

// Ligar/desligar via API
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

// Rotas para gerenciar regras
app.get('/regras', (req, res) => {
    res.json(regras);
});

app.post('/regras', (req, res) => {
    try {
        const novasRegras = req.body;
        // Espera-se um objeto { palavra: resposta }
        if (typeof novasRegras === 'object' && novasRegras !== null) {
            regras = novasRegras;
            salvarRegras();
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Formato inválido' });
        }
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Rota para adicionar/atualizar uma regra específica
app.post('/regras/:palavra', (req, res) => {
    const { palavra } = req.params;
    const { resposta } = req.body;
    if (!palavra || !resposta) {
        return res.status(400).json({ error: 'Palavra e resposta são obrigatórios' });
    }
    regras[palavra] = resposta;
    salvarRegras();
    res.json({ success: true });
});

// Rota para deletar uma regra
app.delete('/regras/:palavra', (req, res) => {
    const { palavra } = req.params;
    if (regras.hasOwnProperty(palavra)) {
        delete regras[palavra];
        salvarRegras();
        res.json({ success: true });
    } else {
        res.status(404).json({ error: 'Palavra não encontrada' });
    }
});

app.get('/', (req, res) => {
    res.send('✅ Bot WhatsApp rodando. Acesse /qr para conectar e /status para ver estado.');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    iniciarBot();
});