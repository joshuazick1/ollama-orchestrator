import { z } from 'zod';

interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  suffix?: string;
  error?: string;
  validationSchema?: z.ZodSchema<number>;
}

export const NumberInput = ({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  description,
  suffix,
  error,
  validationSchema,
}: NumberInputProps) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawValue = Number(e.target.value);
    if (validationSchema) {
      const result = validationSchema.safeParse(rawValue);
      if (!result.success) {
        return;
      }
    }
    onChange(rawValue);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
      <div className="flex items-center space-x-2">
        <input
          type="number"
          value={value}
          onChange={handleChange}
          min={min}
          max={max}
          step={step}
          className={`flex-1 bg-surface-raised border rounded-lg px-3 py-2 text-text-base focus:outline-none focus:ring-2 transition-all ${
            error
              ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
              : 'border-surface-border focus:ring-blue-500/50 focus:border-blue-500'
          }`}
          aria-invalid={!!error}
        />
        {suffix && <span className="text-gray-400 text-sm">{suffix}</span>}
      </div>
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
};
