import { Card } from '../../components/ui/card'

export function ClinicPatientsPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Pacientes encriptados</h1>
      <Card>La lectura/desencriptado sucede solo por endpoint autorizado en Cloud Functions.</Card>
    </div>
  )
}
