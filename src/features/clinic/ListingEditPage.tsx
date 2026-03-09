import { useParams } from 'react-router-dom'

export function ListingEditPage() {
  const { type, id } = useParams()
  return (
    <div>
      <h1 className="text-2xl font-bold">Editar listado</h1>
      <p className="text-sm text-slate-600">Tipo: {type} | ID: {id}</p>
    </div>
  )
}
