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
  // Decisions already sent with "Revisar" that the screen then cleared for a second round of
  // verification. A rebuild re-applies them under the current ones.
  sent: Record<string, Record<string, unknown>>;
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
    const sent = parsed.sent && typeof parsed.sent === 'object' ? parsed.sent : {};
    return {
      fileName: parsed.fileName, savedAt: parsed.savedAt, snapshot, dayKeys, sent, submitted: parsed.submitted === true,
    };
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

// Identities are recorded in verification and never replaced afterwards: "Revisar" rewrites a day's
// scans and drops resolved days, and "Cambiar quincena" returns to verification with that list, so
// the first identity seen for a session id is the one that matches a fresh upload. Before the
// inactive-employee step is done there is nothing to record: the backend renumbers the days after it.
function nextDayKeys(snapshot: Record<string, unknown> | null, known: Record<string, string>): Record<string, string> {
  if (snapshot?.tasView === 'inactiveReview') return {};
  if (snapshot?.tasView === 'verification') return { ...dayKeysOf(snapshot), ...known };
  return known;
}

// A new upload starts a new copy: the file now, the decisions as they are made. `uploadedDays` are the
// identities from the upload itself, used when the copy starts after the user has already moved on
// (the file is read alongside the upload and can finish late).
export function startLocalCopy(
  fileName: string, bytes: Uint8Array, snapshot: Record<string, unknown> | null = null,
  uploadedDays: Record<string, string> = {},
): boolean {
  clearLocalCopy();
  try {
    localStorage.setItem(FILE_KEY, toBase64(bytes));
  } catch (err) {
    console.warn('No se pudo guardar la copia local del archivo.', err);
    clearLocalCopy();
    return false;
  }
  return writeMeta({
    fileName, savedAt: new Date().toISOString(), snapshot, submitted: false, sent: {},
    dayKeys: nextDayKeys(snapshot, snapshot?.tasView === 'inactiveReview' ? {} : uploadedDays),
  });
}

export function saveLocalSnapshot(snapshot: Record<string, unknown>): boolean {
  const meta = readMeta();
  if (!meta) return false;
  return writeMeta({ ...meta, snapshot, dayKeys: nextDayKeys(snapshot, meta.dayKeys), savedAt: new Date().toISOString() });
}

// After a rebuild the copy describes the new session: its days are numbered afresh, and the sent
// decisions are already folded into the current ones. Old identities kept under reused ids would
// otherwise put a decision on another day in a later rebuild.
export function rebaseLocalCopy(snapshot: Record<string, unknown>): boolean {
  const meta = readMeta();
  if (!meta) return false;
  return writeMeta({
    ...meta, snapshot, sent: {}, submitted: false, savedAt: new Date().toISOString(),
    dayKeys: snapshot.tasView === 'verification' ? dayKeysOf(snapshot) : {},
  });
}

export function rememberSentDecisions(decisions: Record<string, Record<string, unknown>>): void {
  const meta = readMeta();
  if (!meta) return;
  const sent = { ...meta.sent };
  for (const [name, values] of Object.entries(decisions)) sent[name] = { ...(sent[name] ?? {}), ...values };
  writeMeta({ ...meta, sent });
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
