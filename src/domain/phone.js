export function normalizeBrazilianMobile(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (!digits.startsWith('55') && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  if (!/^55\d{10,11}$/.test(digits)) return '';
  const local = digits.slice(2);
  const ddd = Number(local.slice(0, 2));
  if (ddd < 11 || ddd > 99) return '';
  return digits;
}

export function uniquePhones(values = []) {
  return [...new Set(values.map(normalizeBrazilianMobile).filter(Boolean))];
}

export function maskPhone(value) {
  const phone = normalizeBrazilianMobile(value);
  return phone ? `${phone.slice(0, 4)}*****${phone.slice(-4)}` : '';
}
