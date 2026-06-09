export function isTasFile(file: File): Promise<boolean> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const text = (e.target?.result as string) ?? '';
      const firstLines = text.split('\n').slice(0, 3).join('\n');
      resolve(firstLines.includes('Autenticación'));
    };
    reader.onerror = () => resolve(false);
    reader.readAsText(file.slice(0, 2048));
  });
}
