// A second copy of the session kept by the app itself, on this PC, independent of the backend:
// the uploaded file and every decision. If the backend's saved session is ever missing or
// unreadable (a database fault, a version change), the session is rebuilt from this copy.

const FILE_KEY = 'planilla.tas.localCopy.file';
const META_KEY = 'planilla.tas.localCopy';

export interface LocalCopy {
  fileName: string;
  fileBase64: string;
  savedAt: string;
  snapshot: Record<string, unknown> | null;
  // Each flagged day's identity (employee|date|scans) by session id, as it was in verification.
  // "Revisar" rewrites a day's scans and drops resolved days from the list, so the identities are
  // kept from before it: a rebuild matches the decisions to the new session's days with them.
  dayKeys: Record<string, string>;
  // Set once the payroll submission starts: from then on the backend owns the session, and
  // rebuilding it from here could send it twice.
  submitted: boolean;
}

type Meta = Omit<LocalCopy, 'fileBase64'>;

interface DayLike { sessionId?: unknown; employeeId?: unknown; date?: unknown; scans?: unknown }

export function dayKey(session: { employeeId: string; date: string; scans: string[] }): string {
  return `${session.employeeId}|${session.date}|${session.scans.join(',')}`;
}

export function dayKeysOf(snapshot: Record<string, unknown> | null): Record<string, string> {
  const keys: Record<string, string> = {};
  const sessions = Array.isArray(snapshot?.flaggedSessions) ? (snapshot.flaggedSessions as DayLike[]) : [];
  for (const s of sessions) {
    if (s && typeof s.sessionId === 'number' && typeof s.employeeId === 'string' && typeof s.date === 'string'
      && Array.isArray(s.scans)) {
      keys[s.sessionId] = dayKey({ employeeId: s.employeeId, date: s.date, scans: s.scans as string[] });
    }
  }
  return keys;
}

function readMeta(): Meta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Meta>;
    if (typeof parsed.fileName !== 'string' || typeof parsed.savedAt !== 'string') return null;
    const snapshot = parsed.snapshot && typeof parsed.snapshot === 'object' ? parsed.snapshot : null;
    const dayKeys = parsed.dayKeys && typeof parsed.dayKeys === 'object' ? parsed.dayKeys : {};
    return { fileName: parsed.fileName, savedAt: parsed.savedAt, snapshot, dayKeys, submitted: parsed.submitted === true };
  } catch {
    return null;
  }
}

function read(): LocalCopy | null {
  const meta = readMeta();
  if (!meta) return null;
  try {
    const fileBase64 = localStorage.getItem(FILE_KEY);
    return fileBase64 === null ? null : { ...meta, fileBase64 };
  } catch {
    return null;
  }
}

// A copy that could not be written in full is removed rather than left stale: an older snapshot
// offered as "the saved session" would bring back decisions the user has since changed.
function writeMeta(meta: Meta): boolean {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
    return true;
  } catch (err) {
    console.warn('No se pudo guardar la copia local de la sesión.', err);
    clearLocalCopy();
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

function isVerifying(snapshot: Record<string, unknown> | null): boolean {
  return snapshot?.tasView === 'verification' || snapshot?.tasView === 'inactiveReview';
}

// A new upload starts a new copy: the file now, the decisions as they are made.
export function startLocalCopy(fileName: string, bytes: Uint8Array, snapshot: Record<string, unknown> | null = null): boolean {
  clearLocalCopy();
  try {
    localStorage.setItem(FILE_KEY, toBase64(bytes));
  } catch (err) {
    console.warn('No se pudo guardar la copia local del archivo.', err);
    clearLocalCopy();
    return false;
  }
  return writeMeta({
    fileName, savedAt: new Date().toISOString(), snapshot, submitted: false,
    dayKeys: isVerifying(snapshot) ? dayKeysOf(snapshot) : {},
  });
}

export function saveLocalSnapshot(snapshot: Record<string, unknown>): boolean {
  const meta = readMeta();
  if (!meta) return false;
  // Days are identified while they are still as uploaded; after "Revisar" the earlier keys stand.
  const dayKeys = isVerifying(snapshot) ? dayKeysOf(snapshot) : meta.dayKeys;
  return writeMeta({ ...meta, snapshot, dayKeys, savedAt: new Date().toISOString() });
}

export function setLocalCopySubmitted(submitted: boolean): void {
  const meta = readMeta();
  if (meta && meta.submitted !== submitted) writeMeta({ ...meta, submitted });
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
    localStorage.removeItem(META_KEY);
    localStorage.removeItem(FILE_KEY);
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
