// Nomandly — gera uma versão "Story" (1080x1920, 9:16) de uma imagem de feed
// (normalmente 1080x1350, 4:5). Sem isso, o Instagram recebe a imagem no
// formato errado e faz o próprio corte/zoom automático pra preencher o
// story — o resultado fica cortado e com o texto ilegível.
//
// A solução: compor nós mesmos um quadro 1080x1920 com a imagem original
// inteira, centralizada, sobre um fundo desfocado/escurecido feito a partir
// da própria imagem (mesmo efeito usado no app do Instagram quando alguém
// posta uma foto "quadrada" direto no story).
'use strict';

const Jimp = require('jimp');

const STORY_W = 1080;
const STORY_H = 1920;

async function buildStoryImage(srcPath, outPath) {
  const img = await Jimp.read(srcPath);

  // Fundo: a mesma imagem, esticada/cortada pra cobrir o quadro todo,
  // desfocada e escurecida — só decoração, nunca precisa estar nítida.
  const background = img.clone().cover(STORY_W, STORY_H).blur(28).brightness(-0.45);

  // Primeiro plano: a imagem original inteira, na largura certa (1080),
  // sem cortar nada, centralizada verticalmente.
  const foreground = img.clone();
  if (foreground.bitmap.width !== STORY_W) {
    foreground.resize(STORY_W, Jimp.AUTO);
  }
  const x = Math.round((STORY_W - foreground.bitmap.width) / 2);
  const y = Math.round((STORY_H - foreground.bitmap.height) / 2);

  const canvas = background.clone();
  canvas.composite(foreground, x, y);
  await canvas.quality(92).writeAsync(outPath);
  return outPath;
}

module.exports = { buildStoryImage, STORY_W, STORY_H };
