import { Toaster as HotToaster } from 'react-hot-toast';

export const Toaster = () => {
  return (
    <HotToaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: 'var(--color-surface)',
          color: 'var(--color-text-base)',
          border: '1px solid var(--color-border)',
          borderRadius: '0.75rem',
          padding: '1rem',
        },
        success: {
          iconTheme: {
            primary: 'var(--color-success)',
            secondary: 'var(--color-surface)',
          },
          style: {
            borderColor: 'var(--color-success)',
          },
        },
        error: {
          iconTheme: {
            primary: 'var(--color-danger)',
            secondary: 'var(--color-surface)',
          },
          style: {
            borderColor: 'var(--color-danger)',
          },
        },
        loading: {
          iconTheme: {
            primary: 'var(--color-info)',
            secondary: 'var(--color-surface)',
          },
        },
      }}
    />
  );
};

export default Toaster;
