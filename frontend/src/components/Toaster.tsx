import { Toaster as HotToaster } from 'react-hot-toast';
import { uiColors } from '../constants/colors';

export const Toaster = () => {
  return (
    <HotToaster
      position="top-right"
      toastOptions={{
        duration: 4000,
        style: {
          background: uiColors.surfaceDark,
          color: uiColors.textLight,
          border: `1px solid ${uiColors.surfaceBorder}`,
          borderRadius: '0.75rem',
          padding: '1rem',
        },
        success: {
          iconTheme: {
            primary: uiColors.success,
            secondary: uiColors.surfaceDark,
          },
          style: {
            borderColor: uiColors.success,
          },
        },
        error: {
          iconTheme: {
            primary: uiColors.error,
            secondary: uiColors.surfaceDark,
          },
          style: {
            borderColor: uiColors.error,
          },
        },
        loading: {
          iconTheme: {
            primary: uiColors.info,
            secondary: uiColors.surfaceDark,
          },
        },
      }}
    />
  );
};

export default Toaster;
