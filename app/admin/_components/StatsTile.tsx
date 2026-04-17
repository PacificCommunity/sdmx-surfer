interface Props {
  label: string;
  value: string;
  hint?: string;
}

export function StatsTile({ label, value, hint }: Props) {
  return (
    <div className="rounded-[var(--radius-lg)] bg-surface-card px-4 py-3 shadow-ambient">
      <div className="type-label-md text-on-surface-variant">{label}</div>
      <div className="font-[family-name:var(--font-display)] text-lg font-bold text-on-surface tabular-nums">
        {value}
      </div>
      {hint && (
        <div className="mt-0.5 text-[10px] text-on-surface-variant">{hint}</div>
      )}
    </div>
  );
}
