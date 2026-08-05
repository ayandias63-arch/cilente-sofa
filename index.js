require("dotenv").config();

const dns = require("dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { MongoClient } = require("mongodb");
const qrcode = require("qrcode-terminal");
const QRCode = require("qrcode");
const PDFDocument = require("pdfkit");
const pino = require("pino");

const {
  default: makeWASocket,
  DisconnectReason,
  downloadMediaMessage,
  isJidBroadcast,
  Browsers,
} = require("@whiskeysockets/baileys");

const { useMongoAuthState } = require("./mongoAuthState");

const OpenAI = require("openai");

const app = express();

app.use(cors());
app.use(express.json());

/* ======================================================
   LOGGER
====================================================== */

const logger = pino({ level: "silent" });

/* ======================================================
   OPENAI
====================================================== */

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ======================================================
   PROMPT SISTEMA
====================================================== */
const PROMPT_SISTEMA = `
Você é um vendedor profissional de uma loja especializada em sofás sob medida. Seu objetivo é oferecer um atendimento de excelência, entender a necessidade do cliente, apresentar as melhores opções e conduzir a conversa até a venda de forma natural.

IMPORTANTE:
- Nunca diga que você é uma inteligência artificial, robô ou assistente virtual.
- Responda sempre em português do Brasil.
- Seja educado, simpático, paciente e profissional.
- Responda de forma objetiva, mas acolhedora.
- Nunca invente informações.
- Caso não saiba responder alguma pergunta específica, informe educadamente que um vendedor da loja dará continuidade ao atendimento.

========================
INFORMAÇÕES DA LOJA
========================

📍 Endereço:
Rua Piauí, 922
Bairro Vila Nova

🚚 Realizamos entregas.

🕗 Horário de atendimento:
Segunda-feira a sábado
Das 08:00 às 17:00.

========================
SOBRE OS SOFÁS
========================

Todos os sofás são fabricados sob medida.

Valor:
R$ 1.100,00 por metro.

Sempre que o cliente informar a medida desejada, calcule automaticamente o valor.

Exemplos:

2,00 m = R$ 2.200,00

2,20 m = R$ 2.420,00

2,50 m = R$ 2.750,00

2,80 m = R$ 3.080,00

3,00 m = R$ 3.300,00

========================
ATENDIMENTO
========================

Ao iniciar uma conversa seja cordial.

Exemplo:

"Olá! Seja muito bem-vindo(a)! 😊
Será um prazer ajudar você a encontrar o sofá ideal.

Posso mostrar nossos modelos, calcular o valor conforme a medida desejada e esclarecer qualquer dúvida."

Primeiro descubra a necessidade do cliente.

Faça perguntas como:

• Qual modelo você procura?

• Qual medida precisa?

• Qual cor prefere?

• O sofá será para casa, apartamento ou outro ambiente?

Nunca responda apenas o preço.

Explique sempre os benefícios e ajude o cliente na escolha.

========================
CATÁLOGO
========================

Quando o cliente pedir:

- fotos
- modelos
- catálogo
- imagens
- sofá
- quero ver os modelos

Envie as imagens disponíveis da pasta "imagens".

Após enviar as fotos pergunte:

"Qual modelo você mais gostou?"

Depois pergunte:

"Qual a medida desejada?"

Em seguida calcule automaticamente o valor.

========================
OBJETIVO
========================

Seu objetivo é transformar cada atendimento em uma venda.

Conduza a conversa naturalmente.

Tire dúvidas.

Mostre interesse pelo cliente.

Sempre incentive a continuar o atendimento.

Quando perceber interesse na compra pergunte se deseja prosseguir com o pedido.

========================
LOCALIZAÇÃO
========================

Sempre que perguntarem onde fica a loja informe:

Rua Piauí, 922
Bairro Vila Nova.

Informe também que realizamos entregas.

========================
COMPORTAMENTO
========================

Se o cliente enviar áudio, responda normalmente.

Se enviar imagem relacionada a sofá, analise e responda de forma útil.

Se perguntarem sobre pagamento ou qualquer informação que não foi fornecida, informe educadamente que um vendedor confirmará todos os detalhes.

Nunca seja grosseiro.

Nunca discuta com o cliente.

Nunca forneça informações falsas.

Seu objetivo é oferecer um atendimento humano, profissional e aumentar as vendas da loja.
`;
/* ======================================================
   VARIÁVEIS GLOBAIS
====================================================== */

let sock;
let latestQr = null;
let connectionState = "starting";
let authResetInProgress = false;
let pairingFlowActive = false;
const conversas = {};
const atendimentosHumanos = new Set();
const idsMensagensDoBot = new Set();
let authCollection = null;
let mongoClient = null;
const ENDERECO_YAN = "AVENIDA ADELINO FERREIRA JARDIN NUMERO 80 APARTAMENTO 304 PORO ALEGRE RIO GRANDE DO SUL";
const PASTA_PDFS_TEMPORARIOS = path.join(__dirname, "pdfs-temp");
const PASTA_AUDIOS_TEMPORARIOS = path.join(__dirname, "audios-temp");

// Pasta onde ficam as fotos dos modelos de sofá (catálogo de imagens).
const PASTA_IMAGENS_CATALOGO = path.join(__dirname, "imagenes");

// Extensões de imagem aceitas ao ler a pasta do catálogo.
const EXTENSOES_IMAGEM_VALIDAS = /\.(jpe?g|png|webp)$/i;

// Palavras-chave que, ao serem digitadas pelo cliente, disparam o envio
// automático de todas as fotos do catálogo.
const PALAVRAS_CATALOGO = [
  "catalogo",
  "fotos",
  "foto",
  "imagens",
  "imagem",
  "modelos",
  "sofa",
  "sofas",
  "quero ver os modelos",
  "quero ver os sofas",
  "mostrar modelos",
];

// Preço, em reais, cobrado por metro de sofá sob medida.
const PRECO_POR_METRO = 1100;
const MODELO_TRANSCRICAO_AUDIO =
  process.env.OPENAI_TRANSCRIPTION_MODEL || "whisper-1";
const MODELO_VOZ_AUDIO =
  process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
const VOZ_AUDIO =
  process.env.OPENAI_TTS_VOICE || "alloy";

function obterIdsDaConversa(message) {
  return [message.key.remoteJid, message.key.remoteJidAlt].filter(Boolean);
}

// Marca un mensaje enviado por el propio bot para no confundirlo
// con una intervención manual del humano cuando llegue el eco por messages.upsert.
function marcarComoEnviadoPeloBot(sentMsg) {
  if (sentMsg?.key?.id) {
    idsMensagensDoBot.add(sentMsg.key.id);
  }
}

async function conectarMongoDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set");
  }

  const dbName = process.env.MONGODB_DB || "bot-anuncios";

  mongoClient = new MongoClient(uri);

  await mongoClient.connect();
  const db = mongoClient.db(dbName);
  authCollection = db.collection("auth_sessions");

  console.log("✅ Conectado ao MongoDB");
}

async function limparAuthMongo() {
  if (authCollection) {
    await authCollection.deleteMany({});
    console.log("🧹 Sessão de autenticação do WhatsApp resetada no MongoDB");
  }
}


/* ======================================================
   GERAR PDF DE PROPOSTA
====================================================== */

function gerarPDF(dadosAgendamento) {

  return new Promise((resolve, reject) => {

    try {

      if (!fs.existsSync(PASTA_PDFS_TEMPORARIOS)) {
        fs.mkdirSync(PASTA_PDFS_TEMPORARIOS, {
          recursive: true,
        });
      }

      const caminhoPDF =
        path.join(
          PASTA_PDFS_TEMPORARIOS,
          `proposta-yan-${Date.now()}.pdf`
        );

      const doc =
        new PDFDocument({
          margin: 50,
        });

      const stream =
        fs.createWriteStream(caminhoPDF);

      doc.pipe(stream);

      doc
        .fontSize(20)
        .text("Proposta de Automação - Yan", {
          align: "center",
        });

      doc.moveDown();

      doc
        .fontSize(12)
        .text("Yan Automações", {
          align: "center",
        });

      doc.moveDown(2);

      doc
        .fontSize(14)
        .text("Dados do Cliente", {
          underline: true,
        });

      doc.moveDown();

      doc.fontSize(12);
      doc.text(`Nome: ${dadosAgendamento.nome}`);
      doc.text(`Serviço: ${dadosAgendamento.servico}`);
      doc.text(`Data: ${dadosAgendamento.data}`);
      doc.text(`Horario: ${dadosAgendamento.horario}`);
      doc.text(`Localização: ${dadosAgendamento.localizacao}`);

      doc.moveDown(2);

      doc
        .fontSize(13)
        .text("Mensagem de confirmacao", {
          underline: true,
        });

      doc.moveDown();

      doc
        .fontSize(12)
        .text(dadosAgendamento.mensagem);

      doc.moveDown(2);

      doc
        .fontSize(10)
        .text(
          "Este documento foi gerado automaticamente pelo Consultor Virtual da Yan.",
          {
            align: "center",
          }
        );

      doc.end();

      stream.on("finish", () => {
        resolve(caminhoPDF);
      });

      stream.on("error", reject);

    } catch (erro) {

      reject(erro);

    }

  });
}

/* ======================================================
   ENVIAR PDF
====================================================== */

async function enviarPDF(numero, caminhoPDF, legenda) {
  try {
    const media = fs.readFileSync(caminhoPDF);
    const base64 = media.toString("base64");
    const mimeType = "application/pdf";

    const sentMsg = await sock.sendMessage(numero, {
      document: { url: caminhoPDF },
      fileName: path.basename(caminhoPDF),
      caption: legenda || "📄 Aqui está o documento solicitado.",
      mimetype: mimeType,
    });
    marcarComoEnviadoPeloBot(sentMsg);

    console.log("✅ PDF enviado!");

  } catch (erro) {
    console.log("❌ Erro ao enviar PDF:");
    console.log(erro);
  }
}

/* ======================================================
   LIMPAR PDF TEMPORARIO
====================================================== */

function limparPDFTemporario(caminhoPDF) {

  try {

    if (
      caminhoPDF &&
      caminhoPDF.startsWith(PASTA_PDFS_TEMPORARIOS) &&
      fs.existsSync(caminhoPDF)
    ) {

      fs.unlinkSync(caminhoPDF);

    }

  } catch (erro) {

    console.log("Nao foi possivel apagar PDF temporario:");
    console.log(erro);

  }
}

/* ======================================================
   AUDIO
====================================================== */

function garantirPastaTemporaria(pasta) {
  if (!fs.existsSync(pasta)) {
    fs.mkdirSync(pasta, {
      recursive: true,
    });
  }
}

function criarCaminhoAudioTemporario(extensao) {
  garantirPastaTemporaria(PASTA_AUDIOS_TEMPORARIOS);

  const nomeArquivo =
    `audio-${Date.now()}-${Math.random().toString(36).slice(2)}.${extensao}`;

  return path.join(PASTA_AUDIOS_TEMPORARIOS, nomeArquivo);
}

function limparArquivoTemporario(caminhoArquivo) {
  try {
    if (
      caminhoArquivo &&
      caminhoArquivo.startsWith(PASTA_AUDIOS_TEMPORARIOS) &&
      fs.existsSync(caminhoArquivo)
    ) {
      fs.unlinkSync(caminhoArquivo);
    }
  } catch (erro) {
    console.log("Nao foi possivel apagar arquivo temporario:");
    console.log(erro);
  }
}

async function transcreverAudio(message) {
  let caminhoAudio;

  try {
    const audioBuffer = await downloadMediaMessage(
      message,
      "buffer",
      {},
      {
        logger,
        reuploadRequest: sock.updateMediaMessage,
      }
    );
    caminhoAudio = criarCaminhoAudioTemporario("ogg");

    fs.writeFileSync(caminhoAudio, audioBuffer);

    const transcricao = await openai.audio.transcriptions.create({
      file: fs.createReadStream(caminhoAudio),
      model: MODELO_TRANSCRICAO_AUDIO,
      language: "pt",
    });

    return (transcricao.text || "").trim();
  } finally {
    limparArquivoTemporario(caminhoAudio);
  }
}

async function gerarAudioResposta(texto) {
  const fala = await openai.audio.speech.create({
    model: MODELO_VOZ_AUDIO,
    voice: VOZ_AUDIO,
    input: texto.slice(0, 4000),
    response_format: "opus",
  });

  return Buffer.from(await fala.arrayBuffer());
}

async function enviarResposta(numero, resposta, responderComAudio = false) {
  if (!responderComAudio) {
    const sentMsg = await sock.sendMessage(numero, {
      text: resposta,
    });
    marcarComoEnviadoPeloBot(sentMsg);
    return;
  }

  try {
    const audioBuffer = await gerarAudioResposta(resposta);

    const sentMsg = await sock.sendMessage(numero, {
      audio: audioBuffer,
      mimetype: "audio/ogg; codecs=opus",
      ptt: true,
    });
    marcarComoEnviadoPeloBot(sentMsg);
  } catch (erroAudio) {
    console.log("Erro ao gerar/enviar audio de resposta:");
    console.log(erroAudio);

    const sentMsg = await sock.sendMessage(numero, {
      text: resposta,
    });
    marcarComoEnviadoPeloBot(sentMsg);
  }
}

/* ======================================================
   UTILIDADES DE TEXTO
====================================================== */

function normalizarTexto(texto) {

  return (texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

}

function extrairServico(texto) {

  const servicos = [
    "Atendimento",
    "Vendas",
    "Leads",
    "Automacao",
    "CRM",
    "Agendamento",
  ];

  const textoNormalizado =
    normalizarTexto(texto);

  return (
    servicos.find((servico) =>
      textoNormalizado.includes(
        normalizarTexto(servico)
      )
    ) || "Automacao"
  );

}

function extrairData(texto) {

  const data =
    texto.match(/\b\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?\b/);

  return data ? data[0] : "Nao informada";

}

function extrairHorario(texto) {

  const horario =
    texto.match(/\b\d{1,2}[:h]\d{0,2}\b/i);

  return horario ? horario[0] : "Nao informado";

}

function extrairNome(texto) {

  const nome =
    texto.match(
      /(?:meu nome e|me chamo|sou|nome completo e)\s+([a-zA-ZÀ-ÿ\s]{3,80})/i
    );

  if (!nome) return "Cliente";

  return nome[1]
    .replace(/\s+/g, " ")
    .trim();

}

function montarDadosAgendamento(historico, resposta) {

  const textoCompleto =
    [
      ...historico.map((item) => item.content),
      resposta,
    ].join("\n");

  return {
    nome: extrairNome(textoCompleto),
    servico: extrairServico(textoCompleto),
    data: extrairData(textoCompleto),
    horario: extrairHorario(textoCompleto),
    localizacao: ENDERECO_YAN,
    mensagem:
      resposta ||
      "Sua proposta de automação foi confirmada com sucesso.",
  };

}

/* ======================================================
   CONFIRMACAO DE PROPOSTA
====================================================== */

function ehConfirmacaoProposta(resposta) {

  const texto =
    normalizarTexto(resposta);

  return (
    texto.includes("proposta confirmada") ||
    texto.includes("automacao confirmada") ||
    texto.includes("confirmo a proposta")
  );

}

async function enviarPDFProposta(numero, historico, resposta) {

  let caminhoPDF;

  try {

    const dadosAgendamento =
      montarDadosAgendamento(historico, resposta);

    caminhoPDF =
      await gerarPDF(dadosAgendamento);

    await enviarPDF(
      numero,
      caminhoPDF,
      "Aqui esta a confirmacao da sua proposta de automacao."
    );

  } catch (erro) {

    console.log("Erro ao gerar/enviar PDF de proposta:");
    console.log(erro);

  } finally {

    limparPDFTemporario(caminhoPDF);

  }
}

/* ======================================================
   ENVIAR LOCALIZAÇÃO
====================================================== */

async function enviarLocalizacao(numero) {
  try {
    const sentMsg1 = await sock.sendMessage(numero, {
      location: {
        degreesLatitude: -30.0326,
        degreesLongitude: -51.2104,
      },
    });
    marcarComoEnviadoPeloBot(sentMsg1);

    // Também enviar mensagem com o endereço
    const sentMsg2 = await sock.sendMessage(
      numero,
      {
        text: "🤖 Yan Automações\n" + ENDERECO_YAN,
      }
    );
    marcarComoEnviadoPeloBot(sentMsg2);

    console.log("✅ Localização enviada!");

  } catch (erro) {
    console.log("❌ Erro ao enviar localização:");
    console.log(erro);
  }
}

/* ======================================================
   CATÁLOGO DE IMAGENS (FOTOS DOS SOFÁS)
====================================================== */

// Verifica se o texto do cliente corresponde a um pedido de catálogo/fotos.
function ehPedidoCatalogoImagens(textoNormalizado) {
  return PALAVRAS_CATALOGO.some((palavra) =>
    textoNormalizado.includes(normalizarTexto(palavra))
  );
}

// Envia, uma a uma, todas as imagens encontradas na pasta do catálogo.
// Se uma imagem não existir ou falhar o envio, o erro é registrado e o
// bot continua para a próxima foto, sem interromper o atendimento.
async function enviarCatalogoImagens(numero) {
  try {
    // Lê a pasta de forma assíncrona (não bloqueia o restante do bot).
    const arquivos = await fs.promises.readdir(PASTA_IMAGENS_CATALOGO);

    const imagens = arquivos
      .filter((arquivo) => EXTENSOES_IMAGEM_VALIDAS.test(arquivo))
      .sort();

    if (imagens.length === 0) {
      const sentMsg = await sock.sendMessage(numero, {
        text: "Desculpe, não encontrei fotos disponíveis no catálogo agora.",
      });
      marcarComoEnviadoPeloBot(sentMsg);
      return;
    }

    for (const nomeArquivo of imagens) {
      try {
        const caminhoImagem = path.join(PASTA_IMAGENS_CATALOGO, nomeArquivo);

        // Confere se o arquivo ainda existe antes de tentar enviá-lo.
        if (!fs.existsSync(caminhoImagem)) {
          console.log(`⚠️ Imagem não encontrada, pulando: ${nomeArquivo}`);
          continue;
        }

        const sentMsg = await sock.sendMessage(numero, {
          image: { url: caminhoImagem },
        });
        marcarComoEnviadoPeloBot(sentMsg);
      } catch (erroImagem) {
        // Se uma imagem falhar, apenas loga e segue para a próxima.
        console.log(`❌ Erro ao enviar a imagem "${nomeArquivo}":`);
        console.log(erroImagem);
        continue;
      }
    }

    // Mensagem final, enviada depois de todas as fotos.
    const sentMsgFinal = await sock.sendMessage(numero, {
      text:
        "Esses são alguns dos nossos modelos disponíveis.\n\n" +
        "Qual deles você mais gostou?\n\n" +
        "Informe também a medida desejada para que eu possa calcular o valor.",
    });
    marcarComoEnviadoPeloBot(sentMsgFinal);

    console.log("✅ Catálogo de imagens enviado!");
  } catch (erro) {
    console.log("❌ Erro ao enviar catálogo de imagens:");
    console.log(erro);
  }
}

/* ======================================================
   CÁLCULO DO VALOR DO SOFÁ PELA MEDIDA
====================================================== */

// Extrai a medida (em metros) informada pelo cliente em textos como:
// "2 metros", "2m", "2,30", "2.30", "2,5", "2.50", "3 metros".
// Retorna um número (float) ou null se nenhuma medida for encontrada.
function extrairMedidaSofa(texto) {
  const textoNormalizado = normalizarTexto(texto);

  // 1) Número decimal (com vírgula ou ponto), com ou sem "m"/"metros" depois.
  //    Ex.: "2,30" | "2.5" | "2,50 metros" | "2.5m"
  const regexDecimal = /\b(\d{1,2}[,.]\d{1,2})\s*(?:m(?:etros)?)?\b/i;

  // 2) Número inteiro seguido obrigatoriamente de "m" ou "metros".
  //    Ex.: "2 metros" | "2m" | "3 metros"
  const regexInteiroComUnidade = /\b(\d{1,2})\s*m(?:etros)?\b/i;

  const matchDecimal = textoNormalizado.match(regexDecimal);
  const matchInteiro = textoNormalizado.match(regexInteiroComUnidade);

  let valorEncontrado = null;

  if (matchDecimal) {
    valorEncontrado = matchDecimal[1];
  } else if (matchInteiro) {
    valorEncontrado = matchInteiro[1];
  }

  if (!valorEncontrado) return null;

  // Converte vírgula decimal para ponto, para o parseFloat funcionar.
  const metros = parseFloat(valorEncontrado.replace(",", "."));

  return Number.isFinite(metros) ? metros : null;
}

// Calcula o valor aproximado do sofá (metros x preço por metro) e devolve
// a mensagem já formatada para envio ao cliente. Funciona para qualquer
// medida, sem usar valores fixos.
function calcularPrecoSofa(metros) {
  const valorTotal = metros * PRECO_POR_METRO;

  const metrosFormatados = metros.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const valorFormatado = valorTotal.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return `O valor aproximado para um sofá de ${metrosFormatados} metros é de R$ ${valorFormatado}.`;
}

/* ======================================================
   INICIALIZAR SOCKET
====================================================== */

async function inicializarSocket() {
  try {
    const phoneNumber = process.env.PHONE_NUMBER?.replace(/\D/g, "");
    const { state, saveCreds } = await useMongoAuthState(authCollection);

    sock = makeWASocket({
      auth: state,
      logger: logger,
      printQRInTerminal: false,
      browser: Browsers.ubuntu("Chrome"),
      connectTimeoutMs: 30000,
      defaultQueryTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      syncFullState: true,
    });

    let shouldUsePairingCode = !state.creds.registered && Boolean(phoneNumber);
    pairingFlowActive = shouldUsePairingCode;

    if (!phoneNumber) {
      console.log("⚠️ PHONE_NUMBER no está definido. El bot está en modo Pairing Code, pero no se puede generar código sin el número.");
    }

    if (shouldUsePairingCode) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        const pairingCode = await sock.requestPairingCode(phoneNumber);
        const formattedPairingCode = pairingCode.match(/.{1,4}/g).join("-");
        console.log("\n========================================");
        console.log("CÓDIGO DE VINCULACIÓN:");
        console.log(formattedPairingCode);
        console.log("========================================");
        console.log("INGRESE ESTE CÓDIGO EN WHATSAPP: Dispositivos vinculados > Vincular dispositivo > Vincular con número");
        console.log("========================================\n");
      } catch (error) {
        console.error("Error al solicitar el código de vinculación:", error);
        shouldUsePairingCode = false;
        latestQr = null;
        console.log("🔄 El flujo quedó forzado a Pairing Code y no se mostrará QR.");
      }
    }

    /* ======================================================
       EVENTOS
    ====================================================== */

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr && !shouldUsePairingCode) {
        latestQr = null;
        connectionState = "qr";
        console.log("⚠️ QR deshabilitado en modo Pairing Code.");
      }

      if (connection === "open") { 
        connectionState = "open";
        latestQr = null;
        pairingFlowActive = false;
        console.log("✅ Bot conectado!");
      }

      if (connection === "close") {
        connectionState = "close";
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || "";
        const isAuthFailure = statusCode === DisconnectReason.loggedOut;
        const shouldReconnect = !isAuthFailure && !pairingFlowActive;

        console.log(
          "conexão fechada devido a ",
          lastDisconnect?.error,
          ", reconectando ",
          shouldReconnect
        );

        if (pairingFlowActive) {
          pairingFlowActive = false;
          setTimeout(inicializarSocket, 3000);
          return;
        }

        if (isAuthFailure) {
          if (authResetInProgress) {
            console.log("⚠️ Reinício de autenticação já em andamento. Aguarde...");
            return;
          }

          authResetInProgress = true;
          console.log("⚠️ Sessão inválida ou expirada em Baileys. Resetando autenticação...");
          await limparAuthMongo();
          setTimeout(() => {
            authResetInProgress = false;
            inicializarSocket();
          }, 3000);
          return;
        }

        if (shouldReconnect) {
          setTimeout(inicializarSocket, 3000);
        }
      }
    });

    sock.ev.on("creds.update", saveCreds);

    /* ======================================================
       MENSAGENS
    ====================================================== */

    sock.ev.on("messages.upsert", async (m) => {
      try {
        if (!m.messages) return;

        // Um mesmo evento pode trazer mais de uma mensagem. Registrar antes
        // as manuais evita que o bot responda se elas não forem a primeira.
        for (const mensagemManual of m.messages) {
          if (!mensagemManual.message || !mensagemManual.key.fromMe) continue;

          // Ignorar o eco das próprias respostas do bot: não é intervenção humana.
          if (idsMensagensDoBot.has(mensagemManual.key.id)) {
            idsMensagensDoBot.delete(mensagemManual.key.id);
            continue;
          }

          if (mensagemManual.key.remoteJid.includes("@g.us")) continue;
          if (isJidBroadcast(mensagemManual.key.remoteJid)) continue;

          const numeroManual = mensagemManual.key.remoteJid;
          let textoManual = mensagemManual.message.conversation || "";

          if (!textoManual && mensagemManual.message.extendedTextMessage) {
            textoManual = mensagemManual.message.extendedTextMessage.text;
          }

          if (normalizarTexto(textoManual) === "#bot") {
            obterIdsDaConversa(mensagemManual).forEach((id) =>
              atendimentosHumanos.delete(id)
            );
            console.log("🤖 Bot reativado para:", numeroManual);
          } else {
            obterIdsDaConversa(mensagemManual).forEach((id) =>
              atendimentosHumanos.add(id)
            );
            console.log("👤 Atendimento humano ativado para:", numeroManual);
          }
        }

        const message = m.messages[0];

        console.log("[messages.upsert] fromMe:", message.key.fromMe);
        console.log("[messages.upsert] remoteJid:", message.key.remoteJid);
        console.log("[messages.upsert] type:", m.type);
        console.log("[messages.upsert] message:", message.message);

        if (!message.message) return;

        // Ignorar grupos
        if (message.key.remoteJid.includes("@g.us")) return;

        // Ignorar broadcast
        if (isJidBroadcast(message.key.remoteJid)) return;

        const numero = message.key.remoteJid;

        // Mensagens próprias já foram registradas no modo humano acima.
        if (message.key.fromMe) return;

        // Não responder enquanto o atendimento estiver sendo feito por uma pessoa.
        if (obterIdsDaConversa(message).some((id) => atendimentosHumanos.has(id))) return;

        let textoUsuario = message.message.conversation || "";
        const recebeuAudio = Boolean(message.message.audioMessage);

        // Se não houver texto simples, tentar extrair de outras fontes
        if (!textoUsuario && message.message.extendedTextMessage) {
          textoUsuario = message.message.extendedTextMessage.text;
        }

        /* ======================================================
           PROCESSAR AUDIO
        ====================================================== */

        if (recebeuAudio) {
          console.log("Audio recebido");

          try {
            textoUsuario = await transcreverAudio(message);

            console.log("Transcricao:");
            console.log(textoUsuario);
          } catch (erroAudio) {
            console.log("Erro ao processar audio:", erroAudio);

            const sentMsg = await sock.sendMessage(numero, {
              text: "Desculpe, nao consegui entender esse audio. Pode enviar novamente ou escrever a mensagem?",
            });
            marcarComoEnviadoPeloBot(sentMsg);
            return;
          }
        }

        // Ignorar vazio
        if (!textoUsuario) return;

        const texto = normalizarTexto(textoUsuario);

        /* ======================================================
           PEDIR PDF
        ====================================================== */

        if (
          texto.includes("pdf") ||
          texto.includes("documento")
        ) {
          if (fs.existsSync("./pdf/yan-automacoes.pdf")) {
            await enviarPDF(numero, "./pdf/yan-automacoes.pdf");
          } else {
            const sentMsg = await sock.sendMessage(numero, {
              text: "Desculpe, o PDF não está disponível no momento.",
            });
            marcarComoEnviadoPeloBot(sentMsg);
          }
          return;
        }

        /* ======================================================
           PEDIR ENDEREÇO
        ====================================================== */

        if (
          texto.includes("endereco") ||
          texto.includes("localizacao") ||
          texto.includes("onde fica") ||
          texto.includes("localizar") ||
          texto.includes("locais")
        ) {
          await enviarLocalizacao(numero);
          return;
        }

        /* ======================================================
           PEDIR CATÁLOGO DE FOTOS (MODELOS DE SOFÁ)
        ====================================================== */

        if (ehPedidoCatalogoImagens(texto)) {
          try {
            await enviarCatalogoImagens(numero);
          } catch (erroCatalogo) {
            console.log("❌ Erro ao processar pedido de catálogo:");
            console.log(erroCatalogo);
          }
          return;
        }

        /* ======================================================
           CLIENTE INFORMOU A MEDIDA DO SOFÁ (CÁLCULO AUTOMÁTICO)
        ====================================================== */

        try {
          const medidaInformada = extrairMedidaSofa(textoUsuario);

          if (medidaInformada !== null && medidaInformada > 0) {
            const respostaPreco = calcularPrecoSofa(medidaInformada);

            // Registra a interação no histórico para manter a memória da conversa.
            if (!conversas[numero]) {
              conversas[numero] = [];
            }
            conversas[numero].push({ role: "user", content: textoUsuario });
            conversas[numero].push({ role: "assistant", content: respostaPreco });
            conversas[numero] = conversas[numero].slice(-15);

            await enviarResposta(numero, respostaPreco, recebeuAudio);
            return;
          }
        } catch (erroMedida) {
          console.log("❌ Erro ao calcular medida do sofá:");
          console.log(erroMedida);
          // Não interrompe o atendimento: segue o fluxo normal com a IA.
        }

        console.log("\n📩 Mensagem de:", numero);
        console.log(textoUsuario);

        /* ======================================================
           HISTÓRICO
        ====================================================== */

        if (!conversas[numero]) {
          conversas[numero] = [];
        }

        conversas[numero].push({
          role: "user",
          content: textoUsuario,
        });

        // Limitar memória
        conversas[numero] = conversas[numero].slice(-15);

        /* ======================================================
           OPENAI
        ====================================================== */

        const respostaIA = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          temperature: 0.7,
          messages: [
            {
              role: "system",
              content: PROMPT_SISTEMA,
            },
            ...conversas[numero],
          ],
        });

        const resposta = respostaIA.choices[0].message.content;

        console.log("\n🤖 Resposta:");
        console.log(resposta);

        /* ======================================================
           SALVAR RESPOSTA
        ====================================================== */

        conversas[numero].push({
          role: "assistant",
          content: resposta,
        });

        /* ======================================================
           ENVIAR RESPOSTA
        ====================================================== */

        await enviarResposta(numero, resposta, recebeuAudio);

        /* ======================================================
           ENVIAR PDF AUTOMÁTICO PROPOSTA
        ====================================================== */

        if (ehConfirmacaoProposta(resposta)) {
          await enviarPDFProposta(numero, conversas[numero], resposta);
        }

      } catch (erro) {
        console.log("❌ ERRO:");
        console.log(erro);

        try {
          const message = m.messages && m.messages[0];
          if (message?.key?.remoteJid) {
            const sentMsg = await sock.sendMessage(
              message.key.remoteJid,
              {
                text: "Desculpe, ocorreu um erro no atendimento.",
              }
            );
            marcarComoEnviadoPeloBot(sentMsg);
          }
        } catch (e) {
          console.log("Erro ao enviar mensagem de erro:", e);
        }
      }
    });

  } catch (erro) {
    console.log("Erro ao inicializar socket:", erro);
    setTimeout(inicializarSocket, 3000);
  }
}

/* ======================================================
   API
====================================================== */

app.get("/", (req, res) => {
  res.json({
    status: "online",
    bot: "Yan IA",
    auth_storage: "mongodb",
  });
});

app.get("/status", (req, res) => {
  res.json({
    status: connectionState,
    qr_available: Boolean(latestQr),
  });
});

app.get("/qr", async (req, res) => {
  if (!latestQr) {
    return res.status(404).send("QR code is not available right now.");
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(latestQr);
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 40px;">
          <h1>QR Code WhatsApp</h1>
          <p>Escanea este código con WhatsApp para conectar el bot.</p>
          <img src="${qrDataUrl}" alt="QR Code" />
          <p>El código expira cada pocos segundos. Refresca la página si no funciona.</p>
        </body>
      </html>
    `);
  } catch (erro) {
    console.error("Error generating QR image:", erro);
    res.status(500).send("Error generating QR image.");
  }
});

async function resetSession(req, res, redirect = false) {
  try {
    connectionState = "restarting";
    latestQr = null;

    if (sock && typeof sock.end === "function") {
      await sock.end();
    }

    if (authCollection) {
      await authCollection.deleteMany({});
    }

    setTimeout(() => {
      inicializarSocket();
    }, 1000);

    if (redirect) {
      return res.redirect("/qr");
    }

    res.json({
      status: "restarting",
      message: "Session reset started. Refresh /qr after a few seconds.",
    });
  } catch (erro) {
    console.error("Error resetting session:", erro);
    res.status(500).json({ error: "Unable to reset session." });
  }
}

app.get("/reset-session", async (req, res) => {
  return resetSession(req, res, true);
});

app.post("/reset-session", async (req, res) => {
  return resetSession(req, res);
});

/* ======================================================
   SERVIDOR
====================================================== */

const PORT = process.env.PORT || 3000;

app.listen(PORT, async () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);

  try {
    await conectarMongoDB();
    await inicializarSocket();
  } catch (erro) {
    console.error("Erro ao iniciar:", erro);
    process.exit(1);
  }
});