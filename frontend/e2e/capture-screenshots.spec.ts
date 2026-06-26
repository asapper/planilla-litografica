import { test, type Page } from '@playwright/test';
import * as mock from './mock-data';

const SCREENSHOT_DIR = '../docs/screenshots';

const MOCK_CSV = [
  'Autenticación de marcaciones TAS',
  'Código,Nombre,Fecha,Hora',
  'E001,García López María Elena,2026-06-03,06:02',
].join('\n');

async function mockHealthEndpoints(page: Page) {
  await page.route('**/api/health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
  await page.route('**/api/db-health', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }),
  );
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
    const store = (window as any).__ZUSTAND_TAS_STORE__;
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
  await mockTasUpload(page, mock.UPLOAD_RESULT_WITH_FLAGS);
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
  await page.locator('button:has-text("Enviar")').click();
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
  await page.locator('button:has-text("Enviar")').click();
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
  await page.locator('button:has-text("Enviar")').click();
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
  await page.locator('button:has-text("Enviar")').click();
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
