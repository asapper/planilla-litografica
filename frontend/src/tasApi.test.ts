import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { TasUploadResult, AbsentEmployee, TasPeriod, ResolvedRow } from './tasTypes';

const mockPost = vi.hoisted(() => vi.fn());
const mockGet  = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ post: mockPost, get: mockGet })),
  },
}));

const {
  uploadTasFile,
  submitInactiveReview,
  resolveVerification,
  submitTas,
  getAbsentReview,
  setAbsentEmployeesActive,
  recomputeTas,
} = await import('./tasApi');

const mockResult: TasUploadResult = {
  uploadToken: 'tok-abc',
  flaggedSessions: [],
  inactiveEmployeesFound: [],
  absentActiveEmployees: [],
  usedFallbackHolidays: false,
  warnings: [],
};

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

// -----------------------------------------------------------------
// uploadTasFile
// -----------------------------------------------------------------

describe('uploadTasFile', () => {
  it('posts to /tas/upload with FormData and returns result', async () => {
    mockPost.mockResolvedValue({ data: mockResult });
    const file = new File(['col1,Autenticación'], 'tas.csv', { type: 'text/csv' });
    const result = await uploadTasFile(file);
    expect(mockPost).toHaveBeenCalledOnce();
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe('/tas/upload');
    expect(body).toBeInstanceOf(FormData);
    expect(result).toEqual(mockResult);
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('network error'));
    const file = new File([''], 'bad.csv');
    await expect(uploadTasFile(file)).rejects.toThrow('network error');
  });
});

// -----------------------------------------------------------------
// submitInactiveReview
// -----------------------------------------------------------------

describe('submitInactiveReview', () => {
  it('posts to /tas/inactive-review with token and decisions', async () => {
    mockPost.mockResolvedValue({ data: mockResult });
    const result = await submitInactiveReview('tok-abc', ['E1'], ['E2']);
    expect(mockPost).toHaveBeenCalledWith('/tas/inactive-review', {
      uploadToken: 'tok-abc',
      reactivate: ['E1'],
      ignore: ['E2'],
    });
    expect(result).toEqual(mockResult);
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('timeout'));
    await expect(submitInactiveReview('tok', [], [])).rejects.toThrow('timeout');
  });
});

// -----------------------------------------------------------------
// resolveVerification
// -----------------------------------------------------------------

describe('resolveVerification', () => {
  it('posts to /tas/resolve with token and resolutions', async () => {
    mockPost.mockResolvedValue({ data: mockResult });
    const resolutions = [{ sessionId: 1, resolvedStart: '08:00', resolvedEnd: '17:00' }];
    const result = await resolveVerification('tok-abc', resolutions);
    expect(mockPost).toHaveBeenCalledWith('/tas/resolve', {
      uploadToken: 'tok-abc',
      resolutions,
    });
    expect(result).toEqual(mockResult);
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('server error'));
    await expect(resolveVerification('tok', [])).rejects.toThrow('server error');
  });

  it('includes anio/mes/numeroDequincena in the body when period is provided', async () => {
    mockPost.mockResolvedValue({ data: mockResult });
    const resolutions = [{ sessionId: 1, resolvedStart: '08:00', resolvedEnd: '17:00' }];
    const period: TasPeriod = { anio: 2026, mes: 4, numeroDequincena: 1 };
    const result = await resolveVerification('tok-abc', resolutions, period);
    expect(mockPost).toHaveBeenCalledWith('/tas/resolve', {
      uploadToken: 'tok-abc',
      resolutions,
      anio: 2026,
      mes: 4,
      numeroDequincena: 1,
    });
    expect(result).toEqual(mockResult);
  });

  it('omits period fields from the body when period is not provided', async () => {
    mockPost.mockResolvedValue({ data: mockResult });
    const resolutions = [{ sessionId: 1, resolvedStart: '08:00', resolvedEnd: '17:00' }];
    await resolveVerification('tok-abc', resolutions);
    expect(mockPost).toHaveBeenCalledWith('/tas/resolve', {
      uploadToken: 'tok-abc',
      resolutions,
    });
  });
});

// -----------------------------------------------------------------
// submitTas
// -----------------------------------------------------------------

describe('submitTas', () => {
  it('posts to /tas/submit with token and returns jobId', async () => {
    mockPost.mockResolvedValue({ data: { jobId: 'job-123' } });
    const result = await submitTas('tok-abc');
    expect(mockPost).toHaveBeenCalledWith('/tas/submit', { uploadToken: 'tok-abc' });
    expect(result).toEqual({ jobId: 'job-123' });
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('failed'));
    await expect(submitTas('tok')).rejects.toThrow('failed');
  });
});

// -----------------------------------------------------------------
// getAbsentReview
// -----------------------------------------------------------------

describe('getAbsentReview', () => {
  it('gets /tas/absent-review/:token and returns absent employees', async () => {
    const employees: AbsentEmployee[] = [{ employeeId: 'E1', name: 'Ana' }];
    mockGet.mockResolvedValue({ data: { absentEmployees: employees } });
    const result = await getAbsentReview('tok-abc');
    expect(mockGet).toHaveBeenCalledWith('/tas/absent-review/tok-abc');
    expect(result.absentEmployees).toEqual(employees);
  });

  it('propagates errors', async () => {
    mockGet.mockRejectedValue(new Error('not found'));
    await expect(getAbsentReview('tok')).rejects.toThrow('not found');
  });
});

// -----------------------------------------------------------------
// deactivateAbsentEmployees
// -----------------------------------------------------------------

describe('setAbsentEmployeesActive', () => {
  it('posts to /tas/absent-review/:token/deactivate with employeeIds and active', async () => {
    mockPost.mockResolvedValue({ data: undefined });
    await setAbsentEmployeesActive('tok-abc', ['E1', 'E2'], false);
    expect(mockPost).toHaveBeenCalledWith('/tas/absent-review/tok-abc/deactivate', {
      employeeIds: ['E1', 'E2'],
      active: false,
    });
  });

  it('resolves to undefined on success', async () => {
    mockPost.mockResolvedValue({ data: null });
    await expect(setAbsentEmployeesActive('tok', ['E1'], true)).resolves.toBeUndefined();
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('forbidden'));
    await expect(setAbsentEmployeesActive('tok', [], false)).rejects.toThrow('forbidden');
  });
});

// -----------------------------------------------------------------
// recomputeTas
// -----------------------------------------------------------------

describe('recomputeTas', () => {
  it('posts to /tas/recompute/:token and returns resolvedRows', async () => {
    const resolvedRows: ResolvedRow[] = [
      { codigoEmpleado: 'E1', nombreEmpleado: 'Ana', diasNoLaborados: 0, horasExtrasSimples: 2, horasExtrasDobles: 0, mes: 3, anio: 2026, numeroDequincena: 1, diasTurnoAmbiguo: 0, accruesOvertime: true },
    ];
    mockPost.mockResolvedValue({ data: { uploadToken: 'tok-abc', resolvedRows } });
    const result = await recomputeTas('tok-abc');
    expect(mockPost).toHaveBeenCalledWith('/tas/recompute/tok-abc');
    expect(result).toEqual({ uploadToken: 'tok-abc', resolvedRows });
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('invalid token'));
    await expect(recomputeTas('tok')).rejects.toThrow('invalid token');
  });
});
