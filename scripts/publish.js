// Nomandly — publicação diária automática no Instagram (@nomandly_)
// via Instagram Graph API, com hospedagem temporária das mídias no Cloudinary.
//
// Rodado pelo GitHub Actions (.github/workflows/daily-post.yml) todo dia às
// 8h (horário de Brasília). Lê o próximo post da fila (scripts/queue.json),
// sobe as imagens/vídeo pro Cloudinary, cria o container no Graph API,
// publica, e avança o ponteiro em state.json (committado de volta pro repo
// pelo próprio workflow).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildStoryImage } = require('./lib/storyImage');

const ROOT = path.join(__dirname, '..');
const QUEUE_PATH = path.join(__dirname, 'queue.json');
const STATE_PATH = path.join(ROOT, 'state.json');

const {
  IG_BUSINESS_ACCOUNT_ID,
  IG_LONG_LIVED_TOKEN,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  GRAPH_API_VERSION = 'v26.0',
  DRY_RUN,
} = process.env;

function required(name, value) {
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória faltando: ${name}`);
  }
  return value;
}

function loadQueue() {
  return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
}

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { nextIndex: 0, history: [] };
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

// ------------------------------------------------------------------
// Cloudinary — upload assinado (imagem ou vídeo) e retorno da URL pública.
// ------------------------------------------------------------------
async function cloudinaryUpload(localPath, resourceType) {
  required('CLOUDINARY_CLOUD_NAME', CLOUDINARY_CLOUD_NAME);
  required('CLOUDINARY_API_KEY', CLOUDINARY_API_KEY);
  required('CLOUDINARY_API_SECRET', CLOUDINARY_API_SECRET);

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'nomandly-automacao';
  // A Instagram Graph API só aceita JPEG pra fotos (PNG é recusado com
  // "Only photo or video can be accepted as media type") — convertemos na
  // hora do upload pro Cloudinary, sem precisar reexportar nada localmente.
  const convertToJpg = resourceType === 'image';
  const paramsToSign = convertToJpg
    ? `folder=${folder}&format=jpg&timestamp=${timestamp}`
    : `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto
    .createHash('sha1')
    .update(paramsToSign + CLOUDINARY_API_SECRET)
    .digest('hex');

  const form = new FormData();
  const fileBuffer = fs.readFileSync(localPath);
  const fileName = path.basename(localPath);
  form.append('file', new Blob([fileBuffer]), fileName);
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  if (convertToJpg) form.append('format', 'jpg');
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Cloudinary upload falhou (${fileName}): ${JSON.stringify(json)}`);
  }
  return json.secure_url;
}

// ------------------------------------------------------------------
// Instagram Graph API
// ------------------------------------------------------------------
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function graphPost(edge, params) {
  const url = new URL(`${GRAPH_BASE}/${edge}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  url.searchParams.set('access_token', required('IG_LONG_LIVED_TOKEN', IG_LONG_LIVED_TOKEN));

  const res = await fetch(url, { method: 'POST' });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Graph API erro em ${edge}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function graphGet(edge, params = {}) {
  const url = new URL(`${GRAPH_BASE}/${edge}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  url.searchParams.set('access_token', required('IG_LONG_LIVED_TOKEN', IG_LONG_LIVED_TOKEN));

  const res = await fetch(url);
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(`Graph API erro em GET ${edge}: ${JSON.stringify(json)}`);
  }
  return json;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitVideoReady(creationId, { timeoutMs = 5 * 60 * 1000, intervalMs = 10000 } = {}) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const status = await graphGet(creationId, { fields: 'status_code' });
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') {
      throw new Error(`Processamento do vídeo falhou: ${JSON.stringify(status)}`);
    }
    await sleep(intervalMs);
  }
  throw new Error('Timeout esperando o vídeo processar no Instagram.');
}

const igId = () => required('IG_BUSINESS_ACCOUNT_ID', IG_BUSINESS_ACCOUNT_ID);

// ------------------------------------------------------------------
// Stories — replica cada imagem (ou o vídeo do reel) como Story.
//
// IMPORTANTE: o Instagram exige proporção 9:16 (1080x1920) pra Stories.
// As imagens do feed são 4:5 (1080x1350) — se mandarmos a URL do feed
// direto, o Instagram faz o próprio corte/zoom automático pra preencher
// a tela, e o resultado sai cortado e ilegível. Por isso cada imagem de
// story é recomposta localmente (scripts/lib/storyImage.js) num quadro
// 1080x1920 com a imagem inteira visível, e só essa versão é enviada.
// Vídeo (reel) não passa por esse recorte local — em vez disso pedimos
// pro Cloudinary preencher com barras pretas (sem cortar nem distorcer).
//
// Uma falha aqui nunca derruba o post principal, que já foi publicado
// com sucesso quando isto roda.
// ------------------------------------------------------------------
function toStoryVideoUrl(videoUrl) {
  return videoUrl.replace('/video/upload/', '/video/upload/c_pad,b_black,w_1080,h_1920/');
}

async function uploadStoryImageFromLocal(localPath) {
  const tmpOut = path.join(os.tmpdir(), `story-${path.basename(localPath, path.extname(localPath))}-${Date.now()}.jpg`);
  await buildStoryImage(localPath, tmpOut);
  try {
    return await cloudinaryUpload(tmpOut, 'image');
  } finally {
    fs.unlink(tmpOut, () => {});
  }
}

// Às vezes o Instagram ainda não terminou de "puxar" a mídia da URL quando
// tentamos publicar logo em seguida (mesmo pra imagem) — a API responde
// "Media ID is not available" (subcode 2207027). Não é um erro de verdade,
// é só cedo demais: espera um pouco e tenta de novo antes de desistir.
async function publishContainerWithRetry(creationId, { attempts = 6, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await graphPost(`${igId()}/media_publish`, { creation_id: creationId });
    } catch (err) {
      const notReadyYet = /2207027|Media ID is not available/i.test(err.message || '');
      if (notReadyYet && attempt < attempts) {
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
}

async function publishImageStory(imageUrl) {
  const container = await graphPost(`${igId()}/media`, {
    image_url: imageUrl,
    media_type: 'STORIES',
  });
  await sleep(1500); // dá um tempo pro Instagram buscar a imagem antes de publicar
  return publishContainerWithRetry(container.id);
}

async function publishVideoStory(videoUrl) {
  const container = await graphPost(`${igId()}/media`, {
    video_url: videoUrl,
    media_type: 'STORIES',
  });
  await waitVideoReady(container.id);
  return publishContainerWithRetry(container.id);
}

async function publishStories({ imageUrls = [], videoUrl } = {}) {
  for (const url of imageUrls) {
    try {
      await publishImageStory(url);
      await sleep(2000); // respiro entre stories pra não estourar rate limit
    } catch (err) {
      console.error('Aviso: falha ao publicar 1 story (post principal não foi afetado):', err.message || err);
    }
  }
  if (videoUrl) {
    try {
      await publishVideoStory(videoUrl);
    } catch (err) {
      console.error('Aviso: falha ao publicar o story do vídeo (post principal não foi afetado):', err.message || err);
    }
  }
}

async function publishCarousel(post) {
  const childIds = [];
  const storyImageUrls = [];
  for (const relPath of post.files) {
    const localPath = path.join(ROOT, relPath);
    const imageUrl = await cloudinaryUpload(localPath, 'image');
    const container = await graphPost(`${igId()}/media`, {
      image_url: imageUrl,
      is_carousel_item: 'true',
    });
    childIds.push(container.id);
    // versão 9:16 (recomposta), só usada pro story — nunca pro post do feed.
    storyImageUrls.push(await uploadStoryImageFromLocal(localPath));
  }
  const carousel = await graphPost(`${igId()}/media`, {
    media_type: 'CAROUSEL',
    children: childIds.join(','),
    caption: post.caption,
  });
  const result = await graphPost(`${igId()}/media_publish`, { creation_id: carousel.id });
  return { result, imageUrls: storyImageUrls };
}

async function publishReel(post) {
  const videoUrl = await cloudinaryUpload(path.join(ROOT, post.file), 'video');
  const coverUrl = post.cover ? await cloudinaryUpload(path.join(ROOT, post.cover), 'image') : undefined;
  const container = await graphPost(`${igId()}/media`, {
    media_type: 'REELS',
    video_url: videoUrl,
    cover_url: coverUrl,
    caption: post.caption,
  });
  await waitVideoReady(container.id);
  const result = await graphPost(`${igId()}/media_publish`, { creation_id: container.id });
  // versão com barras pretas 9:16, só usada pro story (sem cortar/distorcer o vídeo).
  return { result, videoUrl: toStoryVideoUrl(videoUrl) };
}

async function publishSingle(post) {
  const localPath = path.join(ROOT, post.file);
  const imageUrl = await cloudinaryUpload(localPath, 'image');
  const container = await graphPost(`${igId()}/media`, {
    image_url: imageUrl,
    caption: post.caption,
  });
  const result = await graphPost(`${igId()}/media_publish`, { creation_id: container.id });
  // versão 9:16 (recomposta), só usada pro story — nunca pro post do feed.
  const storyImageUrl = await uploadStoryImageFromLocal(localPath);
  return { result, imageUrls: [storyImageUrl] };
}

async function main() {
  const queue = loadQueue();
  const state = loadState();
  const index = state.nextIndex % queue.length;
  const post = queue[index];

  console.log(`Publicando post ${index + 1}/${queue.length}: ${post.id} (${post.type})`);

  if (DRY_RUN === 'true') {
    console.log('DRY_RUN ativo — nada será enviado ao Instagram. Post que seria publicado:');
    console.log(JSON.stringify(post, null, 2));
    return;
  }

  let outcome;
  if (post.type === 'carousel') outcome = await publishCarousel(post);
  else if (post.type === 'reel') outcome = await publishReel(post);
  else if (post.type === 'single') outcome = await publishSingle(post);
  else throw new Error(`Tipo de post desconhecido: ${post.type}`);

  const { result, imageUrls, videoUrl } = outcome;
  console.log('Publicado com sucesso:', JSON.stringify(result));

  console.log('Replicando cada página como Story...');
  await publishStories({ imageUrls, videoUrl });
  console.log('Stories publicados.');

  state.nextIndex = index + 1;
  state.history = state.history || [];
  state.history.push({
    id: post.id,
    publishedAt: new Date().toISOString(),
    mediaId: result.id,
  });
  // mantém só os últimos 60 registros de histórico
  state.history = state.history.slice(-60);
  saveState(state);
}

main().catch((err) => {
  console.error('Falha ao publicar:', err.message || err);
  process.exit(1);
});
