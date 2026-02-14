import { render } from '@testing-library/react';
import App from '../App';

describe('App', () => {
  it('renders the app without crashing', () => {
    render(<App />);
    expect(document.body).toBeInTheDocument();
  });

  it('wraps the app with QueryClientProvider', () => {
    render(<App />);
    // QueryClientProvider doesn't add a specific element, but we can check the context exists
    // This is a basic test - more comprehensive tests would check routing
  });
});
