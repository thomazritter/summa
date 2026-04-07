interface LikertScaleProps {
  label: string;
  value: number | null;
  onChange: (value: number) => void;
  lowLabel?: string;
  highLabel?: string;
}

export function LikertScale({ label, value, onChange, lowLabel, highLabel }: LikertScaleProps) {
  const points = [1, 2, 3, 4, 5];
  return (
    <div className="mb-4">
      <label className="block mb-2 font-medium text-sm text-gray-700">{label}</label>
      <div
        className="flex items-center gap-2"
        role="radiogroup"
        aria-label={label}
      >
        {lowLabel && (
          <span className="text-xs text-gray-600 min-w-[70px] text-right">{lowLabel}</span>
        )}
        <div className="flex gap-1">
          {points.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={value === n}
              aria-label={`${n} de 5`}
              onClick={() => onChange(n)}
              className={`w-11 h-11 rounded-lg border-2 font-semibold text-sm cursor-pointer transition-all ${
                value === n
                  ? 'border-blue-500 bg-blue-50 text-blue-700'
                  : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
        {highLabel && (
          <span className="text-xs text-gray-600 min-w-[70px]">{highLabel}</span>
        )}
      </div>
    </div>
  );
}
