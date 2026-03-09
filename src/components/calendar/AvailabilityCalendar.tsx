import { Calendar, dateFnsLocalizer } from 'react-big-calendar'
import type { View } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { format, parse, startOfWeek, getDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { useMemo, useState } from 'react'

const locales = { es }
const localizer = dateFnsLocalizer({ format, parse, startOfWeek: () => startOfWeek(new Date(), { weekStartsOn: 1 }), getDay, locales })

interface CalendarEvent {
  title: string
  start: Date
  end: Date
}

export function AvailabilityCalendar({ events }: { events: CalendarEvent[] }) {
  const [view, setView] = useState<View>('week')
  const messages = useMemo(
    () => ({
      next: 'Siguiente',
      previous: 'Anterior',
      today: 'Hoy',
      month: 'Mes',
      week: 'Semana',
      day: 'Dia',
      agenda: 'Agenda',
    }),
    [],
  )

  return (
    <div className="h-[560px] rounded-xl border border-slate-200 bg-white p-3">
      <Calendar
        localizer={localizer}
        events={events}
        view={view}
        onView={setView}
        defaultView="week"
        step={60}
        timeslots={1}
        messages={messages}
        culture="es"
      />
    </div>
  )
}
