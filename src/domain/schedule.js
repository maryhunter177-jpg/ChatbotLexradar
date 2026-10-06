const WEEKDAY = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function validTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

export function normalizeDeliverySchedule(input = {}) {
  const enabled = input.enabled === true;
  const timeZone = String(input.timeZone || 'America/Sao_Paulo');
  try { new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date()); } catch { throw new Error('Fuso horario invalido.'); }
  const weekdays = [...new Set((Array.isArray(input.weekdays) ? input.weekdays : [1, 2, 3, 4, 5]).map(Number))].sort();
  if (!weekdays.length || weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error('Dias de envio invalidos.');
  const start = String(input.start || '09:00');
  const end = String(input.end || '18:00');
  if (!validTime(start) || !validTime(end) || start >= end) throw new Error('Janela de horario invalida.');
  return { enabled, timeZone, weekdays, start, end };
}

export function isWithinDeliverySchedule(date, input) {
  const schedule = normalizeDeliverySchedule(input);
  if (!schedule.enabled) return true;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: schedule.timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const day = WEEKDAY[parts.weekday];
  const current = `${parts.hour}:${parts.minute}`;
  return schedule.weekdays.includes(day) && current >= schedule.start && current < schedule.end;
}
