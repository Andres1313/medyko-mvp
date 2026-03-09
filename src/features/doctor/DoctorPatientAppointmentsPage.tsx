import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { postApi } from '../../lib/api'

interface PatientAppointment {
  id: string
  patientName: string
  patientEmail?: string
  patientPhoneE164?: string
  patientWhatsappOptIn?: boolean
  patientPhoneVerified?: boolean
  notes: string
  status: 'CONFIRMED' | 'CANCELLED'
  startDateTime: string
  endDateTime: string
}

interface AppointmentSaveResponse {
  ok: boolean
  appointmentId?: string
  manageLink?: string
  whatsappSent?: boolean
  warning?: string | null
}

function fromLocalInputValue(value: string) {
  return new Date(value).toISOString()
}

export function DoctorPatientAppointmentsPage() {
  const [appointments, setAppointments] = useState<PatientAppointment[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [form, setForm] = useState({
    id: '',
    patientName: '',
    patientEmail: '',
    patientPhone: '',
    startDateTime: '',
    endDateTime: '',
    notes: '',
  })

  const load = async () => {
    setLoading(true)
    try {
      const data = await postApi<{ appointments: PatientAppointment[] }>('/appointments/mine/list', { limit: 220 })
      setAppointments(data.appointments || [])
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudieron cargar citas')
      setAppointments([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const saveAppointment = async () => {
    if (!form.patientName || !form.startDateTime || !form.endDateTime) {
      setMessage('Completa nombre de paciente, inicio y fin.')
      return
    }
    setMessage('')
    try {
      if (form.id) {
        const updateRes = await postApi<AppointmentSaveResponse>('/appointments/mine/update', {
          appointmentId: form.id,
          patientName: form.patientName,
          patientEmail: form.patientEmail || undefined,
          patientPhone: form.patientPhone || undefined,
          startDateTime: fromLocalInputValue(form.startDateTime),
          endDateTime: fromLocalInputValue(form.endDateTime),
          notes: form.notes,
          status: 'CONFIRMED',
        })
        setMessage(updateRes.warning || 'Cita actualizada.')
      } else {
        const createRes = await postApi<AppointmentSaveResponse>('/appointments/mine/create', {
          patientName: form.patientName,
          patientEmail: form.patientEmail || undefined,
          patientPhone: form.patientPhone || undefined,
          startDateTime: fromLocalInputValue(form.startDateTime),
          endDateTime: fromLocalInputValue(form.endDateTime),
          notes: form.notes,
        })
        setMessage(createRes.warning || 'Cita creada.')
      }
      setForm({
        id: '',
        patientName: '',
        patientEmail: '',
        patientPhone: '',
        startDateTime: '',
        endDateTime: '',
        notes: '',
      })
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo guardar cita')
    }
  }

  const cancelAppointment = async (id: string) => {
    setMessage('')
    try {
      await postApi('/appointments/mine/update', { appointmentId: id, status: 'CANCELLED' })
      setMessage('Cita cancelada.')
      await load()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'No se pudo cancelar cita')
    }
  }

  const editAppointment = (item: PatientAppointment) => {
    setForm({
      id: item.id,
      patientName: item.patientName,
      patientEmail: item.patientEmail || '',
      patientPhone: item.patientPhoneE164 || '',
      startDateTime: item.startDateTime ? new Date(item.startDateTime).toISOString().slice(0, 16) : '',
      endDateTime: item.endDateTime ? new Date(item.endDateTime).toISOString().slice(0, 16) : '',
      notes: item.notes || '',
    })
    setMessage('Editando cita. Guarda para aplicar cambios.')
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Citas de mis pacientes</h1>

      <Card>
        <h2 className="font-semibold">{form.id ? 'Editar cita de paciente' : 'Registrar nueva cita de paciente'}</h2>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          <Input placeholder="Nombre del paciente" value={form.patientName} onChange={(e) => setForm((p) => ({ ...p, patientName: e.target.value }))} />
          <Input placeholder="Correo paciente (opcional)" value={form.patientEmail} onChange={(e) => setForm((p) => ({ ...p, patientEmail: e.target.value }))} />
          <Input
            placeholder="Telefono paciente (ej. +502XXXXXXXX)"
            value={form.patientPhone}
            onChange={(e) => setForm((p) => ({ ...p, patientPhone: e.target.value }))}
          />

          <Input type="datetime-local" value={form.startDateTime} onChange={(e) => setForm((p) => ({ ...p, startDateTime: e.target.value }))} />
          <Input type="datetime-local" value={form.endDateTime} onChange={(e) => setForm((p) => ({ ...p, endDateTime: e.target.value }))} />
          <Input placeholder="Notas" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
        </div>

        <div className="mt-3 flex gap-2">
          <Button onClick={saveAppointment}>{form.id ? 'Actualizar cita' : 'Guardar cita'}</Button>
          {form.id && (
            <Button
              className="bg-slate-700 hover:bg-slate-800"
              onClick={() =>
                setForm({
                  id: '',
                  patientName: '',
                  patientEmail: '',
                  patientPhone: '',
                  startDateTime: '',
                  endDateTime: '',
                  notes: '',
                })
              }
            >
              Cancelar edición
            </Button>
          )}
        </div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Agenda de pacientes</h2>
          <Button className="bg-slate-700 hover:bg-slate-800" onClick={load}>Actualizar</Button>
        </div>
        {loading && <p className="mt-2 text-sm text-slate-500">Cargando...</p>}
        {!loading && appointments.length === 0 && <p className="mt-2 text-sm text-slate-500">No tienes citas registradas.</p>}
        <div className="mt-3 space-y-2">
          {appointments.map((item) => (
            <div key={item.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <p className="font-semibold">{item.patientName}</p>
              {item.patientEmail && <p>Email paciente: {item.patientEmail}</p>}
              {item.patientPhoneE164 && <p>Teléfono: {item.patientPhoneE164}</p>}
              <p>WhatsApp: {item.patientWhatsappOptIn ? `Sí (${item.patientPhoneVerified ? 'verificado' : 'no verificado'})` : 'No'}</p>
              <p>Inicio: {new Date(item.startDateTime).toLocaleString('es-GT')}</p>
              <p>Fin: {new Date(item.endDateTime).toLocaleString('es-GT')}</p>
              <p>Estado: {item.status}</p>
              {item.notes && <p>Notas: {item.notes}</p>}
              {item.status !== 'CANCELLED' && (
                <div className="mt-2 flex gap-2">
                  <Button onClick={() => editAppointment(item)}>Editar</Button>
                  <Button className="bg-slate-700 hover:bg-slate-800" onClick={() => cancelAppointment(item.id)}>
                    Cancelar
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </Card>

      {message && <p className="text-sm text-sky-700">{message}</p>}
    </div>
  )
}
