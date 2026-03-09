import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { postApi } from '../../lib/api'

export function PatientProfilePage() {
  const [fullName, setFullName] = useState('')
  const [age, setAge] = useState('')
  const [idNumber, setIdNumber] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')

  const saveEncrypted = async () => {
    await postApi('/crypto/patient/encryptAndCreate', { fullName, age: Number(age), idNumber, dateOfBirth })
    alert('Perfil encriptado guardado.')
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <h1 className="text-2xl font-bold">Perfil encriptado</h1>
      <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Nombre completo" />
      <Input value={age} onChange={(e) => setAge(e.target.value)} placeholder="Edad" type="number" />
      <Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} placeholder="DPI" />
      <Input value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} placeholder="Fecha de nacimiento (YYYY-MM-DD)" />
      <Button onClick={saveEncrypted}>Guardar cifrado</Button>
    </div>
  )
}
