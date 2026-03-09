import type { ReactNode } from 'react'

export function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">{children}</div>
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <h3 className="text-lg font-semibold text-slate-900">{children}</h3>
}

export function CardDescription({ children }: { children: ReactNode }) {
  return <p className="text-sm text-slate-500">{children}</p>
}

