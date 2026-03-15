const { Client, LocalAuth } = require('whatsapp-web.js');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

let client = null;
let currentQR = null;
let botReady = false;
let starting = false;

function startBot() {
    if (client || starting) return;
    starting = true;

    console.log("--- INICIANDO BOT SILVINO ---");

    // Tenta encontrar o Chrome em caminhos comuns do Railway/Nixpacks
    const paths = [
        '/usr/bin/google-chrome',
        '/usr/bin/google-chrome-stable',
        '/nix/store/*/bin/google-chrome'
    ];
    
    // Procura o primeiro caminho que realmente existe no servidor
    let executablePath = paths.find(p => fs.existsSync(p));

    console.log(executablePath ? `Navegador encontrado em: ${executablePath}` : "Usando caminho padrao do sistema...");

    client = new Client({
        authStrategy: new LocalAuth(),
        puppeteer: {
            headless: true,
            executablePath: executablePath || undefined,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--no-zygote",
                "--single-process"
            ]
        }
    });

    client.initialize().catch(err => {
        console.error("ERRO CRITICO AO INICIAR:", err);
        starting = false;
    });

    client.on('qr', async (qr) => {
        console.log("QR CODE GERADO Silvino - Acesse a rota /qr");
        currentQR = await qrcode.toDataURL(qr);
    });

    client.on('ready', () => {
        console.log("BOT PRONTO E CONECTADO!");
        botReady = true;
        currentQR = null;
        starting = false;
    });

    client.on('message', async (msg) => {
        if (msg.from.includes('@g.us')) return;
        const texto = msg.body.toLowerCase();
        if (texto === 'oi') msg.reply('Olá! Atendimento automático Silvino.');
        if (texto === 'menu') msg.reply('1 - Suporte\n2 - Horários');
    });
}

// Rotas
app.get('/status', (req, res) => {
    res.json({ ready: botReady, qr: !!currentQR, starting: starting });
});

app.get('/qr', (req, res) => {
    if (currentQR) {
        res.send(`<html><body style="background:#000;display:flex;justify-content:center;align-items:center;height:100vh;">
            <div style="background:#fff;padding:20px;border-radius:10px;text-align:center;">
                <h2>Escaneie o QR Code</h2>
                <img src="${currentQR}" style="width:300px;">
                <p>Atualize a pagina se o celular nao ler.</p>
            </div>
        </body></html>`);
    } else {
        res.send("QR Code ainda nao gerado. Aguarde 1 minuto e atualize a pagina.");
    }
});

app.get('/', (req, res) => res.send("Servidor Ativo Silvino Soares"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor rodando na porta ${PORT}`);
    startBot();
});