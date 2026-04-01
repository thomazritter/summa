import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ProfileSelector } from './pages/ProfileSelector';
import { ArticleUpload } from './pages/ArticleUpload';
import { SummaryView } from './pages/SummaryView';
import { ExperimentLanding } from './pages/experiment/ExperimentLanding';
import { ExperimentRegister } from './pages/experiment/ExperimentRegister';
import { ExperimentSelectArticle } from './pages/experiment/ExperimentSelectArticle';
import { ExperimentTrial } from './pages/experiment/ExperimentTrial';
import { ExperimentFeedback } from './pages/experiment/ExperimentFeedback';
import { ExperimentRegenerated } from './pages/experiment/ExperimentRegenerated';
import { ExperimentComplete } from './pages/experiment/ExperimentComplete';

const queryClient = new QueryClient();
const USER_ID = 1; // MVP: hardcoded user

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <div className="min-h-screen bg-gray-50">
          <header className="bg-white shadow-sm">
            <div className="max-w-4xl mx-auto px-4 py-4">
              <h1 className="text-xl font-semibold text-gray-900">Scientific Article Summarizer</h1>
            </div>
          </header>
          <main className="max-w-4xl mx-auto px-4 py-8">
            <Routes>
              <Route path="/" element={<Navigate to="/profiles" replace />} />
              <Route path="/profiles" element={<ProfileSelector userId={USER_ID} />} />
              <Route path="/upload" element={<ArticleUpload />} />
              <Route path="/summary/:id" element={<SummaryView />} />
              {/* Experiment routes */}
              <Route path="/experiment" element={<ExperimentLanding />} />
              <Route path="/experiment/register" element={<ExperimentRegister />} />
              <Route path="/experiment/select-article" element={<ExperimentSelectArticle />} />
              <Route path="/experiment/trial/:sessionId" element={<ExperimentTrial />} />
              <Route path="/experiment/feedback/:sessionId" element={<ExperimentFeedback />} />
              <Route path="/experiment/regenerated/:sessionId" element={<ExperimentRegenerated />} />
              <Route path="/experiment/complete" element={<ExperimentComplete />} />
            </Routes>
          </main>
        </div>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
