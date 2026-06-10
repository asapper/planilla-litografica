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
    render(<EmptyState onTasFile={vi.fn()} />);
    expect(screen.getByText('Cargador de Planilla')).toBeInTheDocument();
  });

  it('renders the select file button', () => {
    render(<EmptyState onTasFile={vi.fn()} />);
    expect(screen.getByRole('button', { name: /seleccionar archivo/i })).toBeInTheDocument();
  });

  it('renders the drop zone', () => {
    render(<EmptyState onTasFile={vi.fn()} />);
    expect(screen.getByText(/arrastra tu archivo aquí/i)).toBeInTheDocument();
  });
});

describe('EmptyState file input', () => {
  it('calls onTasFile when the file is a TAS file', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const onTasFile = vi.fn().mockResolvedValue(true);
    render(<EmptyState onTasFile={onTasFile} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() => expect(onTasFile).toHaveBeenCalledOnce());
  });

  it('shows loading state while processing', async () => {
    let resolve: (v: boolean) => void;
    mockIsTasFile.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<EmptyState onTasFile={vi.fn().mockResolvedValue(true)} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    expect(await screen.findByText(/procesando/i)).toBeInTheDocument();
    resolve!(true);
  });

  it('shows an error when the file is not a TAS file', async () => {
    mockIsTasFile.mockResolvedValue(false);
    const onTasFile = vi.fn();
    render(<EmptyState onTasFile={onTasFile} />);

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
    render(<EmptyState onTasFile={onTasFile} />);

    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [makeFile()] } });

    await waitFor(() =>
      expect(screen.getByText(/no se pudo procesar el archivo tas/i)).toBeInTheDocument()
    );
  });

  it('does nothing when no file is selected', async () => {
    const onTasFile = vi.fn();
    render(<EmptyState onTasFile={onTasFile} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [] } });
    expect(onTasFile).not.toHaveBeenCalled();
  });

  it('clicking the Seleccionar archivo button triggers the file input', () => {
    render(<EmptyState onTasFile={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /seleccionar archivo/i }));
    expect(clickSpy).toHaveBeenCalledOnce();
  });

  it('clicking the drop zone area also triggers the file input', () => {
    render(<EmptyState onTasFile={vi.fn()} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.click(dropZone);
    expect(clickSpy).toHaveBeenCalledOnce();
  });
});

describe('EmptyState drag and drop', () => {
  it('shows drag active state on dragOver', () => {
    render(<EmptyState onTasFile={vi.fn()} />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    expect(screen.getByText('Suelta aquí')).toBeInTheDocument();
  });

  it('restores normal state on dragLeave', () => {
    render(<EmptyState onTasFile={vi.fn()} />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.dragOver(dropZone, { preventDefault: vi.fn() });
    fireEvent.dragLeave(dropZone);
    expect(screen.getByText(/arrastra tu archivo aquí/i)).toBeInTheDocument();
  });

  it('uploads dropped file', async () => {
    mockIsTasFile.mockResolvedValue(true);
    const onTasFile = vi.fn().mockResolvedValue(true);
    render(<EmptyState onTasFile={onTasFile} />);

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
    render(<EmptyState onTasFile={onTasFile} />);
    const dropZone = screen.getByText(/arrastra tu archivo aquí/i).closest('div')!;
    fireEvent.drop(dropZone, {
      preventDefault: vi.fn(),
      dataTransfer: { files: [] },
    });
    expect(onTasFile).not.toHaveBeenCalled();
  });
});
