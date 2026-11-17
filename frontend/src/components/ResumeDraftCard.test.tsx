import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import ResumeDraftCard from './ResumeDraftCard';
import { formatSavedAt } from '../formatSavedAt';

describe('formatSavedAt', () => {
  const now = new Date(2026, 10, 16, 18, 0);

  it('uses "hoy" for today', () => {
    expect(formatSavedAt(new Date(2026, 10, 16, 14, 20).toISOString(), now)).toBe('hoy a las 14:20');
  });

  it('uses "ayer" for yesterday, across a month boundary too', () => {
    expect(formatSavedAt(new Date(2026, 10, 15, 9, 5).toISOString(), now)).toBe('ayer a las 09:05');
    expect(formatSavedAt(new Date(2026, 9, 31, 23, 59).toISOString(), new Date(2026, 10, 1, 8, 0))).toBe('ayer a las 23:59');
  });

  it('uses the date otherwise', () => {
    expect(formatSavedAt(new Date(2026, 10, 2, 7, 0).toISOString(), now)).toBe('el 02/11/2026 a las 07:00');
  });

  it('defaults to the current time', () => {
    expect(formatSavedAt(new Date().toISOString())).toMatch(/^hoy a las \d\d:\d\d$/);
  });
});

describe('ResumeDraftCard', () => {
  const base = { fileName: null, periodLabel: null, savedAt: new Date().toISOString(), partialSubmit: false, jobActive: false };

  it.each([
    ['inactiveReview', 'Empleados inactivos'],
    ['verification', 'Verificación'],
    ['review', 'Revisión'],
  ] as const)('labels the %s step', (view, label) => {
    render(<ResumeDraftCard draft={{ ...base, view }} onContinue={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByText(new RegExp(`Paso: ${label} ·`))).toBeInTheDocument();
  });

  it('omits the file line when the name is unknown', () => {
    render(<ResumeDraftCard draft={{ ...base, view: 'review' }} onContinue={vi.fn()} onDiscard={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Sesión sin terminar' }).querySelectorAll('p')).toHaveLength(1);
  });
});
