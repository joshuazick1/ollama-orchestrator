import { useState, useCallback } from 'react';
import { z } from 'zod';
import { toastError } from '../../../utils/toast';

type FieldErrors = Record<string, string>;

export function useFieldValidation() {
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const validateAndUpdate = useCallback(
    <T>(schema: z.ZodSchema<T>, value: unknown, fieldPath: string, onUpdate: () => void) => {
      const result = schema.safeParse(value);
      if (!result.success) {
        const message = result.error.issues.map(i => i.message).join(', ');
        setFieldErrors(prev => ({ ...prev, [fieldPath]: message }));
        toastError(`Invalid value for ${fieldPath}: ${message}`);
        return false;
      }
      setFieldErrors(prev => {
        const next = { ...prev };
        delete next[fieldPath];
        return next;
      });
      onUpdate();
      return true;
    },
    []
  );

  const setError = useCallback((fieldPath: string, message: string) => {
    setFieldErrors(prev => ({ ...prev, [fieldPath]: message }));
  }, []);

  const clearError = useCallback((fieldPath: string) => {
    setFieldErrors(prev => {
      const next = { ...prev };
      delete next[fieldPath];
      return next;
    });
  }, []);

  const clearAllErrors = useCallback(() => {
    setFieldErrors({});
  }, []);

  const getError = useCallback((fieldPath: string) => fieldErrors[fieldPath], [fieldErrors]);

  return {
    fieldErrors,
    validateAndUpdate,
    setError,
    clearError,
    clearAllErrors,
    getError,
  };
}
