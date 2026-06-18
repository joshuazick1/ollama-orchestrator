import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ChatPanel } from '../ChatPanel';
import * as useChatStreamModule from '../useChatStream';

vi.mock('../useChatStream');
vi.mock('../components/ui/button', () => ({
  Button: ({ children, onClick, disabled, className, ...props }: Record<string, unknown>) => (
    <button
      onClick={onClick as () => void}
      disabled={disabled as boolean}
      className={className as string}
      {...props}
    >
      {children}
    </button>
  ),
}));
vi.mock('../components/ui/textarea', () => ({
  Textarea: ({
    value,
    onChange,
    placeholder,
    disabled,
    className,
    ...props
  }: Record<string, unknown>) => (
    <textarea
      value={value as string}
      onChange={onChange as (e: { target: { value: string } }) => void}
      placeholder={placeholder as string}
      disabled={disabled as boolean}
      className={className as string}
      {...props}
    />
  ),
}));
vi.mock('../components/ui/card', () => ({
  Card: ({ children, className, ...props }: Record<string, unknown>) => (
    <div className={className as string} {...props}>
      {children}
    </div>
  ),
}));

describe('ChatPanel', () => {
  const mockSendMessage = vi.fn().mockResolvedValue('Test response');
  const mockStop = vi.fn();

  const defaultMockHook = {
    response: '',
    isStreaming: false,
    error: null,
    sendMessage: mockSendMessage,
    stop: mockStop,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(useChatStreamModule, 'useChatStream').mockReturnValue(
      defaultMockHook as ReturnType<typeof useChatStreamModule.useChatStream>
    );
  });

  it('should render message list', () => {
    render(<ChatPanel provider="ollama" model="llama2" />);

    expect(screen.getByPlaceholderText(/Message ollama/)).toBeInTheDocument();
  });

  it('should update input value on change', () => {
    render(<ChatPanel provider="ollama" model="llama2" />);

    const textarea = screen.getByPlaceholderText(/Message ollama/);
    fireEvent.change(textarea, { target: { value: 'Hello world' } });

    expect((textarea as HTMLTextAreaElement).value).toBe('Hello world');
  });

  it('should send message when send button is clicked', async () => {
    render(<ChatPanel provider="ollama" model="llama2" />);

    const textarea = screen.getByPlaceholderText(/Message ollama/);
    fireEvent.change(textarea, { target: { value: 'Hello' } });

    const sendButton = screen.getByRole('button');
    fireEvent.click(sendButton);

    await waitFor(() => {
      expect(mockSendMessage).toHaveBeenCalledWith([{ role: 'user', content: 'Hello' }]);
    });
  });

  it('should render streaming indicator when streaming', async () => {
    vi.spyOn(useChatStreamModule, 'useChatStream').mockReturnValue({
      ...defaultMockHook,
      response: 'Partial response',
      isStreaming: true,
    } as ReturnType<typeof useChatStreamModule.useChatStream>);

    render(<ChatPanel provider="ollama" model="llama2" />);

    expect(screen.getByText(/Streaming\.\.\./)).toBeInTheDocument();
  });

  it('should render error message when error occurs', () => {
    vi.spyOn(useChatStreamModule, 'useChatStream').mockReturnValue({
      ...defaultMockHook,
      error: new Error('Test error'),
    } as ReturnType<typeof useChatStreamModule.useChatStream>);

    render(<ChatPanel provider="ollama" model="llama2" />);

    expect(screen.getByText(/Test error/)).toBeInTheDocument();
  });

  it('should disable textarea while streaming', () => {
    vi.spyOn(useChatStreamModule, 'useChatStream').mockReturnValue({
      ...defaultMockHook,
      isStreaming: true,
    } as ReturnType<typeof useChatStreamModule.useChatStream>);

    render(<ChatPanel provider="ollama" model="llama2" />);

    const textarea = screen.getByPlaceholderText(/Message ollama/);
    expect(textarea).toBeDisabled();
  });
});
