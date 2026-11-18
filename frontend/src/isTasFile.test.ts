import { describe, it, expect, vi } from 'vitest';
import { isTasFile } from './isTasFile';

const HEADER = '"No.","Fecha y hora","Evento","Nombre de usuario","ID de usuario"';

describe('isTasFile', () => {
  it('recognizes a TAS export by the authentication event in its first lines', async () => {
    const file = new File([`${HEADER}\n"1","2026/10/01 07:00","1:N Autenticación exitosa (Rostro)","Ana","1"\n`], 'a.csv');
    await expect(isTasFile(file)).resolves.toBe(true);
  });

  it('rejects a file without it in the first three lines', async () => {
    const lines = [HEADER, 'a', 'b', '"1","2026/10/01 07:00","1:N Autenticación exitosa (Rostro)","Ana","1"'];
    await expect(isTasFile(new File([lines.join('\n')], 'b.csv'))).resolves.toBe(false);
    await expect(isTasFile(new File([''], 'empty.csv'))).resolves.toBe(false);
  });

  it('rejects a file that cannot be read', async () => {
    const spy = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function (this: FileReader) {
      this.onerror?.(new ProgressEvent('error') as ProgressEvent<FileReader>);
    });
    await expect(isTasFile(new File(['x'], 'c.csv'))).resolves.toBe(false);
    spy.mockRestore();
  });
});
