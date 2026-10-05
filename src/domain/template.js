const ALLOWED = new Set(['nome', 'primeiro_nome', 'nome_atendente', 'classificacao', 'codigo_infracao', 'descricao_infracao', 'numero_processo', 'arquivo_origem']);

export const INFRACTION_OPENING = 'Olá {{primeiro_nome}}, meu nome é {{nome_atendente}}. Identificamos através do Diário Oficial a multa {{descricao_infracao}}.';

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

export function buildProfileTemplate(profile, senderName, continuation = '') {
  if (profile !== 'infraction_first_contact') throw new Error('Perfil de mensagem desconhecido.');
  const safeSender = String(senderName || '').trim();
  if (safeSender.length < 2 || safeSender.length > 80 || /[{}]/.test(safeSender)) throw new Error('Nome do atendente invalido.');
  const suffix = String(continuation || '').trim();
  return validateTemplate(`${INFRACTION_OPENING}${suffix ? `\n\n${suffix}` : ''}`);
}

export function renderTemplate(template, lead, context = {}) {
  const name = String(lead.name || '').trim();
  const values = {
    nome: name,
    primeiro_nome: name.split(/\s+/)[0] || '',
    nome_atendente: context.senderName || '',
    classificacao: lead.classification || '',
    codigo_infracao: lead.infractionCode || '',
    descricao_infracao: lead.infractionDescription || '',
    numero_processo: lead.processNumber || '',
    arquivo_origem: lead.sourceFile || ''
  };
  return validateTemplate(template).replace(/{{\s*([a-z_]+)\s*}}/gi, (_all, key) => String(values[key.toLowerCase()] ?? ''));
}
