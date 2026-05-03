import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { ProfileSelector } from './pages/ProfileSelector';
import { ArticleUpload } from './pages/ArticleUpload';
import { SummaryView } from './pages/SummaryView';
import { Login } from './pages/Login';
import { AuthGuard } from './components/AuthGuard';
import { ManagerDashboard } from './pages/manager/ManagerDashboard';
import { ExperimentLanding } from './pages/experiment/ExperimentLanding';
import { ExperimentRegister } from './pages/experiment/ExperimentRegister';
import { ExperimentSelectArticle } from './pages/experiment/ExperimentSelectArticle';
import { ExperimentTrial } from './pages/experiment/ExperimentTrial';
import { ExperimentComplete } from './pages/experiment/ExperimentComplete';
import { ExperimentPostTest } from './pages/experiment/ExperimentPostTest';
import { ProfileView } from './pages/experiment/ProfileView';

const queryClient = new QueryClient();
const USER_ID = 1; // MVP: hardcoded user

function AppHeader() {
  const location = useLocation();
  const isExperimentRoute = location.pathname.startsWith('/experiment');

  if (isExperimentRoute) return null;

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <h1 className="text-xl font-semibold text-gray-900">Resumidor de Artigos Científicos</h1>
      </div>
    </header>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50">
          <AppHeader />
          <main className="max-w-4xl mx-auto px-4 py-8">
            <Routes>
              {/* Auth */}
              <Route path="/" element={<Login />} />

              {/* Original app routes (no auth guard — keep backward compatible) */}
              <Route path="/profiles" element={<ProfileSelector userId={USER_ID} />} />
              <Route path="/upload" element={<ArticleUpload />} />
              <Route path="/summary/:id" element={<SummaryView />} />

              {/* Manager routes */}
              <Route
                path="/manager"
                element={
                  <AuthGuard requiredRole="manager">
                    <ManagerDashboard />
                  </AuthGuard>
                }
              />

              {/* Experiment routes */}
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
                path="/experiment/profile"
                element={
                  <AuthGuard requiredRole="participant">
                    <ProfileView />
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
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
