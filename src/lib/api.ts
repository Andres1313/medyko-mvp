import { auth } from './firebase'

async function authHeaders() {
  const token = await auth.currentUser?.getIdToken()
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

export async function postApi<T>(path: string, body: unknown): Promise<T> {
  const headers = await authHeaders()
  const response = await fetch(`${import.meta.env.VITE_FUNCTIONS_BASE_URL}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(errText || `Error ${response.status}`)
  }

  return response.json() as Promise<T>
}
