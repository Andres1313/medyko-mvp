import { AvailabilityCalendar } from '../../components/calendar/AvailabilityCalendar'

export function ClinicCalendarPage() {
  const events = [
    { title: 'Reserva confirmada OR', start: new Date(), end: new Date(Date.now() + 90 * 60 * 1000) },
  ]
  return (
    <div className="space-y-3">
      <h1 className="text-2xl font-bold">Calendario de clínica</h1>
      <AvailabilityCalendar events={events} />
    </div>
  )
}
