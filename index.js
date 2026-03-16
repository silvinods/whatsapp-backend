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
let botAtivo = true; // estado atual do bot (ligado/desligado)

// Função para obter o número do bot (para comparar com remetente)
async function getBotNumber() {
    if (!client) return null;
    const info = await client.info;
    return info.wid._serialized;
}

// Inicializa o cliente WhatsApp
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
        console.log('QR Code gerado');
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', async () => {
        console.log('Bot pronto!');
        botReady = true;
        currentQR = null;
        const numero = await getBotNumber();
        console.log('Número do bot:', numero);
    });

    client.on('message', async (message) => {
        if (message.from.includes('@g.us')) return; // ignora grupos
        if (message.fromMe) return; // ignora próprias mensagens

        const texto = message.body.toLowerCase().trim();
        console.log(`Mensagem de ${message.from}: ${texto}`);

        // Verifica se é o dono (mesmo número do bot)
        const botNumber = await getBotNumber();
        const isOwner = message.from === botNumber;

        if (isOwner) {
            // Comandos do dono (sempre funcionam, independente do botAtivo)
            if (texto === '!desligar' || texto === '!off') {
                botAtivo = false;
                await message.reply('🔴 Bot desativado. Não responderei a ninguém.');
                console.log('Bot desativado pelo dono via mensagem');
                return;
            }
            if (texto === '!ligar' || texto === '!on') {
                botAtivo = true;
                await message.reply('🟢 Bot ativado.');
                console.log('Bot ativado pelo dono via mensagem');
                return;
            }
        }

        // Se não for dono, e o bot estiver desativado, ignora
        if (!botAtivo) {
            console.log('Bot desativado, ignorando mensagem');
            return;
        }

        // Se chegou aqui, é porque o bot está ativo e a mensagem é de outra pessoa.
        // Por padrão, não respondemos nada (apenas log). Se quiser respostas automáticas, descomente abaixo.
        // await message.reply('Olá! Em breve retornarei.');
    });

    client.initialize();
}

// Rotas para o frontend
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR, botAtivo });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="display:flex;justify-content:center;align-items:center;height:100vh;">
            <img src="${currentQR}" style="width:300px;">
        </body></html>`);
    } else {
        res.status(404).send('QR não disponível');
    }
});

// Rota para ligar/desligar via frontend
app.post('/toggle', (req, res) => {
    botAtivo = !botAtivo;
    console.log(`Bot ${botAtivo ? 'ativado' : 'desativado'} via frontend`);
    res.json({ botAtivo });
});

app.get('/', (req, res) => {
    res.send('Bot rodando');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    iniciarBot();
});