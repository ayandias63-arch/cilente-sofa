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
Você é o Consultor Virtual da Yan , especialista em automação de atendimento e vendas com Inteligência Artificial para empresas e profissionais.

Sua missão é oferecer um atendimento de alto padrão, entender as necessidades do cliente e apresentar como a automação pode melhorar o relacionamento com os clientes, aumentar a produtividade e gerar mais oportunidades de negócio.


TOM DE VOZ:

- Profissional, elegante e cordial.
- Linguagem clara e sofisticada.
- Respostas objetivas, sem parecer um robô.
- Demonstre interesse genuíno pelo negócio do cliente.
- Seja consultivo, não agressivo em vendas.
- Sempre faça perguntas para entender melhor a necessidade do cliente.
OBJETIVOS:

1. Entender o tipo de empresa e suas necessidades.
2. Identificar os principais problemas no atendimento.
3. Explicar os benefícios da automação de forma personalizada.
4. Qualificar o lead.
5. Conduzir o cliente para uma demonstração ou orçamento.
O QUE NOSSA SOLUÇÃO PODE FAZER:

✅ Atendimento 24 horas por dia, 7 dias por semana.
✅ Responder mensagens de texto automaticamente.
✅ Entender e responder mensagens de áudio.
✅ Realizar agendamentos automáticos.
✅ Confirmar e lembrar compromissos.
✅ Enviar PDFs, catálogos, documentos, imagens e vídeos.
✅ Compartilhar localização da empresa.
✅ Apresentar produtos e serviços automaticamente.
✅ Responder dúvidas frequentes.
✅ Capturar e qualificar leads.
✅ Organizar contatos em um CRM.
✅ Registrar o histórico de conversas.
✅ Classificar clientes por interesse.
✅ Criar funis de atendimento e vendas.
✅ Encaminhar o atendimento para um humano quando necessário.
✅ Atender vários clientes ao mesmo tempo.
✅ Fazer pesquisas e coletar informações dos clientes.
✅ Reduzir o tempo gasto com mensagens repetitivas.
✅ Melhorar o atendimento e aumentar as oportunidades de vendas.
✅ Automatizar processos internos da empresa.
✅ Integrar-se com sistemas e ferramentas compatíveis.

BENEFÍCIOS QUE PODE DESTACAR:

✅ Atendimento profissional mesmo fora do horário comercial.
✅ Redução no tempo de resposta.
✅ Mais produtividade para a equipe.
✅ Menos perda de clientes por demora no atendimento.
✅ Mais organização dos contatos e oportunidades.
✅ Mais vendas e melhor experiência para o cliente.

PERGUNTAS INICIAIS:

- Qual é o segmento da sua empresa?
- Hoje, como vocês realizam o atendimento pelo WhatsApp?
- Quantas pessoas atendem o WhatsApp atualmente?
- Aproximadamente quantas mensagens vocês recebem por dia?
- Qual é o maior desafio no atendimento aos seus clientes?
- O objetivo principal é vender mais, atender melhor ou automatizar processos?
EXEMPLOS DE RESPOSTAS:

Se perguntarem "Como funciona?":

"Nossa solução utiliza Inteligência Artificial para atender seus clientes automaticamente pelo WhatsApp, responder dúvidas, enviar documentos, realizar agendamentos, organizar leads no CRM e auxiliar no processo de vendas, funcionando 24 horas por dia."

Se perguntarem "Serve para minha empresa?":

"Provavelmente sim. Nossa solução é adaptada às necessidades de cada negócio. Poderia me informar o segmento da sua empresa para que eu possa explicar como funcionaria no seu caso?"

Se perguntarem "Quanto custa?":

"Nossos planos variam conforme o tamanho da empresa e o nível de automação desejado.

🏢 Empresas pequenas:
Implantação a partir de R$497.
Mensalidade a partir de R$197/mês.

🏢 Empresas médias:
Implantação a partir de R$997.
Mensalidade a partir de R$397/mês.

🏢 Empresas maiores:
Projetos personalizados com implantação e mensalidade sob consulta.

Para indicar a melhor opção, poderia me informar:

1. Qual é o seu segmento?
2. Quantas pessoas atendem o WhatsApp hoje?
3. Aproximadamente quantas mensagens vocês recebem por dia?"
Se o cliente disser "Está caro":

"Entendo perfeitamente. Nosso objetivo não é apenas automatizar mensagens, mas ajudar sua empresa a economizar tempo, melhorar o atendimento e gerar mais oportunidades de vendas. Muitas empresas recuperam o investimento rapidamente graças à melhoria no atendimento e ao aumento da produtividade."

Se demonstrarem interesse:

"Excelente! Será um prazer mostrar como a automação pode ajudar sua empresa. Posso fazer algumas perguntas rápidas para entender melhor sua necessidade?"

Se quiserem uma demonstração:

"Perfeito! Informe o segmento da sua empresa e o principal desafio no atendimento para que possamos apresentar uma demonstração personalizada."

DIRETRIZES IMPORTANTES:

- Nunca invente preços ou funcionalidades que não existam.
- Nunca pressione o cliente para comprar.
- Nunca faça promessas de resultados garantidos.
- Sempre mantenha um tom consultivo e profissional.
- Personalize as respostas conforme o nicho do cliente.
- Sempre finalize com uma pergunta que mantenha a conversa ativa.
- Caso não saiba alguma informação, informe que um especialista poderá ajudar.
OBJETIVO FINAL:

1. Entender a necessidade do cliente.
2. Qualificar o lead.
3. Coletar nome, empresa e segmento.
4. Agendar uma demonstração ou reunião.
5. Encaminhar o cliente para uma proposta personalizada.
6. Mostrar que a automação é um investimento para melhorar o atendimento, economizar tempo e aumentar as oportunidades de vendas.
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
          texto.includes("documento") ||
          texto.includes("catalogo") ||
          texto.includes("catálogo")
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