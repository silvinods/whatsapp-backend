const express = require("express");
const cors = require("cors");
const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode");

const app = express();
app.use(cors());
app.use(express.json());

let client = null;
let qrBase64 = null;
let status = "offline";

let respostas = {
  oi: "Olá! Este é um atendimento automático.",
  menu: "Menu:\n1 - Horário\n2 - Suporte\n3 - Atendente"
};

// =======================
// INICIAR BOT
// =======================

function startBot() {

  if (client) return;

  client = new Client({
    authStrategy: new LocalAuth()
  });

  client.on("qr", async (qr) => {

    console.log("QR recebido");

    qrBase64 = await qrcode.toDataURL(qr);
    status = "qr";

  });

  client.on("ready", () => {

    console.log("Bot online");

    status = "online";

  });

  client.on("disconnected", () => {

    console.log("Bot desconectado");

    status = "offline";
    client = null;

  });

  client.on("message", (msg) => {

    // ignorar grupos
    if (msg.from.includes("@g.us")) return;

    const texto = msg.body.toLowerCase();

    if (respostas[texto]) {
      msg.reply(respostas[texto]);
    }

  });

  client.initialize();
}

// =======================
// PARAR BOT
// =======================

function stopBot() {

  if (client) {

    client.destroy();
    client = null;
    status = "offline";

  }

}

// =======================
// API
// =======================

app.get("/", (req, res) => {
  res.send("Backend rodando");
});

app.get("/status", (req, res) => {
  res.json({ status });
});

app.get("/qr", (req, res) => {
  res.json({ qr: qrBase64 });
});

app.get("/start", (req, res) => {

  startBot();

  res.json({ ok: true });

});

app.get("/stop", (req, res) => {

  stopBot();

  res.json({ ok: true });

});

app.get("/respostas", (req, res) => {
  res.json(respostas);
});

app.post("/respostas", (req, res) => {

  respostas = req.body;

  res.json({ ok: true });

});

// =======================
// PORTA PARA RAILWAY
// =======================

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log("Servidor rodando");

});