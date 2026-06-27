import toast from 'react-hot-toast';

export type ToastType = 'success' | 'error' | 'loading' | 'warning' | 'custom';

export interface ToastOptions {
  type?: ToastType;
  message: string;
  duration?: number;
}

export const toastSuccess = (message: string, duration?: number) => {
  toast.success(message, { duration: duration ?? 4000 });
};

export const toastError = (message: string, duration?: number) => {
  toast.error(message, { duration: duration ?? 5000 });
};

export const toastLoading = (message: string) => {
  return toast.loading(message);
};

export const toastWarning = (message: string, duration?: number) => {
  toast(message, {
    icon: '⚠️',
    duration: duration ?? 4000,
  });
};

export const toastDismiss = () => {
  toast.dismiss();
};

export const toastPromise = <T>(
  promise: Promise<T>,
  messages: {
    loading?: string;
    success?: string;
    error?: string;
  }
): Promise<T> => {
  return toast.promise(promise, {
    loading: messages.loading ?? 'Loading...',
    success: messages.success ?? 'Success!',
    error: messages.error ?? 'Error occurred',
  });
};

export default toast;
