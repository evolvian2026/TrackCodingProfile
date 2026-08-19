import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { FiltersProvider } from './hooks/useFilters';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import LoginPage from './pages/LoginPage';
import DashboardPage from './pages/DashboardPage';
import StudentsPage from './pages/StudentsPage';
import StudentDetailPage from './pages/StudentDetailPage';
import UploadPage from './pages/UploadPage';
import JobsPage from './pages/JobsPage';
import JobDetailPage from './pages/JobDetailPage';
import LeaderboardPage from './pages/LeaderboardPage';
import AnalyticsPage from './pages/AnalyticsPage';
import BatchPage from './pages/BatchPage';
import CollegesPage from './pages/CollegesPage';
import ComparePage from './pages/ComparePage';
import PlatformsPage from './pages/PlatformsPage';
import SettingsPage from './pages/SettingsPage';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-2 text-ink-muted">
        <Spinner />
        <span className="text-sm">Loading…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <FiltersProvider>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route element={<Layout />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/students" element={<StudentsPage />} />
          <Route path="/students/:id" element={<StudentDetailPage />} />
          <Route path="/compare" element={<ComparePage />} />
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/jobs/:id" element={<JobDetailPage />} />
          <Route path="/leaderboard" element={<LeaderboardPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/batches" element={<BatchPage />} />
          <Route path="/colleges" element={<CollegesPage />} />
          <Route path="/platforms" element={<PlatformsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </FiltersProvider>
  );
}
