interface TextInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  description?: string;
  placeholder?: string;
  error?: string;
}

export const TextInput = ({
  label,
  value,
  onChange,
  description,
  placeholder,
  error,
}: TextInputProps) => (
  <div>
    <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
    {description && <p className="text-xs text-gray-500 mb-2">{description}</p>}
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={`w-full bg-gray-900 border rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 transition-all ${
        error
          ? 'border-red-500 focus:ring-red-500/50 focus:border-red-500'
          : 'border-gray-600 focus:ring-blue-500/50 focus:border-blue-500'
      }`}
      aria-invalid={!!error}
    />
    {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
  </div>
);
