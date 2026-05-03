import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { userApi } from '../api/client';

export function SummaryView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: articles, isLoading } = useQuery({
    queryKey: ['user-articles'],
    queryFn: () => userApi.getArticles(),
  });

  // Find the summary across all articles
  const summaryId = Number(id);
  let foundSummary: { id: number; content: string; factualityScore: number | null; modelLabel: string | null } | null = null;
  let foundArticle: { title: string; authors: string | null } | null = null;

  if (articles) {
    for (const article of articles) {
      const match = article.summaries.find((s) => s.id === summaryId);
      if (match) {
        foundSummary = {
          id: match.id,
          content: match.content,
          factualityScore: match.factualityScore,
          modelLabel: match.modelLabel,
        };
        foundArticle = { title: article.title, authors: article.authors };
        break;
      }
    }
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Carregando resumo...</p>
        </div>
      </div>
    );
  }

  if (!foundSummary || !foundArticle) {
    return (
      <div className="min-h-screen bg-[#f9fafb] py-12 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Resumo não encontrado</h1>
          <p className="text-gray-600 mb-6">Este resumo pode ter sido removido ou o link está incorreto.</p>
          <button
            onClick={() => navigate('/dashboard')}
            className="px-6 py-3 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors"
          >
            Voltar ao dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f9fafb] py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link
            to="/dashboard"
            className="text-[#2563eb] hover:text-[#1d4ed8] text-sm font-medium transition-colors"
          >
            &larr; Voltar ao dashboard
          </Link>
        </div>

        {/* Article info */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">{foundArticle.title}</h1>
          {foundArticle.authors && (
            <p className="text-gray-500 text-sm">{foundArticle.authors}</p>
          )}
        </div>

        {/* Summary content */}
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-semibold text-gray-900">Resumo Personalizado</h2>
            <div className="flex items-center gap-3">
              {foundSummary.modelLabel && (
                <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                  {foundSummary.modelLabel}
                </span>
              )}
              {foundSummary.factualityScore !== null && (
                <span className={`px-3 py-1 text-xs rounded-full ${
                  foundSummary.factualityScore >= 0.8
                    ? 'bg-green-100 text-green-700'
                    : foundSummary.factualityScore >= 0.6
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  Factualidade: {(foundSummary.factualityScore * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </div>

          <div className="prose prose-gray max-w-none">
            <ReactMarkdown>{foundSummary.content}</ReactMarkdown>
          </div>
        </div>
      </div>
    </div>
  );
}
