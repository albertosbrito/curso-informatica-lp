const PAGE_URL = 'https://raw.githubusercontent.com/albertosbrito/curso-informatica-lp/main/cracha-ia/index.html';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    if (url.pathname === '/' && request.method === 'GET') {
      return servePage();
    }

    if (url.pathname === '/api/generate-shirt-image' && request.method === 'POST') {
      return handleGenerate(request, env, ctx);
    }

    return cors(json({ error: 'Endpoint não encontrado.', dica: 'Abra / para a página ou POST /api/generate-shirt-image para gerar a foto.' }, 404));
  }
};

async function servePage() {
  const page = await fetch(PAGE_URL, { cf: { cacheTtl: 60, cacheEverything: true } });
  if (!page.ok) {
    return new Response('Página do crachá indisponível no GitHub.', { status: 502 });
  }
  let html = await page.text();
  html = html.replaceAll('file:///api/generate-shirt-image', '/api/generate-shirt-image');
  html = html.replaceAll('https://cracha-ia-da-torcida-api.alberto-s-brito.workers.dev/api/generate-shirt-image', '/api/generate-shirt-image');
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function cors(response) {
  const h = new Headers(response.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-methods', 'POST, OPTIONS, GET');
  h.set('access-control-allow-headers', 'content-type, authorization');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}

function dataUrlToFile(dataUrl, filename) {
  const match = /^data:(.*?);base64,(.*)$/.exec(dataUrl || '');
  if (!match) throw new Error('Selfie inválida. Envie uma imagem válida.');
  const mime = match[1] || 'image/png';
  const bin = atob(match[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

async function handleGenerate(request, env, ctx) {
  if (!env.OPENAI_API_KEY) return cors(json({ error: 'OPENAI_API_KEY não configurada no Worker.' }, 500));

  let body;
  try { body = await request.json(); }
  catch { return cors(json({ error: 'JSON inválido.' }, 400)); }

  const shirt = body.shirt === 'azul'
    ? 'azul reserva oficial da Seleção Brasileira de futebol'
    : 'amarela titular oficial da Seleção Brasileira de futebol';
  let selfie;
  try { selfie = dataUrlToFile(body.selfieDataUrl, 'selfie.png'); }
  catch (e) { return cors(json({ error: e.message }, 400)); }

  const prompt = `
Edite esta fotografia real. Mude SOMENTE duas coisas:

1. A roupa: substitua pela camisa ${shirt}, com caimento realista, tecido esportivo premium, brilho sutil, gola, mangas e detalhes fiéis ao uniforme oficial.
2. O fundo: estádio de futebol lotado à noite, desfocado (bokeh suave), atrás da pessoa.

Todo o resto permanece idêntico à foto enviada: mesmo rosto, mesma expressão, mesmo olhar, mesma barba, mesmo cabelo, mesmo tom de pele, mesma iluminação sobre o rosto e mesma posição da cabeça.

Isto é uma edição da foto existente, não a criação de uma pessoa nova.

O resultado deve parecer que a mesma foto foi tirada dentro do estádio: enquadramento fechado de cabeça e ombros, pessoa centralizada, de frente para a câmera, com margem visível acima da cabeça, sem cortar testa, cabelo ou queixo, fotografia editorial realista.
`.trim();

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', selfie);
  form.append('prompt', prompt);
  form.append('input_fidelity', 'high');
  form.append('quality', 'high');
  form.append('size', '1024x1536');

  const aiResp = await fetch('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: form
  });

  const text = await aiResp.text();
  if (!aiResp.ok) return cors(json({ error: extractOpenAIError(text) }, aiResp.status));

  let payload;
  try { payload = JSON.parse(text); }
  catch { return cors(json({ error: 'Resposta inválida da OpenAI.' }, 502)); }

  const b64 = payload?.data?.[0]?.b64_json;
  if (!b64) return cors(json({ error: 'A OpenAI não retornou imagem.' }, 502));

  const meta = {
    nome: body.nome || body.name || body.nomeCracha || '',
    cidade: body.cidade || body.city || '',
    jogador: body.jogador || body.jogadorChave || '',
    camisa: body.shirt === 'azul' ? 'Camisa 2 azul' : 'Camisa 1 amarela',
    userAgent: request.headers.get('user-agent') || '',
    country: request.cf?.country || '',
    timestamp: new Date().toLocaleString('pt-BR', { timeZone: 'America/Maceio' })
  };

  if (ctx) ctx.waitUntil(notifyTelegram(env, meta));
  else notifyTelegram(env, meta).catch(() => {});

  return cors(json({ imageDataUrl: `data:image/png;base64,${b64}` }));
}

async function notifyTelegram(env, meta) {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;

  const lines = [
    '🟡 Novo crachá gerado',
    '',
    `Camisa: ${meta.camisa}`,
    meta.nome ? `Nome: ${meta.nome}` : null,
    meta.cidade ? `Cidade: ${meta.cidade}` : null,
    meta.jogador ? `Jogador-chave: ${meta.jogador}` : null,
    meta.country ? `País: ${meta.country}` : null,
    `Hora: ${meta.timestamp}`
  ].filter(Boolean);

  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text: lines.join('\n'),
      disable_web_page_preview: true
    })
  });
}

function extractOpenAIError(text) {
  try { return JSON.parse(text)?.error?.message || 'Falha ao gerar imagem na OpenAI.'; }
  catch { return text.slice(0, 500) || 'Falha ao gerar imagem na OpenAI.'; }
}
