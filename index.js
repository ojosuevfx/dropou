const { google } = require('googleapis');
const axios = require('axios');
const fs = require('fs');

const CREDENTIALS_PATH = './credentials.json';
const TOKEN_PATH = './token.json';
const LAST_CHECK_PATH = './last_check.json';

// PASTAS MONITORADAS
const FOLDERS = {
  '1PLmSVfpDofZKqnPyOD8vS3GaUVUb0h1D': '🎬 Vídeos longos brutos',
  '1PLmSVfpDofZKqnPyOD8vS3GaUVUb0h1D': '🎬 Vídeos longos Finalizados',
  '1A1p55sW16vqZQCRrw7le9Fqbyt9jwcbw': '⚡ Vídeos curtos brutos',
  '1mQWgKWOF8u08camwIMh3fitAA8k0SZhH': '⚡ Vídeos curtos Finalizados'
};

const TELEGRAM_TOKEN = '8480241954:AAHEb_ukvfeorRGeGPZDuCd4jQXKKXUDKDs';
const TELEGRAM_CHAT_ID = '6767958656';
const INTERVALO_MINUTOS = 1;

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function getAuthClient() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const { client_secret, client_id, redirect_uris } = credentials.installed;

  const oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    oAuth2Client.setCredentials(token);
    return oAuth2Client;
  }

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/drive.readonly'],
    prompt: 'consent',
  });

  console.log('\n🔐 Autorize o app acessando essa URL no navegador:\n');
  console.log(authUrl);
  console.log('\nDepois cole o código aqui:');

  const code = await new Promise((resolve) => {
    process.stdin.once('data', (data) => resolve(data.toString().trim()));
  });

  const { tokens } = await oAuth2Client.getToken(code);
  oAuth2Client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log('✅ Token salvo com sucesso!');
  return oAuth2Client;
}

function getLastCheck() {
  if (!fs.existsSync(LAST_CHECK_PATH)) return { arquivos: [] };

  try {
    return JSON.parse(fs.readFileSync(LAST_CHECK_PATH, 'utf8'));
  } catch {
    return { arquivos: [] };
  }
}

function saveLastCheck(data) {
  fs.writeFileSync(LAST_CHECK_PATH, JSON.stringify(data, null, 2));
}

async function sendTelegram(mensagem) {
  const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;

  await axios.post(url, {
    chat_id: TELEGRAM_CHAT_ID,
    text: mensagem,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  });
}

async function verificarPastas(auth) {
  const drive = google.drive({ version: 'v3', auth });

  const folderIds = Object.keys(FOLDERS);
  const queryPastas = folderIds.map((id) => `'${id}' in parents`).join(' or ');

  const res = await drive.files.list({
    q: `(${queryPastas}) and trashed = false`,
    fields: 'files(id, name, createdTime, owners, webViewLink, parents)',
    orderBy: 'createdTime desc',
    pageSize: 100,
  });

  const arquivos = res.data.files || [];
  const lastCheck = getLastCheck();
  const idsConhecidos = new Set(lastCheck.arquivos || []);
  const novos = arquivos.filter((f) => !idsConhecidos.has(f.id));

  for (const arquivo of novos) {
    const dono = escapeHtml(arquivo.owners?.[0]?.displayName || 'Desconhecido');
    const nome = escapeHtml(arquivo.name);
    const data = new Date(arquivo.createdTime).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo'
    });

    const pastaId = arquivo.parents?.[0];
    const nomePasta = escapeHtml(FOLDERS[pastaId] || 'Pasta desconhecida');

    const linkArquivo =
      arquivo.webViewLink || `https://drive.google.com/file/d/${arquivo.id}/view`;

    const mensagem =
      `📁 <b>Novo arquivo detectado!</b>\n\n` +
      `📄 <b>Arquivo:</b> ${nome}\n` +
      `👤 <b>Enviado por:</b> ${dono}\n` +
      `🕐 <b>Horário:</b> ${data}\n` +
      `📂 <b>Pasta:</b> ${nomePasta}\n\n` +
      `🔗 <b>Link do arquivo:</b>\n${linkArquivo}`;

    await sendTelegram(mensagem);
    console.log(`✅ Notificação enviada: ${arquivo.name} | Pasta: ${nomePasta}`);
  }

  saveLastCheck({
    arquivos: arquivos.map((f) => f.id)
  });

  if (novos.length === 0) {
    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] Nenhum arquivo novo.`);
  }
}

async function main() {
  if (TELEGRAM_TOKEN === 'SEU_TOKEN_AQUI') {
    console.log('❌ Configure o TELEGRAM_TOKEN antes de rodar.');
    return;
  }

  console.log('🚀 Iniciando monitoramento do Google Drive...');
  const auth = await getAuthClient();

  await verificarPastas(auth);

  setInterval(() => {
    verificarPastas(auth).catch(console.error);
  }, INTERVALO_MINUTOS * 60 * 1000);
}

main().catch(console.error);
