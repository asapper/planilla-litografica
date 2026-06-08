import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import TasUploadFlow from './TasUploadFlow';
import { useTasStore } from '../../tasStore';

vi.mock('./ProcessingScreen', () => ({
  default: ({ fileName }: { fileName: string }) => <div data-testid="processing-screen">{fileName}</div>,
}));
vi.mock('./ReactivationReviewScreen', () => ({
  default: () => <div data-testid="reactivation-review-screen" />,
}));
vi.mock('./VerificationScreen', () => ({
  default: () => <div data-testid="verification-screen" />,
}));
vi.mock('./TasResultScreen', () => ({
  default: () => <div data-testid="tas-result-screen" />,
}));
vi.mock('./AbsentReviewOverlay', () => ({
  default: () => <div data-testid="absent-review-overlay" />,
}));

beforeEach(() => {
  useTasStore.getState().resetTas();
});

describe('TasUploadFlow routing', () => {
  it('renders nothing when tasView is idle', () => {
    const { container } = render(<TasUploadFlow fileName="test.csv" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders ProcessingScreen when tasView is processing', () => {
    useTasStore.getState().setTasView('processing');
    render(<TasUploadFlow fileName="report.csv" />);
    expect(screen.getByTestId('processing-screen')).toBeInTheDocument();
    expect(screen.getByText('report.csv')).toBeInTheDocument();
  });

  it('renders ReactivationReviewScreen when tasView is inactiveReview', () => {
    useTasStore.getState().setTasView('inactiveReview');
    render(<TasUploadFlow fileName="test.csv" />);
    expect(screen.getByTestId('reactivation-review-screen')).toBeInTheDocument();
  });

  it('renders VerificationScreen when tasView is verification', () => {
    useTasStore.getState().setTasView('verification');
    render(<TasUploadFlow fileName="test.csv" />);
    expect(screen.getByTestId('verification-screen')).toBeInTheDocument();
  });

  it('renders spinner overlay when tasView is submitting', () => {
    useTasStore.getState().setTasView('submitting');
    render(<TasUploadFlow fileName="test.csv" />);
    expect(screen.getByText('Enviando...')).toBeInTheDocument();
  });

  it('renders TasResultScreen when tasView is result', () => {
    useTasStore.getState().setTasView('result');
    render(<TasUploadFlow fileName="test.csv" />);
    expect(screen.getByTestId('tas-result-screen')).toBeInTheDocument();
  });

  it('renders TasResultScreen and AbsentReviewOverlay when tasView is absentReview', () => {
    useTasStore.getState().setTasView('absentReview');
    render(<TasUploadFlow fileName="test.csv" />);
    expect(screen.getByTestId('tas-result-screen')).toBeInTheDocument();
    expect(screen.getByTestId('absent-review-overlay')).toBeInTheDocument();
  });
});
