// Monta scripts/queue.json a partir dos dados reais de cada cidade
// (mesma copy usada nos carrosséis/reels — nada inventado aqui).
const fs = require('fs');
const path = require('path');

const CIDADES = [
  { key: 'salvador', nome: 'Salvador', num: '01',
    legenda: 'Salvador tem dois roteiros: o que todo blog copia e o que quem mora aqui realmente segue.' },
  { key: 'recife', nome: 'Recife', num: '02',
    legenda: 'Recife dá pra fazer inteiro num feriado — desde que você não perca meio dia decidindo por onde começar.' },
  { key: 'fortaleza', nome: 'Fortaleza', num: '03',
    legenda: 'Fortaleza tem fama de cara, mas boa parte do melhor passeio é de graça — só precisa saber qual.' },
  { key: 'natal', nome: 'Natal', num: '04',
    legenda: 'Em Natal, quem não sabe o preço certo do buggy paga o dobro.' },
  { key: 'joaopessoa', nome: 'João Pessoa', num: '05',
    legenda: 'João Pessoa é o segredo mais bem guardado do Nordeste — verde, tranquila e única.' },
  { key: 'maceio', nome: 'Maceió', num: '06',
    legenda: 'Maceió só entrega o que promete se você for na maré certa.' },
  { key: 'aracaju', nome: 'Aracaju', num: '07',
    legenda: 'Aracaju não está na lista de ninguém — e talvez seja exatamente por isso que vale a pena.' },
  { key: 'saoluis', nome: 'São Luís', num: '08',
    legenda: 'São Luís tem azulejo português e som de reggae em quase toda esquina — e quase ninguém coloca no roteiro.' },
  { key: 'teresina', nome: 'Teresina', num: '09',
    legenda: 'Teresina não tem praia — tem o encontro de dois rios e um pôr do sol de tirar o fôlego.' },
];

const HASHTAGS = '#nomandly #roteirodeviagem #nordeste #viagembarata';

function captionCidade(c) {
  return `${c.legenda}\n\nRoteiro completo de ${c.nome} — R$5, pronto na hora. Link na bio.\n\n${HASHTAGS}`;
}

const CAPTION_ROTEIRO = 'Qualquer lugar do mundo, do seu jeito. Roteiro personalizado, pronto na hora, por R$49,90. Link na bio.\n\n#nomandly #roteiropersonalizado #viagem';

const queue = [];

function addCarousel(c) {
  queue.push({
    id: `carousel-${c.key}`,
    type: 'carousel',
    caption: captionCidade(c),
    files: [1, 2, 3, 4].map(n => `content/carrosseis/${c.num}_${c.key}/slide_${n}.png`),
  });
}
function addReel(c) {
  queue.push({
    id: `reel-${c.key}`,
    type: 'reel',
    caption: captionCidade(c),
    file: `content/reels/${c.num}_${c.key}.mp4`,
    cover: `content/capas_reels/${c.num}_${c.key}_capa_reel.png`,
  });
}
function addSingle(c) {
  queue.push({
    id: `single-${c.key}`,
    type: 'single',
    caption: captionCidade(c),
    file: `content/feed/${c.num}_${c.key}.png`,
  });
}
function addRoteiroPersonalizado(n) {
  queue.push({
    id: `roteiro-personalizado-${n}`,
    type: 'carousel',
    caption: CAPTION_ROTEIRO,
    files: ['01_hero', '02_como_funciona', '03_qualquer_lugar', '04_cta']
      .map(f => `content/roteiro_personalizado/${f}.png`),
  });
}

// Rodada 1: carrossel por cidade, depois oferta personalizada
CIDADES.forEach(addCarousel);
addRoteiroPersonalizado(1);
// Rodada 2: reels por cidade, depois oferta personalizada
CIDADES.forEach(addReel);
addRoteiroPersonalizado(2);
// Rodada 3: post único por cidade, depois oferta personalizada
CIDADES.forEach(addSingle);
addRoteiroPersonalizado(3);

fs.writeFileSync(
  path.join(__dirname, 'queue.json'),
  JSON.stringify(queue, null, 2) + '\n'
);
console.log(`queue.json gerado com ${queue.length} posts (roda em loop indefinidamente).`);
