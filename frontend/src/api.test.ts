import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { EmployeeRow, UploadResponse, ValidateResponse, SubmitResponse } from './types';

// vi.hoisted ensures these are available inside the vi.mock factory
// (vi.mock is hoisted to top of file, before normal variable declarations)
const mockPost = vi.hoisted(() => vi.fn());
const mockGet  = vi.hoisted(() => vi.fn());

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({ post: mockPost, get: mockGet })),
  },
}));

// Import api AFTER mock is in place
const { uploadCsv, validateRows, submitRows, checkHealth, checkDbHealth } = await import('./api');

const row: EmployeeRow = {
  codigoEmpleado: '1',
  nombreEmpleado: 'Ana',
  diasNoLaborados: 0,
  horasExtrasSimples: 0,
  horasExtrasDobles: 0,
  mes: 12,
  anio: 2024,
};

beforeEach(() => {
  mockPost.mockReset();
  mockGet.mockReset();
});

// -----------------------------------------------------------------
// uploadCsv
// -----------------------------------------------------------------

describe('uploadCsv', () => {
  it('posts to /upload with FormData and returns response data', async () => {
    const response: UploadResponse = {
      rows: [row],
      monthOptions: [{ mes: 12, anio: 2024 }],
      multiMonth: false,
      parseWarnings: [],
    };
    mockPost.mockResolvedValue({ data: response });

    const file = new File(['content'], 'planilla.csv', { type: 'text/csv' });
    const result = await uploadCsv(file);

    expect(mockPost).toHaveBeenCalledOnce();
    const [path, body] = mockPost.mock.calls[0];
    expect(path).toBe('/upload');
    expect(body).toBeInstanceOf(FormData);
    expect(result).toEqual(response);
  });

  it('propagates axios errors to the caller', async () => {
    mockPost.mockRejectedValue({ response: { data: { message: 'error' } } });
    const file = new File([''], 'bad.csv');
    await expect(uploadCsv(file)).rejects.toBeDefined();
  });
});

// -----------------------------------------------------------------
// validateRows
// -----------------------------------------------------------------

describe('validateRows', () => {
  it('posts to /validate with rows array and returns response data', async () => {
    const response: ValidateResponse = { allValid: true, hasDuplicates: false, rows: [] };
    mockPost.mockResolvedValue({ data: response });

    const result = await validateRows([row]);

    expect(mockPost).toHaveBeenCalledWith('/validate', [row]);
    expect(result).toEqual(response);
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('network error'));
    await expect(validateRows([row])).rejects.toThrow('network error');
  });
});

// -----------------------------------------------------------------
// submitRows
// -----------------------------------------------------------------

describe('submitRows', () => {
  it('posts to /submit with rows array and returns response data', async () => {
    const response: SubmitResponse = {
      totalSubmitted: 1,
      totalSkippedDuplicates: 0,
      totalFailed: 0,
      rows: [],
    };
    mockPost.mockResolvedValue({ data: response });

    const result = await submitRows([row]);

    expect(mockPost).toHaveBeenCalledWith('/submit', [row]);
    expect(result).toEqual(response);
  });

  it('propagates errors', async () => {
    mockPost.mockRejectedValue(new Error('timeout'));
    await expect(submitRows([row])).rejects.toThrow('timeout');
  });
});

// -----------------------------------------------------------------
// checkHealth
// -----------------------------------------------------------------

describe('checkHealth', () => {
  it('resolves to undefined when GET /health succeeds', async () => {
    mockGet.mockResolvedValue({ data: { status: 'ok' } });

    await expect(checkHealth()).resolves.toBeUndefined();
    expect(mockGet).toHaveBeenCalledWith('/health', { timeout: 2_000 });
  });

  it('propagates errors when GET /health fails', async () => {
    mockGet.mockRejectedValue(new Error('connection refused'));
    await expect(checkHealth()).rejects.toThrow('connection refused');
  });
});

// -----------------------------------------------------------------
// checkDbHealth
// -----------------------------------------------------------------

describe('checkDbHealth', () => {
  it('resolves to undefined when GET /db-health succeeds', async () => {
    mockGet.mockResolvedValue({ data: { status: 'ok' } });

    await expect(checkDbHealth()).resolves.toBeUndefined();
    expect(mockGet).toHaveBeenCalledWith('/db-health', { timeout: 5_000 });
  });

  it('propagates errors when GET /db-health fails', async () => {
    mockGet.mockRejectedValue(new Error('service unavailable'));
    await expect(checkDbHealth()).rejects.toThrow('service unavailable');
  });
});
