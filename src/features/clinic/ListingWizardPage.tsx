import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { postApi } from '../../lib/api'

const steps = ['Basico', 'Fotos y tags', 'Precios y disponibilidad', 'Politicas y publicacion']

type ListingForm = {
  title: string
  zone: string
  type: 'CLINIC' | 'OR'
  photos: string[]
}

export function ListingWizardPage() {
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<ListingForm>({ title: '', zone: '', type: 'CLINIC', photos: [] })

  const toBase64 = async (file: File) => {
    const buffer = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
    return btoa(binary)
  }

  const uploadListingPhoto = async (file: File) => {
    const base64Data = await toBase64(file)
    const upload = await postApi<{ url: string }>('/media/uploadImage', {
      fileName: file.name,
      contentType: file.type || 'image/jpeg',
      base64Data,
      scope: form.type === 'OR' ? 'or_listing' : 'clinic_listing',
    })
    setForm((prev) => ({ ...prev, photos: Array.from(new Set([upload.url, ...prev.photos])) }))
  }

  const autosave = async () => {
    await postApi('/listings/autosaveDraft', form)
    alert('Borrador guardado')
  }

  const publish = async () => {
    try {
      await postApi('/listings/publish', form)
      alert('Listado publicado.')
    } catch (error) {
      alert(error instanceof Error ? error.message : 'No se pudo publicar el listado')
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
      <h1 className="text-2xl font-bold">Wizard de listado</h1>
      <p className="text-sm text-slate-600">
        Paso {step + 1}: {steps[step]}
      </p>

      <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Titulo" />
      <Input value={form.zone} onChange={(e) => setForm((f) => ({ ...f, zone: e.target.value }))} placeholder="Zona 1-25" />
      <select
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
        value={form.type}
        onChange={(e) => setForm((f) => ({ ...f, type: e.target.value as 'CLINIC' | 'OR' }))}
      >
        <option value="CLINIC">Clinica</option>
        <option value="OR">Quirofano</option>
      </select>

      <div className="space-y-2 rounded-lg border border-slate-200 p-3">
        <p className="text-sm font-medium">Fotos del espacio ({form.type === 'OR' ? 'quirofano' : 'clinica'})</p>
        <Input
          type="file"
          accept="image/*"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            uploadListingPhoto(file).catch((err) => alert(err instanceof Error ? err.message : 'No se pudo subir foto'))
          }}
        />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {form.photos.map((url) => (
            <img key={url} src={url} alt="Foto listing" className="h-24 w-full rounded-md border border-slate-200 object-cover" />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Button className="bg-slate-700 hover:bg-slate-600" onClick={autosave}>
          Guardar borrador
        </Button>
        <Button onClick={() => setStep((s) => Math.min(s + 1, steps.length - 1))}>Siguiente</Button>
        <Button onClick={publish}>Publicar</Button>
      </div>
    </div>
  )
}
