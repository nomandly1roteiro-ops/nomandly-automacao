// Nomandly — correção pontual dos 4 Stories do post do Salvador, publicados
// com a proporção errada (imagem de feed 4:5 direto num story 9:16 — saiu
// cortado e ilegível). Este script:
//   1) apaga os 4 stories errados que já estão no ar;
//   2) recompõe cada imagem do carrossel num quadro 1080x1920 correto
//      (scripts/lib/storyImage.js);
//   3) sobe cada versão corrigida pro Cloudinary;
//   4) publica os 4 stories corretos no lugar.
//
// Rodar uma única vez, localmente:
//   npm install
//   node scripts/fix_salvador_stories.js
//
// Precisa das mesmas variáveis de ambiente do publish.js (IG_BUSINESS_ACCOUNT_ID,
// IG_LONG_LIVED_TOKEN, CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { buildStoryImage } = require('./lib/storyImage');

const ROOT = path.join(__dirname, '..');

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Os 4 stories já publicados (errados) do post do Salvador, na ordem das
// páginas do carrossel — pegue de novo com GET /{ig-id}/stories caso os IDs
// tenham mudado desde que este script foi escrito.
const BROKEN_STORY_IDS = [
  '18106876778522132',
  '18341303239254404',
  '18129318568739924',
  '17956151280247273',
];

const SALVADOR_SLIDES = [
  'content/carrosseis/01_salvador/slide_1.png',
  'content/carrosseis/01_salvador/slide_2.png',
  'content/carrosseis/01_salvador/slide_3.png',
  'content/carrosseis/01_salvador/slide_4.png',
];

const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;

async function graphPost(edge, params) {
  const url = new URL(`${GRAPH_BASE}/${edge}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null) url.searchParams.set(k, v);
  });
  url.searchParams.set('access_token', required('IG_LONG_LIVED_TOKEN', IG_LONG_LIVED_TOKEN));
  const res = await fetch(url, { method: 'POST' });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Graph API erro em POST ${edge}: ${JSON.stringify(json)}`);
  return json;
}

async function graphDelete(id) {
  const url = new URL(`${GRAPH_BASE}/${id}`);
  url.searchParams.set('access_token', required('IG_LONG_LIVED_TOKEN', IG_LONG_LIVED_TOKEN));
  const res = await fetch(url, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(`Graph API erro em DELETE ${id}: ${JSON.stringify(json)}`);
  return json;
}

async function cloudinaryUpload(localPath, resourceType) {
  required('CLOUDINARY_CLOUD_NAME', CLOUDINARY_CLOUD_NAME);
  required('CLOUDINARY_API_KEY', CLOUDINARY_API_KEY);
  required('CLOUDINARY_API_SECRET', CLOUDINARY_API_SECRET);

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'nomandly-automacao/stories-fix';
  const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1').update(paramsToSign + CLOUDINARY_API_SECRET).digest('hex');

  const form = new FormData();
  const fileBuffer = fs.readFileSync(localPath);
  form.append('file', new Blob([fileBuffer]), path.basename(localPath));
  form.append('api_key', CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', folder);
  form.append('signature', signature);

  const url = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;
  const res = await fetch(url, { method: 'POST', body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`Cloudinary upload falhou (${localPath}): ${JSON.stringify(json)}`);
  return json.secure_url;
}

const igId = () => required('IG_BUSINESS_ACCOUNT_ID', IG_BUSINESS_ACCOUNT_ID);

async function publishImageStory(imageUrl) {
  const container = await graphPost(`${igId()}/media`, { image_url: imageUrl, media_type: 'STORIES' });
  return graphPost(`${igId()}/media_publish`, { creation_id: container.id });
}

async function main() {
  console.log('1) Apagando os 4 stories publicados errados...');
  for (const id of BROKEN_STORY_IDS) {
    try {
      await graphDelete(id);
      console.log(`   apagado: ${id}`);
    } catch (err) {
      console.error(`   aviso: a API do Instagram não permite apagar Stories (mensagem: "${(err.message || err).toString().slice(0, 80)}..."). Sem problema — eles expiram sozinhos em 24h.`);
    }
    await sleep(1000);
  }

  console.log('2) Recompondo e publicando os stories corrigidos (1080x1920)...');
  for (const relPath of SALVADOR_SLIDES) {
    const localPath = path.join(ROOT, relPath);
    const tmpOut = path.join(os.tmpdir(), `story-fix-${path.basename(relPath, '.png')}-${Date.now()}.jpg`);
    await buildStoryImage(localPath, tmpOut);
    const imageUrl = await cloudinaryUpload(tmpOut, 'image');
    fs.unlink(tmpOut, () => {});
    const result = await publishImageStory(imageUrl);
    console.log(`   story publicado (${relPath}):`, JSON.stringify(result));
    await sleep(2000);
  }

  console.log('Pronto! Os 4 stories do Salvador foram corrigidos.');
}

main().catch((err) => {
  console.error('Falha:', err.message || err);
  process.exit(1);
});
