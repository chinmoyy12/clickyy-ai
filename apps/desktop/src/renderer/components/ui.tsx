import { useId, type ReactNode } from 'react';

export function Button({ children, onClick, variant = 'default', disabled, title, type = 'button', className = '' }: { children: ReactNode; onClick?: () => void; variant?: 'default' | 'primary' | 'danger' | 'ghost'; disabled?: boolean; title?: string; type?: 'button' | 'submit'; className?: string }) {
  const styles = {
    default: 'border border-line bg-surface2 text-ink hover:border-gold/60',
    primary: 'border border-gold/70 bg-gold/15 text-gold hover:bg-gold/25',
    danger: 'border border-danger/60 bg-danger/10 text-danger hover:bg-danger/20',
    ghost: 'text-muted hover:text-ink hover:bg-surface2',
  }[variant];
  return (
    <button type={type} title={title} disabled={disabled} onClick={onClick} className={`rounded-lg px-3 py-1.5 text-[0.92em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${styles} ${className}`}>
      {children}
    </button>
  );
}

export function Section({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="card mb-4 p-4">
      <h3 className="text-[0.95em] font-semibold">{title}</h3>
      {description && <p className="mt-1 text-[0.85em] leading-relaxed text-muted">{description}</p>}
      <div className="mt-3 flex flex-col gap-3">{children}</div>
    </section>
  );
}

export function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-[0.9em]">{label}</div>
        {hint && <div className="text-[0.8em] text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-5 w-9 rounded-full border transition-colors disabled:opacity-40 ${checked ? 'border-gold/70 bg-gold/40' : 'border-line bg-surface2'}`}
    >
      <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${checked ? 'left-[18px] bg-gold' : 'left-0.5 bg-muted'}`} />
    </button>
  );
}

export function Select<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; label: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)} className="max-w-[220px] rounded-lg border border-line bg-surface2 px-2 py-1.5 text-[0.9em] text-ink">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Slider({ value, onChange, min, max, step, label, format }: { value: number; onChange: (v: number) => void; min: number; max: number; step: number; label: string; format?: (v: number) => string }) {
  const id = useId();
  return (
    <div className="flex items-center gap-2">
      <input id={id} aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-36" />
      <output htmlFor={id} className="w-12 text-right text-[0.85em] tabular-nums text-muted">{format ? format(value) : value}</output>
    </div>
  );
}

export function TextInput({ value, onChange, placeholder, label, type = 'text', className = '' }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; type?: string; className?: string }) {
  return (
    <input aria-label={label} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
      className={`selectable rounded-lg border border-line bg-surface2 px-2.5 py-1.5 text-[0.9em] text-ink placeholder:text-muted/60 ${className}`} />
  );
}

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'muted' | 'gold' | 'cyan'; children: ReactNode }) {
  const t = { ok: 'text-ok border-ok/40', warn: 'text-warn border-warn/40', danger: 'text-danger border-danger/40', muted: 'text-muted border-line', gold: 'text-gold border-gold/40', cyan: 'text-cyan border-cyan/40' }[tone];
  return <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.75em] ${t}`}>{children}</span>;
}

export const riskLabel = (r: number) => (r === 3 ? 'Destructive' : r === 2 ? 'Sensitive' : 'Low risk');
export const riskTone = (r: number): 'danger' | 'warn' | 'muted' => (r === 3 ? 'danger' : r === 2 ? 'warn' : 'muted');
