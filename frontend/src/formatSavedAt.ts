const pad = (n: number) => String(n).padStart(2, '0');

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatSavedAt(iso: string, now: Date = new Date()): string {
  const saved = new Date(iso);
  const time = `${pad(saved.getHours())}:${pad(saved.getMinutes())}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (isSameDay(saved, now)) return `hoy a las ${time}`;
  if (isSameDay(saved, yesterday)) return `ayer a las ${time}`;
  return `el ${pad(saved.getDate())}/${pad(saved.getMonth() + 1)}/${saved.getFullYear()} a las ${time}`;
}
