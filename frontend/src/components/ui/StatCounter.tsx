interface Props {
  value: number;
  label: string;
  color?: string;
}

export default function StatCounter({ value, label, color = 'text-primary' }: Props) {
  return (
    <div className="text-center">
      <p className={`text-display-sm font-medium ${color}`}>{value}</p>
      <p className="text-body-sm text-on-surface-variant">{label}</p>
    </div>
  );
}
