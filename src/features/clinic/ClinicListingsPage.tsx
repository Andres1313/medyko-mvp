import { Link } from 'react-router-dom'
import { Card } from '../../components/ui/card'

export function ClinicListingsPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Listados de clínica y quirófanos</h1>
      <Card>
        <p className="font-semibold">Quirófano mayor zona 14</p>
        <Link to="/clinic/listings/OR/listing-2/edit" className="text-sm text-sky-700">
          Editar
        </Link>
      </Card>
    </div>
  )
}
