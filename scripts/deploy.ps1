param(
  [string]$ProjectId = 'medyko-project'
)

$ErrorActionPreference = 'Stop'

Write-Host "[1/6] Usando proyecto Firebase: $ProjectId"
firebase use $ProjectId | Out-Host

Write-Host "[2/6] Build frontend"
npm run build | Out-Host

Write-Host "[3/6] Build functions"
npm --prefix functions run build | Out-Host

Write-Host "[4/6] Deploy functions"
firebase deploy --only functions | Out-Host

Write-Host "[5/6] Deploy firestore rules/indexes"
firebase deploy --only firestore:rules,firestore:indexes | Out-Host

Write-Host "[6/6] Listo"
