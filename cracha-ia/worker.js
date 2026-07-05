export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    if (url.pathname.endsWith('/api/generate-shirt-image') && request.method === 'POST') {
      return handleGenerate(request, env);
    }

    return cors(json({ error: 'Endpoint não encontrado.' }, 404));
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function cors(response) {
  const h = new Headers(response.headers);
  h.set('access-control-allow-origin', '*');
  h.set('access-control-allow-methods', 'POST, OPTIONS');
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

  const shirt = body.shirt === 'azul' ? 'camisa azul reserva do Brasil' : 'camisa amarela titular do Brasil';
  let selfie;
  try { selfie = dataUrlToFile(body.selfieDataUrl, 'selfie.png'); }
  catch (e) { return cors(json({ error: e.message }, 400)); }

  const prompt = `Transforme a pessoa da selfie em uma foto vertical hiper-realista de campanha esportiva. A pessoa deve aparecer do peito até a cabeça, olhando para a câmera, vestindo ${shirt}, com tecido premium, brilho visível, textura real, escudo inspirado no Brasil, gola e mangas bem definidas. Preserve a identidade facial da selfie. Não coloque a selfie em círculo. Não faça colagem. Não adicione texto, crachá, botões, moldura ou interface. Fundo: estádio moderno à noite, luzes fortes, clima de convocação, fotografia publicitária, alta nitidez.`;

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
