import { useState } from 'react'
import { Card, CardDescription, CardTitle } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'

const mockListings = [
  { id: '1', type: 'CLINIC', title: 'Clínica zona 10', zone: 10, hourly: 350, daily: 2200, nursingAvailable: false },
  { id: '2', type: 'OR', title: 'Quirófano mayor zona 14', zone: 14, hourly: 900, daily: 5500, nursingAvailable: true },
]

export function SpacesPage() {
  const [zoneFilter, setZoneFilter] = useState('')

  const filtered = mockListings.filter((item) => (zoneFilter ? item.zone.toString() === zoneFilter : true))

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-slate-900">Clínicas y quirófanos</h1>
      <div className="grid gap-3 md:grid-cols-4">
        <Input placeholder="Zona (1-25)" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)} />
        <Input placeholder="Precio por hora mínimo" />
        <Input placeholder="Precio por hora máximo" />
        <Input placeholder="Tags de equipo" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {filtered.map((listing) => (
          <Card key={listing.id}>
            <div className="flex items-center justify-between">
              <CardTitle>{listing.title}</CardTitle>
              <Badge>{listing.type === 'OR' ? 'Quirófano' : 'Clínica'}</Badge>
            </div>
            <CardDescription>
              Zona {listing.zone} · Q{listing.hourly}/hora · Q{listing.daily}/día
            </CardDescription>
            <p className="mt-2 text-xs text-slate-500">Enfermería: {listing.nursingAvailable ? 'Disponible' : 'No incluida'}</p>
          </Card>
        ))}
      </div>
    </div>
  )
}
