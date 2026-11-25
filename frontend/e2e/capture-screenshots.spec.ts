import { test, type Page } from '@playwright/test';
import * as mock from './mock-data';
import { DRAFT_UI_VERSION } from '../src/draftVersion';
import type { DraftSummary } from '../src/tasTypes';

const SCREENSHOT_DIR = '../docs/screenshots';

const MOCK_CSV = [
  'Autenticación de marcaciones TAS',
  'Código,Nombre,Fecha,Hora',
  'E001,García López María Elena,2026-06-03,06:02',
].join('\n');

async function mockHealthEndpoints(page: Page, incompletePeriods: unknown[] = []) {
  await page.route('**/api/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/db-health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  // No saved session unless a test routes one, and the file covers the whole quincena.
  await page.route('**/api/tas/draft', route => route.fulfill({ status: 204 }));
  await page.route('**/api/tas/coverage/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ incompletePeriods }) }),
  );
}

async function mockDraftSummary(page: Page, summary: DraftSummary) {
  await page.route('**/api/tas/draft', route =>
    route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(summary) })
      : route.fulfill({ status: 204 }),
  );
}

async function verificationWith(page: Page, sessions: unknown[]) {
  await mockTasUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: sessions as typeof mock.ALL_FLAGGED_SESSIONS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  });
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForTimeout(300);
}

async function mockConfigEndpoints(page: Page) {
  await page.route('**/api/config/shifts', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.SHIFTS) });
    }
    return route.continue();
  });
  await page.route('**/api/config/employees**', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.EMPLOYEES) });
    }
    return route.continue();
  });
  await page.route('**/api/config/holidays**', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.HOLIDAYS) });
    }
    return route.continue();
  });
  await page.route('**/api/config/general', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.GENERAL_CONFIG) });
    }
    return route.continue();
  });
}

async function mockTasUpload(page: Page, result: typeof mock.UPLOAD_RESULT_WITH_FLAGS) {
  await page.route('**/api/tas/upload', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) }),
  );
}

async function mockTasResolve(page: Page, result: typeof mock.RESOLVE_RESULT_TO_REVIEW) {
  await page.route('**/api/tas/resolve', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) }),
  );
}

async function mockCheckDuplicates(page: Page, duplicates: string[] = []) {
  await page.route('**/api/tas/check-duplicates', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ duplicates }) }),
  );
}

async function mockSubmitTas(page: Page) {
  await page.route('**/api/tas/submit', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId: 'job-001' }) }),
  );
}

async function mockJobStatus(page: Page, status: typeof mock.JOB_STATUS_SUCCESS) {
  await page.route('**/api/tas/jobs/**', route => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) });
    }
    return route.continue();
  });
}

async function mockRecomputeTas(page: Page) {
  await page.route('**/api/tas/recompute', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ resolvedRows: mock.RESOLVED_ROWS, sessionSummaries: mock.SESSION_SUMMARIES }),
    }),
  );
}

// Overtime nobody approved goes as 0 and asks first; these flows are about what comes after sending.
async function approveAllAndSend(page: Page) {
  const approve = page.getByRole('button', { name: /^Aprobar horas extra/ });
  while (await approve.count() > 0) await approve.first().click();
  await page.getByRole('button', { name: /^Enviar$/ }).click();
}

async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `${SCREENSHOT_DIR}/${name}`, fullPage: false });
}

async function waitForApp(page: Page) {
  await page.goto('/');
  await page.waitForSelector('text=Cargador de Planilla', { timeout: 15_000 });
}

async function uploadFile(page: Page) {
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: 'Reporte TAS Junio 2026.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(MOCK_CSV),
  });
}

async function setTasStoreState(page: Page, state: Record<string, unknown>) {
  await page.evaluate((s) => {
    const store = (window as unknown as Record<string, { setState: (s: unknown) => void } | undefined>).__ZUSTAND_TAS_STORE__;
    if (store) store.setState(s);
  }, state);
}

// ── 1. Empty state ─────────────────────────────────────────────────

test('01 - empty state', async ({ page }) => {
  await mockHealthEndpoints(page);
  await waitForApp(page);
  await page.waitForSelector('text=Seleccionar archivo');
  await screenshot(page, '01-empty-state.png');
});

// ── 2. Processing ──────────────────────────────────────────────────

test('02 - processing screen', async ({ page }) => {
  await mockHealthEndpoints(page);
  await page.route('**/api/tas/upload', route =>
    new Promise((resolve) => setTimeout(() => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mock.UPLOAD_RESULT_WITH_FLAGS) });
      resolve(undefined);
    }, 60_000)),
  );
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=procesando', { timeout: 10_000 });
  await screenshot(page, '02-processing.png');
});

// ── 3. Inactive review ─────────────────────────────────────────────

test('03 - inactive employee review', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockTasUpload(page, mock.UPLOAD_RESULT_WITH_INACTIVE);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Empleados inactivos detectados', { timeout: 10_000 });
  await screenshot(page, '03-inactive-review.png');
});

// ── 4. Verification: all flags ─────────────────────────────────────

test('04 - verification: all flag types', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockTasUpload(page, { ...mock.UPLOAD_RESULT_WITH_FLAGS, availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }] });
  await mockTasResolve(page, mock.RESOLVE_RESULT_TO_REVIEW);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForTimeout(500);
  await screenshot(page, '04-verification-overview.png');
});

// ── 5. Verification: best fit shift ────────────────────────────────

test('05 - verification: best fit shift', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [mock.FLAGGED_BEST_FIT],
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  // BEST_FIT_SHIFT with needsResolution=false and single period goes to review
  await page.waitForTimeout(2000);
  await screenshot(page, '05-verification-best-fit.png');
});

// ── 6. Verification: period selector ───────────────────────────────

test('06 - verification: period selector', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockTasUpload(page, { ...mock.UPLOAD_RESULT_WITH_FLAGS, availablePeriods: mock.AVAILABLE_PERIODS });
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.waitForSelector('text=Periodo');
  await screenshot(page, '06-verification-period-selector.png');
});

// ── 7. Verification: all confirmed ─────────────────────────────────

test('07 - verification: all confirmed via store', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockTasResolve(page, mock.RESOLVE_RESULT_TO_REVIEW);
  await mockCheckDuplicates(page);
  // Single period, single flag needing resolution
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [mock.FLAGGED_MISSING_EXIT],
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  // Set resolved sessions directly via store
  await setTasStoreState(page, {
    resolvedSessions: {
      [mock.FLAGGED_MISSING_EXIT.sessionId]: { resolvedStart: '06:02', resolvedEnd: '14:00' },
    },
  });
  await page.waitForTimeout(500);
  await page.waitForSelector('text=Todos los grupos están resueltos');
  await screenshot(page, '07-verification-confirmed.png');
});

// ── 8. Review list view ────────────────────────────────────────────

test('08 - review list view', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page, ['E003']);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: mock.ALL_FLAGGED_SESSIONS.map(s => ({ ...s, needsResolution: false })),
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await page.waitForSelector('[aria-label^="Días no laborados"]', { timeout: 5_000 });
  // One row approved and one adjusted by hand, so the picture shows each state of "Horas extra".
  await page.getByRole('button', { name: 'Aprobar horas extra Hernández Ruiz, Carlos Alberto' }).click();
  await page.getByLabel('Extras simples López Castillo, Pedro José').fill('2');
  await page.waitForTimeout(500);
  await screenshot(page, '08-review-list.png');
});

// ── 9. Review detail view ──────────────────────────────────────────

test('09 - review detail view', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: mock.ALL_FLAGGED_SESSIONS.map(s => ({ ...s, needsResolution: false })),
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  // Click on first employee to open detail
  await page.locator('text=García López, María Elena').first().click();
  await page.waitForSelector('text=Volver a lista', { timeout: 5_000 });
  await page.waitForSelector('text=Ajustes manuales', { timeout: 5_000 });
  await page.waitForTimeout(500);
  await screenshot(page, '09-review-detail.png');
});

// ── 10. Review list: duplicate row ─────────────────────────────────

test('10 - review list: duplicate row', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page, ['E003']);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: mock.ALL_FLAGGED_SESSIONS.map(s => ({ ...s, needsResolution: false })),
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  // Duplicates are not sent, so they are not under "Por revisar".
  await page.getByRole('button', { name: /^Todos/ }).click();
  await page.waitForSelector('text=Duplicado', { timeout: 5_000 });
  await screenshot(page, '10-review-duplicate.png');
});

// ── 11. Result: success ────────────────────────────────────────────

test('11 - result: success', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  await mockSubmitTas(page);
  await mockJobStatus(page, mock.JOB_STATUS_SUCCESS);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [],
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
    absentActiveEmployees: [],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await approveAllAndSend(page);
  await page.waitForSelector('text=Carga completada', { timeout: 15_000 });
  await screenshot(page, '11-result-success.png');
});

// ── 12. Result: partial with retry ─────────────────────────────────

test('12 - result: partial with retry', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  await mockSubmitTas(page);
  await mockJobStatus(page, mock.JOB_STATUS_PARTIAL);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [],
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await approveAllAndSend(page);
  await page.waitForSelector('text=Carga completada', { timeout: 15_000 });
  await page.waitForSelector('text=con error');
  await screenshot(page, '12-result-partial.png');
});

// ── 13. Result: retries exhausted ──────────────────────────────────

test('13 - result: retries exhausted', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  await mockSubmitTas(page);
  await mockJobStatus(page, mock.JOB_STATUS_RETRIES_EXHAUSTED);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [],
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await approveAllAndSend(page);
  await page.waitForSelector('text=Se agotaron los reintentos', { timeout: 15_000 });
  await screenshot(page, '13-result-retries-exhausted.png');
});

// ── 14. Absent review overlay ──────────────────────────────────────

test('14 - absent review overlay', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  await mockSubmitTas(page);
  await mockJobStatus(page, mock.JOB_STATUS_SUCCESS);
  await mockRecomputeTas(page);
  const uploadResult: typeof mock.UPLOAD_RESULT_WITH_FLAGS = {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [],
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  };
  await mockTasUpload(page, uploadResult);
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await approveAllAndSend(page);
  await page.waitForSelector('text=Carga completada', { timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.locator('button:has-text("Revisar empleados sin marcaciones")').click();
  await page.waitForSelector('text=Empleados sin marcaciones', { timeout: 5_000 });
  await screenshot(page, '14-absent-review.png');
});

// ── 15. Config: shifts tab ─────────────────────────────────────────

test('15 - config: shifts tab', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockConfigEndpoints(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await waitForApp(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await screenshot(page, '15-config-shifts.png');
});

// ── 16. Config: employees tab ──────────────────────────────────────

test('16 - config: employees tab', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockConfigEndpoints(page);
  await waitForApp(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.locator('button[role="tab"]:has-text("Empleados")').click();
  await page.waitForSelector('[aria-label="Buscar empleado"]', { timeout: 5_000 });
  await page.waitForSelector('button[role="tab"][aria-selected="true"]:has-text("Empleados")');
  await page.waitForSelector('button[role="tab"][aria-selected="false"]:has-text("Turnos")');
  await page.waitForTimeout(200);
  await screenshot(page, '16-config-employees.png');
});

// ── 17. Config: holidays tab ───────────────────────────────────────

test('17 - config: holidays tab', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockConfigEndpoints(page);
  await waitForApp(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.locator('button[role="tab"]:has-text("Feriados")').click();
  await page.waitForSelector('text=Agregar feriado', { timeout: 5_000 });
  await page.waitForSelector('button[role="tab"][aria-selected="true"]:has-text("Feriados")');
  await page.waitForSelector('button[role="tab"][aria-selected="false"]:has-text("Turnos")');
  await page.waitForTimeout(200);
  await screenshot(page, '17-config-holidays.png');
});

// ── 18. Config: general tab ────────────────────────────────────────

test('18 - config: general tab', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockConfigEndpoints(page);
  await waitForApp(page);
  await page.locator('button:has-text("Configuración")').click();
  await page.waitForSelector('[aria-label="Nombre del turno"]', { timeout: 10_000 });
  await page.locator('button[role="tab"]:has-text("General")').click();
  await page.waitForSelector('text=Tiempo de descanso no deducible', { timeout: 5_000 });
  await page.waitForSelector('button[role="tab"][aria-selected="true"]:has-text("General")');
  await page.waitForSelector('button[role="tab"][aria-selected="false"]:has-text("Turnos")');
  await page.waitForTimeout(200);
  await screenshot(page, '18-config-general.png');
});

// ── 19. Backend error ──────────────────────────────────────────────

test('19 - backend error', async ({ page }) => {
  await page.route('**/api/health', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/db-health', route =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');
  await page.waitForSelector('text=No se pudo conectar con el servicio', { timeout: 30_000 });
  await screenshot(page, '19-backend-error.png');
});

// ── 20-21. Resume an unfinished session ────────────────────────────

const DRAFT_SUMMARY: DraftSummary = {
  fileName: 'Reporte TAS Junio 2026.csv', view: 'verification', periodLabel: 'Junio 2026 - Quincena 1',
  savedAt: new Date().toISOString(), partialSubmit: false, resumable: true, uiVersion: DRAFT_UI_VERSION, jobActive: false,
};

test('20 - resume an unfinished session', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockDraftSummary(page, DRAFT_SUMMARY);
  await waitForApp(page);
  await page.getByRole('button', { name: 'Continuar' }).waitFor();
  await screenshot(page, '20-resume-draft.png');
});

test('21 - resume: session from another version', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockDraftSummary(page, { ...DRAFT_SUMMARY, resumable: false, uiVersion: null });
  await waitForApp(page);
  await page.waitForSelector('text=no se puede continuar');
  await screenshot(page, '21-resume-draft-outdated.png');
});

// ── 22-23. Doble marcación ─────────────────────────────────────────

test('22 - verification: doble marcación', async ({ page }) => {
  await mockHealthEndpoints(page);
  await verificationWith(page, [mock.FLAGGED_SAME_DAY_DOUBLE_A, mock.FLAGGED_SAME_DAY_DOUBLE_B]);
  await screenshot(page, '22-verification-double.png');
});

test('23 - verification: doble marcación of lone scans', async ({ page }) => {
  await mockHealthEndpoints(page);
  const base = { employeeId: 'E004', employeeName: 'López Castillo, Pedro José', date: '2026-06-09', workedMinutes: 0, workedHours: 0, needsResolution: true };
  await verificationWith(page, [
    { ...base, sessionId: 41, scans: ['2026-06-09T07:08:00'], effectiveStart: '2026-06-09T07:08:00', lastScan: '2026-06-09T07:08:00',
      matchedShiftId: 'shift-1', matchedShiftName: 'Mañana', assignedShiftId: 'shift-1', assignedShiftName: 'Mañana',
      flags: ['SAME_DAY_DOUBLE', 'MISSING_EXIT'] },
    { ...base, sessionId: 42, scans: ['2026-06-09T22:03:00'], effectiveStart: '2026-06-09T22:03:00', lastScan: '2026-06-09T22:03:00',
      matchedShiftId: 'shift-3', matchedShiftName: 'Noche', assignedShiftId: 'shift-1', assignedShiftName: 'Mañana', crossMidnight: true,
      flags: ['BEST_FIT_SHIFT', 'SAME_DAY_DOUBLE', 'MISSING_EXIT'] },
  ]);
  await page.waitForSelector('text=Una sola jornada');
  await screenshot(page, '23-verification-double-single-scans.png');
});

// ── 24. Jornada corta ──────────────────────────────────────────────

test('24 - verification: jornada corta', async ({ page }) => {
  await mockHealthEndpoints(page);
  await verificationWith(page, [mock.FLAGGED_MISSING_EXIT, mock.FLAGGED_SHORT_DAY]);
  await page.locator('text=Jornadas cortas').scrollIntoViewIfNeeded();
  await screenshot(page, '24-verification-short-day.png');
});

// ── 25. Intercambiar entrada/salida ────────────────────────────────

test('25 - verification: swap entry and exit', async ({ page }) => {
  await mockHealthEndpoints(page);
  await verificationWith(page, [{ ...mock.FLAGGED_MISSING_EXIT, scans: ['2026-06-04T16:58:00'], effectiveStart: '2026-06-04T16:58:00' }]);
  await page.getByRole('button', { name: 'Intercambiar entrada/salida' }).click();
  await page.getByLabel('Entrada').fill('07:00');
  await screenshot(page, '25-verification-swap.png');
});

// ── 26. Night across the 15th/16th ─────────────────────────────────

test('26 - verification: night that started in the previous quincena', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockTasUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [{
      sessionId: 61, employeeId: 'E006', employeeName: 'Castañeda Vega, Roberto', date: '2026-06-16',
      scans: ['2026-06-16T06:00:00'], effectiveStart: null, lastScan: '2026-06-16T06:00:00',
      matchedShiftId: 'shift-3', matchedShiftName: 'Noche', assignedShiftId: 'shift-3', assignedShiftName: 'Noche',
      crossMidnight: true, workedMinutes: 0, workedHours: 0, needsResolution: true, flags: ['MISSING_ENTRY', 'START_CUTOFF'],
    }] as typeof mock.ALL_FLAGGED_SESSIONS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 2 }],
  });
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Verificación de marcaciones', { timeout: 10_000 });
  await page.getByLabel('Entrada').fill('22:00');
  await page.waitForSelector('text=Esta jornada empezó');
  await screenshot(page, '26-verification-previous-quincena.png');
});

// ── 27-28. Quincena incompleta ─────────────────────────────────────

const INCOMPLETE = [{
  anio: 2026, mes: 6, numeroDequincena: 1, periodStart: '2026-06-01', periodEnd: '2026-06-15',
  dataStart: '2026-06-01', dataEnd: '2026-06-11', missingWorkingDays: ['2026-06-12', '2026-06-13', '2026-06-15'],
}];

async function reviewWithIncompleteQuincena(page: Page) {
  await mockHealthEndpoints(page, INCOMPLETE);
  await mockCheckDuplicates(page);
  await mockRecomputeTas(page);
  await mockTasUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: [],
    // The three missing working days count as not worked for everyone, as the banner says.
    resolvedRows: mock.RESOLVED_ROWS.map(r => ({ ...r, diasNoLaborados: r.diasNoLaborados + 3 })),
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
    absentActiveEmployees: [],
  });
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Quincena incompleta', { timeout: 10_000 });
}

test('27 - review: quincena incompleta banner', async ({ page }) => {
  await reviewWithIncompleteQuincena(page);
  await screenshot(page, '27-review-incomplete-quincena.png');
});

test('28 - review: quincena incompleta confirmation', async ({ page }) => {
  await reviewWithIncompleteQuincena(page);
  await page.locator('button:has-text("Enviar")').last().click();
  await page.waitForSelector('text=Enviar de todas formas');
  await screenshot(page, '28-review-incomplete-confirm.png');
});

test('29 - review: overtime nobody approved, before sending', async ({ page }) => {
  await mockHealthEndpoints(page);
  await mockCheckDuplicates(page);
  await mockRecomputeTas(page);
  await mockTasUpload(page, {
    ...mock.UPLOAD_RESULT_WITH_FLAGS,
    flaggedSessions: mock.ALL_FLAGGED_SESSIONS.map(s => ({ ...s, needsResolution: false })),
    resolvedRows: mock.RESOLVED_ROWS,
    availablePeriods: [{ anio: 2026, mes: 6, numeroDequincena: 1 }],
  });
  await waitForApp(page);
  await uploadFile(page);
  await page.waitForSelector('text=Revisión de registros procesados', { timeout: 10_000 });
  await page.getByRole('button', { name: 'Aprobar horas extra García López, María Elena' }).click();
  await page.getByRole('button', { name: /^Enviar$/ }).click();
  await page.waitForSelector('text=Horas extra sin revisar');
  await screenshot(page, '29-review-pending-overtime.png');
});
