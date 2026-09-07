# Nomandly — automação de posts no Instagram

Publica automaticamente, todo dia às 8h (horário de Brasília), o próximo post
da fila em `scripts/queue.json` na conta **@nomandly_**, usando a Instagram
Graph API diretamente (sem ferramenta de agendamento de terceiros).

## Como funciona

1. O GitHub Actions (`.github/workflows/daily-post.yml`) dispara todo dia às 8h.
2. `scripts/publish.js` lê `state.json` pra saber qual é o próximo post da fila,
   sobe as imagens/vídeo desse post pro Cloudinary (só pra gerar uma URL
   pública — a Graph API exige isso) e publica via Instagram Graph API.
3. Depois de publicar, o workflow avança `state.json` e commita de volta no
   repositório. Quando a fila (30 posts) termina, ela recomeça do início
   (loop infinito) — ninguém precisa alimentar a fila manualmente.

## Configuração necessária (uma vez só)

Em **Settings → Secrets and variables → Actions → New repository secret**,
cadastre:

| Secret | Valor |
|---|---|
| `IG_BUSINESS_ACCOUNT_ID` | `17841438959055537` |
| `IG_LONG_LIVED_TOKEN` | token de 60 dias gerado pelo app "Nomandly Automacao" |
| `CLOUDINARY_CLOUD_NAME` | Cloud Name da conta Cloudinary |
| `CLOUDINARY_API_KEY` | API Key da conta Cloudinary |
| `CLOUDINARY_API_SECRET` | API Secret da conta Cloudinary |

## Renovando o token de acesso

O token de longa duração do Instagram expira a cada ~60 dias. Antes de
expirar, gere um novo (Graph API Explorer → trocar por token de longa
duração, mesmo processo de sempre) e atualize o secret
`IG_LONG_LIVED_TOKEN` — sem isso, os posts param de sair.

## Testar sem publicar de verdade

Aba **Actions** → workflow "Post diário no Instagram" → **Run workflow** →
marque `dry_run` → Run. Ele mostra no log qual post seria publicado, sem
enviar nada de verdade pro Instagram nem sobe nada pro Cloudinary.

## Editar a fila de posts

A fila foi gerada por `scripts/build_queue.js` a partir do conteúdo real já
produzido (9 carrosséis, 9 reels, 9 posts únicos, por cidade, mais o carrossel
da oferta de roteiro personalizado). Pra mudar a ordem ou os textos, edite
`scripts/queue.json` diretamente (ou ajuste `build_queue.js` e rode
`npm run build-queue` de novo).
