import { Loader2 } from 'lucide-react';

export default function Spinner({ className = 'h-5 w-5', label }) {
  return (
    <span className="text-muted inline-flex items-center gap-2" role="status" aria-label={label ?? 'Loading'}>
      <Loader2 className={`animate-spin ${className}`} aria-hidden />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}
