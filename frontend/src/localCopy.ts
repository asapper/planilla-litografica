// A second copy of the session kept by the app itself, on this PC, independent of the backend:
// the uploaded file and every decision. If the backend's saved session is ever missing or
// unreadable (a database fault, a version change), the session is rebuilt from this copy.

const KEY = 'planilla.tas.localCopy';

export interface LocalCopy {
  fileName: string;
  fileBase64: string;
  savedAt: string;
  snapshot: Record<string, unknown> | null;
  // Set once the payroll submission starts: from then on the backend owns the session, and
  // rebuilding it from here could send it twice.
  submitted: boolean;
}

function read(): LocalCopy | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalCopy>;
    if (typeof parsed.fileName !== 'string' || typeof parsed.fileBase64 !== 'string'
      || typeof parsed.savedAt !== 'string') return null;
    const snapshot = parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : null;
    return {
      fileName: parsed.fileName, fileBase64: parsed.fileBase64, savedAt: parsed.savedAt, snapshot,
      submitted: parsed.submitted === true,
    };
  } catch {
    return null;
  }
}

function write(copy: LocalCopy): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(copy));
    return true;
  } catch (err) {
    console.warn('No se pudo guardar la copia local de la sesión.', err);
    return false;
  }
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function fileBytes(file: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}

// A new upload starts a new copy: the file now, the decisions as they are made.
export function startLocalCopy(fileName: string, bytes: Uint8Array, snapshot: Record<string, unknown> | null = null): boolean {
  return write({ fileName, fileBase64: toBase64(bytes), savedAt: new Date().toISOString(), snapshot, submitted: false });
}

export function saveLocalSnapshot(snapshot: Record<string, unknown>): boolean {
  const copy = read();
  if (!copy) return false;
  return write({ ...copy, snapshot, savedAt: new Date().toISOString() });
}

export function markLocalCopySubmitted(): void {
  const copy = read();
  if (copy && !copy.submitted) write({ ...copy, submitted: true });
}

// A copy worth offering: decisions were saved and the submission never started.
export function recoverableLocalCopy(): LocalCopy | null {
  const copy = read();
  return copy && copy.snapshot && !copy.submitted ? copy : null;
}

export function loadLocalCopy(): LocalCopy | null {
  return read();
}

export function clearLocalCopy(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

export function localCopyFile(copy: LocalCopy): File {
  const binary = atob(copy.fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], copy.fileName, { type: 'text/csv' });
}
