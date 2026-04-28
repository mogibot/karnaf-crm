import { useEffect } from 'react';

const SUFFIX = 'Karnaf CRM';

export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    const next = title ? `${title} · ${SUFFIX}` : SUFFIX;
    const prev = document.title;
    document.title = next;
    return () => { document.title = prev; };
  }, [title]);
}
