// Nomandly — publica só o 4º story do Salvador (o único que faltou: os 3
// primeiros já saíram certos na rodada anterior; o 4º falhou com "Media ID
// is not available" — o Instagram ainda não tinha terminado de buscar a
// imagem quando tentamos publicar logo em seguida). Este script já espera
// um pouco e tenta de novo antes de desistir.
//
// Rodar uma única vez, localmente (mesmas variáveis de ambiente de sempre):
//   node scripts/fix_salvador_story_slide4.js
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildStoryImage } = require('./lib/storyImage');

const ROOT = path.join(__dirname, '..');
const SLIDE = 'content/carrosseis/01_salvador/slide_4.png';

const {
  IG_BUSINESS_ACCOUNT_ID,
  IG_LONG_LIVED_TOKEN,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
  GRAPH_API_VERSION = 'v26.0',
} = process.env;

function required(name, value) {
  if (!value) throw new Error(`Variável de ambiente obrigatória faltando: ${name}`);
  return value;
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const igId = () => required('IG_BUSINESS_ACCOUNT_ID', IG_BUSINESS_ACCOUNT_ID);

async function graphPost(edge, params) {
  const url = new URL(`${GRAPH_BASE}/${edge}`);
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null) url.searchParams.set(k, v); });
  url.searchParams.set('access_token', required('IG_LONG_LIVED_TOKEN', IG_LONG_LIVED_TOKEN));
  const res = await fetch(url, { method: 'POST' });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Graph API erro em POST ${edge}: ${JSON.stringify(json)}`);
  return json;
}

async function publishContainerWithRetry(creationId, { attempts = 6, delayMs = 3000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await graphPost(`${igId()}/media_publish`, { creation_id: creationId });
    } catch (err) {
      const notReadyYet = /2207027|Media ID is not available/i.test(err.message || '');
      if (notReadyYet && attempt < attempts) {
        console.log(`   ainda não tava pronto, tentando de novo (${attempt}/${attempts})...`);
        await sleep(delayMs);
        continue;
      }
      throw err;
    }
  }
}

async function cloudinaryUpload(localPath) {
  required('CLOUDINARY_CLOUD_NAME', CLOUDINARY_CLOUD_NAME);
  required('CLOUDINARY_API_KEY', CLOUDINARY_API_KEY);
  required('CLOUDINARY_API_SECRET', CLOUDINARY_API_SECRET);
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'nomandly-automacao/stories-fix';
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(paramsToSign + CLOUDINARY_API_SECRET).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(localPath)]), path.basename(localPath));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);
  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`Cloudinary upload falhou: ${JSON.stringify(json)}`);
  return json.secure_url;
}

async function main() {
  const localPath = path.join(ROOT, SLIDE);
  const tmpOut = path.join(os.tmpdir(), `story-fix-slide4-${Date.now()}.jpg`);
  console.log('Recompondo a imagem 4 em 1080x1920...');
  await buildStoryImage(localPath, tmpOut);
  console.log('Subindo pro Cloudinary...');
  const imageUrl = await cloudinaryUpload(tmpOut);
  fs.unlink(tmpOut, () => {});
  console.log('Criando o story no Instagram...');
  const container = await graphPost(`${igId()}/media`, { image_url: imageUrl, media_type: 'STORIES' });
  await sleep(2000);
  console.log('Publicando (com nova tentativa automática se ainda não estiver pronto)...');
  const result = await publishContainerWithRetry(container.id);
  console.log('Pronto! Story 4 publicado:', JSON.stringify(result));
}

main().catch((err) => {
  console.error('Falha:', err.message || err);
  process.exit(1);
});
