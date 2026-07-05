const PAGE_URL = 'https://raw.githubusercontent.com/albertosbrito/curso-informatica-lp/main/cracha-ia/index.html';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    if (url.pathname === '/' && request.method === 'GET') {
      return servePage();
    }

    if (url.pathname === '/api/generate-shirt-image' && request.method === 'POST') {
      return handleGenerate(request, env);
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

async function handleGenerate(request, env) {
  if (!env.OPENAI_API_KEY) return cors(json({ error: 'OPENAI_API_KEY não configurada no Worker.' }, 500));

  let body;
  try { body = await request.json(); }
  catch { return cors(json({ error: 'JSON inválido.' }, 400)); }

  const shirt = body.shirt === 'azul' ? 'azul' : 'amarela';
  let selfie;
  try { selfie = dataUrlToFile(body.selfieDataUrl, 'selfie.png'); }
  catch (e) { return cors(json({ error: e.message }, 400)); }

  const prompt = `
Transforme esta imagem - sem distorcer a face - em uma foto de jogador da seleção brasileira com a camisa ${shirt} dentro de um estádio estúdio lotado.

Escolha um fundo em cor complementar que valorize o tom de pele da pessoa.

Mantenha um enquadramento fechado de cabeça e ombros, com a pessoa centralizada e de frente para a câmera, com uma expressão otimista.

Aplique iluminação direcional com sombras sutis.

Preserve rigorosamente a identidade da pessoa da selfie:
- não altere o formato do rosto;
- não altere olhos, nariz, boca ou sorriso;
- não afine ou alargue a face;
- não rejuveneça nem envelheça;
- não mude barba, cabelo ou sobrancelhas;
- preserve exatamente os traços faciais e a proporção da cabeça.

A única transformação desejada é substituir a roupa pela camisa ${shirt} da Seleção Brasileira, mantendo aparência refinada, minimalista e editorial, como um ensaio de revista.

Preserve os tons naturais da pele.

A imagem deve parecer uma fotografia profissional real, não uma ilustração nem uma pessoa diferente.
`.trim();

  const form = new FormData();
  form.append('model', 'gpt-image-1');
  form.append('image', selfie);
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');

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

  return cors(json({ imageDataUrl: `data:image/png;base64,${b64}` }));
}

function extractOpenAIError(text) {
  try { return JSON.parse(text)?.error?.message || 'Falha ao gerar imagem na OpenAI.'; }
  catch { return text.slice(0, 500) || 'Falha ao gerar imagem na OpenAI.'; }
}
