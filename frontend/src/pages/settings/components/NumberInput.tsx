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
}: NumberInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <div className="flex items-center space-x-2">
      <input
        type="number"
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        className={`flex-1 bg-gray-900 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 transition-all ${
          error
            ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
            : 'border-gray-600 focus:ring-blue-500/50 focus:border-blue-500'
        }`}
        aria-invalid={!!error}
      />
      {suffix && <span className="text-gray-400 text-sm">{suffix}</span>}
    </div>
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);
