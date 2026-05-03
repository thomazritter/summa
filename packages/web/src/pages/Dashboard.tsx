import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { userApi } from '../api/client';
import { ModelSwitcher } from '../components/ModelSwitcher';
import type { SummaryResult } from '../api/client';

interface UserArticle {
  id: number;
  title: string;
  authors: string | null;
  createdAt: string;
  summaries: Array<{
    id: number;
    content: string;
    modelLabel: string | null;
    factualityScore: number | null;
    createdAt: string;
  }>;
}

function FactualityBadge({ score }: { score: number | null }) {
  if (score === null) return null;

  const percentage = Math.round(score * 100);
  let colorClasses: string;

  if (percentage >= 80) {
    colorClasses = 'bg-green-100 text-green-700';
  } else if (percentage >= 60) {
    colorClasses = 'bg-amber-100 text-amber-700';
  } else {
    colorClasses = 'bg-red-100 text-red-700';
  }

  return (
    <span className={`${colorClasses} text-xs font-medium rounded-full px-2.5 py-0.5`}>
      Factualidade: {percentage}%
    </span>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export function Dashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const participantId = sessionStorage.getItem('experimentParticipantId');
  const userEmail = sessionStorage.getItem('userEmail') || '';
  const [expandedArticleId, setExpandedArticleId] = useState<number | null>(null);

  const hasProfile = Boolean(participantId);

  const {
    data: articles,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['user-articles'],
    queryFn: () => userApi.getArticles() as Promise<UserArticle[]>,
    enabled: hasProfile,
  });

  const handleLogout = () => {
    sessionStorage.clear();
    navigate('/', { replace: true });
  };

  const toggleArticle = (articleId: number) => {
    setExpandedArticleId((prev) => (prev === articleId ? null : articleId));
  };

  const handleDashboardNewSummary = (_summary: SummaryResult) => {
    void queryClient.invalidateQueries({ queryKey: ['user-articles'] });
  };

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-gray-900">Summa</h1>
          <div className="flex items-center gap-4">
            {userEmail && (
              <span className="text-sm text-gray-600">{userEmail}</span>
            )}
            <Link
              to="/profile"
              className="text-sm text-[#2563eb] hover:text-[#1d4ed8] font-medium transition-colors"
            >
              Perfil
            </Link>
            <button
              type="button"
              onClick={handleLogout}
              className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="max-w-4xl mx-auto py-8 px-6">
        {/* Welcome / Profile setup section */}
        {!hasProfile && (
          <div className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Configure seu perfil
            </h2>
            <p className="text-gray-600 mb-6">
              Configure seu perfil para receber resumos personalizados de acordo
              com seu nível de experiência e preferências de leitura.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to="/profile/setup"
                className="py-3 px-6 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors text-center"
              >
                Responder questionário
              </Link>
              <Link
                to="/profile/cv"
                className="py-3 px-6 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:bg-gray-50 transition-colors text-center"
              >
                Enviar currículo (PDF)
              </Link>
            </div>
          </div>
        )}

        {/* New article button */}
        {hasProfile && (
          <div className="mb-8">
            <button
              type="button"
              onClick={() => navigate('/upload')}
              className="py-3 px-6 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors"
            >
              + Novo artigo
            </button>
          </div>
        )}

        {/* Articles section */}
        <section aria-label="Seus resumos">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">
            Seus Resumos
          </h2>

          {/* Loading state */}
          {isLoading && (
            <div className="text-center py-12">
              <div
                className="mx-auto h-8 w-8 border-4 border-gray-200 border-t-[#2563eb] rounded-full animate-spin mb-4"
                role="status"
                aria-label="Carregando artigos"
              />
              <p className="text-gray-500">Carregando seus artigos...</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div
              className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg"
              role="alert"
            >
              Erro ao carregar artigos: {(error as Error).message}
            </div>
          )}

          {/* Empty state */}
          {!isLoading && !error && hasProfile && articles && articles.length === 0 && (
            <div className="text-gray-500 text-center py-12">
              Nenhum artigo ainda. Envie seu primeiro artigo!
            </div>
          )}

          {/* No profile yet - different empty state */}
          {!hasProfile && (
            <div className="text-gray-500 text-center py-12">
              Configure seu perfil acima para começar a enviar artigos.
            </div>
          )}

          {/* Article list */}
          {articles && articles.length > 0 && (
            <div className="space-y-4">
              {articles.map((article) => {
                const isExpanded = expandedArticleId === article.id;
                const latestSummary = article.summaries[0];
                const rawPreview = latestSummary
                  ? latestSummary.content.replace(/[#*_~`>]/g, '').replace(/\n+/g, ' ').trim()
                  : '';
                const previewText = rawPreview
                  ? rawPreview.slice(0, 200) + (rawPreview.length > 200 ? '...' : '')
                  : 'Sem resumo disponível';

                return (
                  <article
                    key={article.id}
                    className="bg-white border border-gray-200 rounded-lg"
                  >
                    {/* Card header - always visible */}
                    <button
                      type="button"
                      onClick={() => toggleArticle(article.id)}
                      className="w-full text-left p-6 focus:outline-none focus:ring-2 focus:ring-[#2563eb] focus:ring-inset rounded-lg"
                      aria-expanded={isExpanded}
                      aria-controls={`article-detail-${article.id}`}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <h3 className="text-lg font-semibold text-gray-900 mb-1 truncate">
                            {article.title || 'Sem título'}
                          </h3>
                          <p className="text-sm text-gray-500 mb-3">
                            {formatDate(article.createdAt)}
                            {article.authors && ` — ${article.authors}`}
                          </p>
                          {!isExpanded && (
                            <p className="text-sm text-gray-600 line-clamp-2">
                              {previewText}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          {latestSummary && (
                            <FactualityBadge score={latestSummary.factualityScore} />
                          )}
                          <svg
                            className={`h-5 w-5 text-gray-400 transition-transform ${
                              isExpanded ? 'rotate-180' : ''
                            }`}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && latestSummary && (
                      <div
                        id={`article-detail-${article.id}`}
                        className="border-t border-gray-200 p-6"
                      >
                        {latestSummary.modelLabel && (
                          <div className="mb-4">
                            <span className="bg-gray-100 text-gray-600 text-xs font-medium rounded-full px-2.5 py-0.5">
                              Modelo: {latestSummary.modelLabel}
                            </span>
                          </div>
                        )}

                        <div className="prose prose-sm max-w-none text-gray-700 mb-6">
                          <ReactMarkdown>{latestSummary.content}</ReactMarkdown>
                        </div>

                        <div className="flex items-center gap-3 mb-2">
                          <Link
                            to={`/summary/${latestSummary.id}`}
                            className="inline-block py-2.5 px-5 bg-[#2563eb] text-white text-sm font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors text-center"
                          >
                            Ver detalhes
                          </Link>
                          <button
                            type="button"
                            onClick={async (e) => {
                              e.stopPropagation();
                              if (!confirm('Tem certeza que deseja excluir este resumo?')) return;
                              try {
                                await userApi.deleteSummary(latestSummary.id);
                                void queryClient.invalidateQueries({ queryKey: ['user-articles'] });
                              } catch {
                                alert('Erro ao excluir resumo');
                              }
                            }}
                            className="py-2.5 px-5 border border-red-300 text-red-600 text-sm font-semibold rounded-lg hover:bg-red-50 transition-colors"
                          >
                            Excluir resumo
                          </button>
                        </div>

                        <ModelSwitcher
                          articleId={article.id}
                          currentModelId={latestSummary.modelLabel}
                          onNewSummary={handleDashboardNewSummary}
                        />
                      </div>
                    )}

                    {/* Expanded but no summary */}
                    {isExpanded && !latestSummary && (
                      <div
                        id={`article-detail-${article.id}`}
                        className="border-t border-gray-200 p-6"
                      >
                        <p className="text-gray-500 text-sm">
                          Nenhum resumo disponível para este artigo.
                        </p>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
