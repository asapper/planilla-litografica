function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function matchesSearch(text: string, query: string): boolean {
  return normalize(text).includes(normalize(query));
}
