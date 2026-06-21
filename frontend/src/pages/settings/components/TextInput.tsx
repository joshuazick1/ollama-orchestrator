import { z } from 'zod';

interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  placeholder?: string;
  error?: string;
  validationSchema?: z.ZodSchema<string>;
}

export const TextInput = ({
  label,
  value,
  onChange,
  description,
  placeholder,
  error,
  validationSchema,
}: TextInputProps) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    if (validationSchema) {
      const result = validationSchema.safeParse(newValue);
      if (!result.success) {
        return;
      }
    }
    onChange(newValue);
  };

  return (
    <div>
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
      <input
        type="text"
        value={value}
        onChange={handleChange}
        placeholder={placeholder}
        className={`w-full bg-surface-raised border rounded-lg px-3 py-2 text-text-base focus:outline-none focus:ring-2 transition-all ${
          error
            ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
            : 'border-surface-border focus:ring-blue-500/50 focus:border-blue-500'
        }`}
        aria-invalid={!!error}
      />
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
    </div>
  );
};
