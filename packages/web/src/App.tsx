import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Login } from './pages/Login';
import { AuthVerify } from './pages/AuthVerify';
import { Dashboard } from './pages/Dashboard';
import { ArticleUpload } from './pages/ArticleUpload';
import { SummaryView } from './pages/SummaryView';
import { ProfileView } from './pages/experiment/ProfileView';
import { CvUpload } from './pages/experiment/CvUpload';
import { ExperimentRegister } from './pages/experiment/ExperimentRegister';
import { AuthGuard } from './components/AuthGuard';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Auth (no guard) */}
          <Route path="/" element={<Login />} />
          <Route path="/auth/verify" element={<AuthVerify />} />

          {/* Product routes (auth required) */}
          <Route
            path="/dashboard"
            element={
              <AuthGuard requiredRole="participant">
                <Dashboard />
              </AuthGuard>
            }
          />
          <Route
            path="/upload"
            element={
              <AuthGuard requiredRole="participant">
                <ArticleUpload />
              </AuthGuard>
            }
          />
          <Route
            path="/summary/:id"
            element={
              <AuthGuard requiredRole="participant">
                <SummaryView />
              </AuthGuard>
            }
          />
          <Route
            path="/profile"
            element={
              <AuthGuard requiredRole="participant">
                <ProfileView />
              </AuthGuard>
            }
          />
          <Route
            path="/profile/setup"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentRegister />
              </AuthGuard>
            }
          />
          <Route
            path="/profile/cv"
            element={
              <AuthGuard requiredRole="participant">
                <CvUpload />
              </AuthGuard>
            }
          />

        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
