import { Navigate, createBrowserRouter, useLocation } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout'
import { RoleGuard } from '../components/layout/RoleGuard'
import { HomePage } from '../features/directory/HomePage'
import { DirectoryPage } from '../features/directory/DirectoryPage'
import { SpacesPage } from '../features/directory/SpacesPage'
import { DoctorPublicProfilePage } from '../features/directory/DoctorPublicProfilePage'
import { AuthPage } from '../features/auth/AuthPage'
import { DoctorDashboardPage } from '../features/doctor/DoctorDashboardPage'
import { DoctorOnboardingPage } from '../features/doctor/DoctorOnboardingPage'
import { DoctorVerifyPage } from '../features/doctor/DoctorVerifyPage'
import { DoctorListingsPage } from '../features/doctor/DoctorListingsPage'
import { DoctorBookPage } from '../features/doctor/DoctorBookPage'
import { DoctorProfilePage } from '../features/doctor/DoctorProfilePage'
import { DoctorPatientAppointmentsPage } from '../features/doctor/DoctorPatientAppointmentsPage'
import { DoctorBookingsPage } from '../features/doctor/DoctorBookingsPage'
import { ClinicDashboardPage } from '../features/clinic/ClinicDashboardPage'
import { ClinicListingsPage } from '../features/clinic/ClinicListingsPage'
import { ListingWizardPage } from '../features/clinic/ListingWizardPage'
import { ListingEditPage } from '../features/clinic/ListingEditPage'
import { ClinicVerifyPage } from '../features/clinic/ClinicVerifyPage'
import { ClinicCalendarPage } from '../features/clinic/ClinicCalendarPage'
import { ClinicBookingsPage } from '../features/clinic/ClinicBookingsPage'
import { ClinicPatientsPage } from '../features/clinic/ClinicPatientsPage'
import { ClinicLedgerPage } from '../features/clinic/ClinicLedgerPage'
import { PlatformAdminPage } from '../features/platform/PlatformAdminPage'
import { AppointmentManagePage } from '../features/public/AppointmentManagePage'
import { EmergencyAppointmentPage } from '../features/public/EmergencyAppointmentPage'
import { PrivacyPolicyPage } from '../features/legal/PrivacyPolicyPage'

function NotFound() {
  return <div className="text-sm text-slate-600">Página no encontrada.</div>
}

function CitasLegacyRoute() {
  const location = useLocation()
  const marker = '/appointment/manage/'
  const idx = location.pathname.indexOf(marker)
  if (idx >= 0) {
    const rest = location.pathname.slice(idx + marker.length)
    const appointmentId = rest.split('/')[0]
    if (appointmentId) {
      return <Navigate replace to={`/appointment/manage/${appointmentId}${location.search || ''}`} />
    }
  }
  return <NotFound />
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'directory', element: <DirectoryPage /> },
      { path: 'doctors/:doctorUid', element: <DoctorPublicProfilePage /> },
      { path: 'spaces', element: <SpacesPage /> },
      { path: 'auth', element: <AuthPage /> },
      { path: 'privacy', element: <PrivacyPolicyPage /> },
      { path: 'appointment/manage/:appointmentId', element: <AppointmentManagePage /> },
      { path: 'citas/appointment/manage/:appointmentId', element: <AppointmentManagePage /> },
      { path: 'citas/*', element: <CitasLegacyRoute /> },

      {
        element: <RoleGuard allowedRoles={['doctor']} />,
        children: [
          { path: 'doctor', element: <DoctorDashboardPage /> },
          { path: 'doctor/onboarding', element: <DoctorOnboardingPage /> },
          { path: 'doctor/verify', element: <DoctorVerifyPage /> },
          { path: 'doctor/profile', element: <DoctorProfilePage /> },
          { path: 'doctor/patient-appointments', element: <DoctorPatientAppointmentsPage /> },
          { path: 'doctor/bookings', element: <DoctorBookingsPage /> },
          { path: 'emergency_appointment/:emergencyId', element: <EmergencyAppointmentPage /> },
          { path: 'doctor/listings', element: <DoctorListingsPage /> },
          { path: 'doctor/book/:type/:clinicId/:listingId', element: <DoctorBookPage /> },
        ],
      },
      {
        element: <RoleGuard allowedRoles={['doctor', 'clinic_admin']} />,
        children: [
          { path: 'clinic', element: <ClinicDashboardPage /> },
          { path: 'clinic/listings', element: <ClinicListingsPage /> },
          { path: 'clinic/verify', element: <ClinicVerifyPage /> },
          { path: 'clinic/listings/new', element: <ListingWizardPage /> },
          { path: 'clinic/listings/:type/:id/edit', element: <ListingEditPage /> },
          { path: 'clinic/calendar', element: <ClinicCalendarPage /> },
          { path: 'clinic/bookings', element: <ClinicBookingsPage /> },
          { path: 'clinic/patients', element: <ClinicPatientsPage /> },
          { path: 'clinic/ledger', element: <ClinicLedgerPage /> },
        ],
      },
      {
        element: <RoleGuard allowedRoles={['platform_admin']} />,
        children: [{ path: 'platform', element: <PlatformAdminPage /> }],
      },
      { path: '*', element: <NotFound /> },
    ],
  },
])
