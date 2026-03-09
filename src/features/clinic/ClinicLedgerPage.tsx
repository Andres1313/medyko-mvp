import { Card } from '../../components/ui/card'

export function ClinicLedgerPage() {
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Ledger de ingresos</h1>
      <Card>
        Ejemplo: baseRent Q500, platformFee Q50, processingFee Q24.5, clinicReceivable Q450.
      </Card>
    </div>
  )
}
