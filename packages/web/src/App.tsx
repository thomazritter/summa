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
import { ExperimentLanding } from './pages/experiment/ExperimentLanding';
import { ExperimentSelectArticle } from './pages/experiment/ExperimentSelectArticle';
import { ExperimentTrial } from './pages/experiment/ExperimentTrial';
import { ExperimentPostTest } from './pages/experiment/ExperimentPostTest';
import { ExperimentComplete } from './pages/experiment/ExperimentComplete';
import { AuthGuard } from './components/AuthGuard';
import { ManagerDashboard } from './pages/manager/ManagerDashboard';

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

          {/* Manager routes */}
          <Route
            path="/manager"
            element={
              <AuthGuard requiredRole="manager">
                <ManagerDashboard />
              </AuthGuard>
            }
          />

          {/* Experiment routes — kept reachable via direct URL for academic
              reproducibility of the A/B study described in the thesis. Not
              linked from the main product UI. */}
          <Route
            path="/experiment"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentLanding />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/register"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentRegister />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/cv-upload"
            element={
              <AuthGuard requiredRole="participant">
                <CvUpload />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/profile"
            element={
              <AuthGuard requiredRole="participant">
                <ProfileView />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/select-article"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentSelectArticle />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/trial/:sessionId"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentTrial />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/post-test"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentPostTest />
              </AuthGuard>
            }
          />
          <Route
            path="/experiment/complete"
            element={
              <AuthGuard requiredRole="participant">
                <ExperimentComplete />
              </AuthGuard>
            }
          />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
