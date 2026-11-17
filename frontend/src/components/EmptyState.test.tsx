import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmptyState from './EmptyState';
import * as isTasFileModule from '../isTasFile';

vi.mock('../isTasFile');

const mockIsTasFile = vi.mocked(isTasFileModule.isTasFile);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeFile(name = 'marcaciones.csv') {
  return new File(['content'], name, { type: 'text/csv' });
}

describe('EmptyState rendering', () => {
  it('renders the heading', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('renders the select file button', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: /seleccionar archivo/i })).toBeInTheDocument();
  });

  it('renders the drop zone', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    expect(screen.getByText(/arrastra tu archivo aquí/i)).toBeInTheDocument();
  });
});

describe('EmptyState file input', () => {
  it('calls onTasFile when the file is a TAS file', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const onTasFile = vi.fn().mockResolvedValue(true);
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={onTasFile} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(onTasFile).toHaveBeenCalledOnce());
  });

  it('shows loading state while processing', async () => {
    let resolve: (v: boolean) => void;
    mockIsTasFile.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn().mockResolvedValue(true)} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(await screen.findByText(/procesando/i)).toBeInTheDocument();
    resolve!(true);
  });

  it('shows an error when the file is not a TAS file', async () => {
    mockIsTasFile.mockResolvedValue(false);
    const onTasFile = vi.fn();
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={onTasFile} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('bad.csv')] } });

    await waitFor(() =>
      expect(screen.getByText(/no tiene el formato esperado/i)).toBeInTheDocument()
    );
    expect(onTasFile).not.toHaveBeenCalled();
  });

  it('shows error message when onTasFile throws', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const onTasFile = vi.fn().mockRejectedValue(new Error('boom'));
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={onTasFile} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() =>
      expect(screen.getByText(/no se pudo procesar el archivo tas/i)).toBeInTheDocument()
    );
  });

  it('does nothing when no file is selected', async () => {
    const onTasFile = vi.fn();
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={onTasFile} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(onTasFile).not.toHaveBeenCalled();
  });

  it('clicking the Seleccionar archivo button triggers the file input', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /seleccionar archivo/i }));
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('clicking the drop zone area also triggers the file input', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.click(dropZone);
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

describe('EmptyState drag and drop', () => {
  it('shows drag active state on dragOver', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    expect(screen.getByText('Suelta aquí')).toBeInTheDocument();
  });

  it('restores normal state on dragLeave', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    fireEvent.dragLeave(dropZone);
    expect(screen.getByText(/arrastra tu archivo aquí/i)).toBeInTheDocument();
  });

  it('uploads dropped file', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const onTasFile = vi.fn().mockResolvedValue(true);
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={onTasFile} />);

    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    fireEvent.drop(dropZone, {
      preventDefault: vi.fn(),
      dataTransfer: { files: [makeFile()] },
    });

    await waitFor(() => expect(onTasFile).toHaveBeenCalledOnce());
  });

  it('does nothing when drop has no files', async () => {
    const onTasFile = vi.fn();
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={onTasFile} />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.drop(dropZone, {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] },
    });
    expect(onTasFile).not.toHaveBeenCalled();
  });
});

describe('EmptyState with a saved session', () => {
  const draft = {
    fileName: '1era quincena octubre 2026.csv',
    view: 'verification' as const,
    periodLabel: 'Octubre 2026 - Quincena 1',
    savedAt: new Date().toISOString(),
    partialSubmit: false,
    jobActive: false,
  };

  function renderWithDraft(overrides: Partial<typeof draft> = {}, onTasFile = vi.fn().mockResolvedValue(true)) {
    const onContinueDraft = vi.fn();
    const onDiscardDraft = vi.fn();
    render(
      <EmptyState
        draft={{ ...draft, ...overrides }}
        onContinueDraft={onContinueDraft}
        onDiscardDraft={onDiscardDraft}
        onTasFile={onTasFile}
      />,
    );
    return { onContinueDraft, onDiscardDraft, onTasFile };
  }

  it('shows the resume card above the drop zone', () => {
    renderWithDraft();
    const card = screen.getByRole('region', { name: 'Sesión sin terminar' });
    expect(card).toHaveTextContent('1era quincena octubre 2026.csv');
    expect(card).toHaveTextContent(/Paso: Verificación · Guardada hoy a las \d\d:\d\d/);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i);
    expect(card.compareDocumentPosition(dropZone) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('does not show the card without a draft', () => {
    render(<EmptyState draft={null} onContinueDraft={vi.fn()} onDiscardDraft={vi.fn()} onTasFile={vi.fn()} />);
    expect(screen.queryByRole('region', { name: 'Sesión sin terminar' })).not.toBeInTheDocument();
  });

  it('continues the session', () => {
    const { onContinueDraft } = renderWithDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Continuar' }));
    expect(onContinueDraft).toHaveBeenCalledOnce();
  });

  it('asks before discarding and discards on confirm', () => {
    const { onDiscardDraft } = renderWithDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    expect(screen.getByText('¿Descartar la sesión guardada? Se perderán las decisiones tomadas.')).toBeInTheDocument();
    expect(onDiscardDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Sí, descartar' }));
    expect(onDiscardDraft).toHaveBeenCalledOnce();
    expect(screen.queryByText(/Se perderán las decisiones tomadas/)).not.toBeInTheDocument();
  });

  it('keeps the draft when the discard is cancelled', () => {
    const { onDiscardDraft } = renderWithDraft();
    fireEvent.click(screen.getByRole('button', { name: 'Descartar' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onDiscardDraft).not.toHaveBeenCalled();
  });

  it('shows the partial-submit line', () => {
    renderWithDraft({ partialSubmit: true });
    expect(screen.getByText('Envío parcial: algunos registros ya se enviaron y aparecerán como duplicados.')).toBeInTheDocument();
  });

  it('shows "Envío en curso" and no Continuar while a job is active', () => {
    renderWithDraft({ jobActive: true });
    expect(screen.getByText('Envío en curso, espere a que termine.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continuar' })).not.toBeInTheDocument();
  });

  it('asks before uploading a new file over the saved session, then uploads on confirm', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const { onTasFile } = renderWithDraft();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(await screen.findByText('Ya hay una sesión sin terminar. Si carga un archivo nuevo, se descartará.')).toBeInTheDocument();
    expect(onTasFile).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Cargar archivo' }));
    await waitFor(() => expect(onTasFile).toHaveBeenCalledOnce());
  });

  it('does not upload when the new-file confirm is cancelled', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const { onTasFile } = renderWithDraft();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    await screen.findByText(/Si carga un archivo nuevo, se descartará/);

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onTasFile).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Sesión sin terminar' })).toBeInTheDocument();
  });

  it('shows an error when the confirmed upload throws', async () => {
    mockIsTasFile.mockResolvedValue(true);
    renderWithDraft({}, vi.fn().mockRejectedValue(new Error('boom')));
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Cargar archivo' }));

    expect(await screen.findByText('No se pudo procesar el archivo TAS. Intente nuevamente.')).toBeInTheDocument();
  });
});
