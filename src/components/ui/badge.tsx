import type { ReactNode } from 'react'

export function Badge({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">{children}</span>
}

