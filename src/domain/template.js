const ALLOWED = new Set(['nome', 'primeiro_nome', 'classificacao', 'codigo_infracao', 'descricao_infracao', 'numero_processo', 'arquivo_origem']);

export function templateVariables(template) {
  return [...String(template || '').matchAll(/{{\s*([a-z_]+)\s*}}/gi)].map((match) => match[1].toLowerCase());
}

export function validateTemplate(template) {
  const text = String(template || '').trim();
  if (!text) throw new Error('A mensagem da campanha e obrigatoria.');
  if (text.length > 4096) throw new Error('A mensagem excede 4096 caracteres.');
  const unknown = [...new Set(templateVariables(text).filter((name) => !ALLOWED.has(name)))];
  if (unknown.length) throw new Error(`Variaveis desconhecidas: ${unknown.join(', ')}.`);
  return text;
}

export function renderTemplate(template, lead) {
  const name = String(lead.name || '').trim();
  const values = {
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] || '',
    classificacao: lead.classification || '',
    codigo_infracao: lead.infractionCode || '',
    descricao_infracao: lead.infractionDescription || '',
    numero_processo: lead.processNumber || '',
    arquivo_origem: lead.sourceFile || ''
  };
  return validateTemplate(template).replace(/{{\s*([a-z_]+)\s*}}/gi, (_all, key) => String(values[key.toLowerCase()] ?? ''));
}
