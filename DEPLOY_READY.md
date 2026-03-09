# Deploy rápido (Medyko)

## 1) Completar variables reales
Archivo: `functions/.env.medyko-project`

Reemplaza placeholders:
- `FALLBACK_MASTER_KEY`
- `GOOGLE_CLOUD_PROJECT=medyko-project`
- `RECURRENTE_API_URL`
- `RECURRENTE_API_KEY`
- `RECURRENTE_WEBHOOK_SECRET`
- `LEGACY_STRIPE_API_URL`
- `LEGACY_STRIPE_RETURN_URL`
- `ALGOLIA_APP_ID`
- `ALGOLIA_ADMIN_KEY`

## 2) Comandos de deploy

```powershell
firebase use medyko-project
npm --prefix functions run build
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## 3) Bloqueo actual
El proyecto Firebase debe estar en plan **Blaze** para desplegar Functions.
Si no está en Blaze, verás error de `artifactregistry.googleapis.com` / `cloudbuild.googleapis.com`.
