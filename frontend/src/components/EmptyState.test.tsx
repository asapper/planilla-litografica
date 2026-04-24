import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EmptyState from './EmptyState';
import { useStore } from '../store';
import * as api from '../api';
import type { UploadResponse } from '../types';

vi.mock('../api');

const mockUploadCsv = vi.mocked(api.uploadCsv);

const mockResponse: UploadResponse = {
  rows: [{
    codigoEmpleado: '1', nombreEmpleado: 'Ana',
    diasNoLaborados: 0, horasExtrasSimples: 0, horasExtrasDobles: 0,
    mes: 12, anio: 2024,
  }],
  monthOptions: [{ mes: 12, anio: 2024 }],
  multiMonth: false,
  parseWarnings: [],
};

beforeEach(() => {
  useStore.getState().reset();
  vi.clearAllMocks();
});

function makeFile(name = 'planilla.csv') {
  return new File(['content'], name, { type: 'text/csv' });
}

// -----------------------------------------------------------------
// Initial render
// -----------------------------------------------------------------

describe('EmptyState rendering', () => {
  it('renders the heading', () => {
    render(<EmptyState />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('renders the select file button', () => {
    render(<EmptyState />);
    expect(screen.getByRole('button', { name: /seleccionar archivo/i })).toBeInTheDocument();
  });

  it('renders the drop zone', () => {
    render(<EmptyState />);
    expect(screen.getByText(/arrastra tu archivo aquí/i)).toBeInTheDocument();
  });
});

// -----------------------------------------------------------------
// File selection via input
// -----------------------------------------------------------------

describe('EmptyState file input', () => {
  it('uploads file and transitions to loaded on success', async () => {
    mockUploadCsv.mockResolvedValue(mockResponse);
    render(<EmptyState />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(useStore.getState().appState).toBe('loaded'));
    expect(mockUploadCsv).toHaveBeenCalledOnce();
  });

  it('shows loading state while uploading', async () => {
    let resolve: (v: UploadResponse) => void;
    mockUploadCsv.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<EmptyState />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(await screen.findByText(/procesando/i)).toBeInTheDocument();
    resolve!(mockResponse);
  });

  it('shows error message on upload failure with server message', async () => {
    mockUploadCsv.mockRejectedValue({ response: { data: { message: 'Solo se aceptan archivos CSV.' } } });
    render(<EmptyState />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile('bad.txt')] } });

    await waitFor(() => expect(screen.getByText('Solo se aceptan archivos CSV.')).toBeInTheDocument());
  });

  it('shows generic error message when no server message', async () => {
    mockUploadCsv.mockRejectedValue(new Error('network error'));
    render(<EmptyState />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() =>
      expect(screen.getByText(/no se pudo leer el archivo/i)).toBeInTheDocument()
    );
  });

  it('does nothing when no file is selected', async () => {
    render(<EmptyState />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(mockUploadCsv).not.toHaveBeenCalled();
  });

  it('clicking the Seleccionar archivo button triggers the file input', () => {
    render(<EmptyState />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /seleccionar archivo/i }));
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('clicking the drop zone area also triggers the file input', () => {
    render(<EmptyState />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    // The drop zone div has an onClick handler too
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.click(dropZone);
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

// -----------------------------------------------------------------
// Drag and drop
// -----------------------------------------------------------------

describe('EmptyState drag and drop', () => {
  it('shows drag active state on dragOver', () => {
    render(<EmptyState />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    expect(screen.getByText('Suelta aquí')).toBeInTheDocument();
  });

  it('restores normal state on dragLeave', () => {
    render(<EmptyState />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    fireEvent.dragLeave(dropZone);
    expect(screen.getByText(/arrastra tu archivo aquí/i)).toBeInTheDocument();
  });

  it('uploads dropped file', async () => {
    mockUploadCsv.mockResolvedValue(mockResponse);
    render(<EmptyState />);

    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    fireEvent.drop(dropZone, {
      preventDefault: vi.fn(),
      dataTransfer: { files: [makeFile()] },
    });

    await waitFor(() => expect(useStore.getState().appState).toBe('loaded'));
  });

  it('does nothing when drop has no files', async () => {
    render(<EmptyState />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.drop(dropZone, {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] },
    });
    expect(mockUploadCsv).not.toHaveBeenCalled();
  });
});
