import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GeneratePanel } from '../GeneratePanel';
import * as useGenerateStreamModule from '../useGenerateStream';

vi.mock('../useGenerateStream');

describe('GeneratePanel', () => {
  const mockGenerate = vi.fn();
  const mockStop = vi.fn();

  const defaultMockHook = {
    response: '',
    isStreaming: false,
    error: null,
    generate: mockGenerate,
    stop: mockStop,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useGenerateStreamModule, 'useGenerateStream').mockReturnValue(
      defaultMockHook as ReturnType<typeof useGenerateStreamModule.useGenerateStream>
    );
  });

  it('should render prompt input', () => {
    render(<GeneratePanel provider="ollama" model="llama2" />);

    expect(screen.getByPlaceholderText(/Enter your prompt for ollama/)).toBeInTheDocument();
  });

  it('should update prompt value on change', () => {
    render(<GeneratePanel provider="ollama" model="llama2" />);

    const textarea = screen.getByPlaceholderText(/Enter your prompt for ollama/);
    fireEvent.change(textarea, { target: { value: 'Write a story' } });

    expect((textarea as HTMLTextAreaElement).value).toBe('Write a story');
  });

  it('should call generate when generate button is clicked', async () => {
    render(<GeneratePanel provider="ollama" model="llama2" />);

    const textarea = screen.getByPlaceholderText(/Enter your prompt for ollama/);
    fireEvent.change(textarea, { target: { value: 'Write a story' } });

    const generateButton = screen.getByRole('button', { name: /generate/i });
    fireEvent.click(generateButton);

    await waitFor(() => {
      expect(mockGenerate).toHaveBeenCalledWith('Write a story');
    });
  });

  it('should render output when response is available', () => {
    vi.spyOn(useGenerateStreamModule, 'useGenerateStream').mockReturnValue({
      ...defaultMockHook,
      response: 'Generated text output',
    } as ReturnType<typeof useGenerateStreamModule.useGenerateStream>);

    render(<GeneratePanel provider="ollama" model="llama2" />);

    expect(screen.getByText(/Generated text output/)).toBeInTheDocument();
  });

  it('should render error message when error occurs', () => {
    vi.spyOn(useGenerateStreamModule, 'useGenerateStream').mockReturnValue({
      ...defaultMockHook,
      error: new Error('Generation failed'),
    } as ReturnType<typeof useGenerateStreamModule.useGenerateStream>);

    render(<GeneratePanel provider="ollama" model="llama2" />);

    expect(screen.getByText(/Generation failed/)).toBeInTheDocument();
  });

  it('should show stop button when streaming', () => {
    vi.spyOn(useGenerateStreamModule, 'useGenerateStream').mockReturnValue({
      ...defaultMockHook,
      isStreaming: true,
    } as ReturnType<typeof useGenerateStreamModule.useGenerateStream>);

    render(<GeneratePanel provider="ollama" model="llama2" />);

    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('should toggle options section', () => {
    render(<GeneratePanel provider="ollama" model="llama2" />);

    const toggleButton = screen.getByText(/show options/i);
    fireEvent.click(toggleButton);

    expect(screen.getByText(/hide options/i)).toBeInTheDocument();
    expect(screen.getByText(/Temperature/i)).toBeInTheDocument();
  });
});
