import clsx from 'clsx';

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={clsx('h-4 w-4 animate-spin text-current', className)}
      viewBox="0 0 24 24" fill="none" aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path
        d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3"
        strokeLinecap="round" fill="none"
      />
    </svg>
  );
}
