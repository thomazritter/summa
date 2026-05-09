import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi } from '../api/client';
import { ModelSwitcher } from '../components/ModelSwitcher';
import { FactualityHighlightedMarkdown } from '../components/FactualityHighlightedMarkdown';
import type { FactualitySentence } from '../components/FactualityHighlightedMarkdown';
import { MetricsPanel } from '../components/MetricsPanel';
import type { SummaryResult } from '../api/client';

interface DisplaySummary {
  id: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
  rouge1: number | null;
  rouge2: number | null;
  rougeL: number | null;
  bertScore: number | null;
  modelId: string | null;
  modelLabel: string | null;
}

export function SummaryView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [overrideSummary, setOverrideSummary] = useState<{
    id: number;
    content: string;
    modelId: string;
    factualityScore: number | null;
  } | null>(null);

  const { data: articles, isLoading } = useQuery({
    queryKey: ['user-articles'],
    queryFn: () => userApi.getArticles(),
  });

  // Find the summary across all articles
  const summaryId = Number(id);
  let foundSummary: DisplaySummary | null = null;
  let foundArticle: {
    id: number;
    title: string;
    authors: string | null;
    pAccuracy: { pAccuracyRouge: number | null; avgPairwiseRougeL: number | null } | null;
  } | null = null;

  if (articles) {
    for (const article of articles) {
      const match = article.summaries.find((s) => s.id === summaryId);
      if (match) {
        foundSummary = {
          id: match.id,
          content: match.content,
          factualityScore: match.factualityScore,
          factualityDetails: match.factualityDetails,
          rouge1: match.rouge1,
          rouge2: match.rouge2,
          rougeL: match.rougeL,
          bertScore: match.bertScore,
          modelId: match.modelId,
          modelLabel: match.modelLabel,
        };
        foundArticle = {
          id: article.id,
          title: article.title,
          authors: article.authors,
          pAccuracy: article.pAccuracy,
        };
        break;
      }
    }
  }

  // If a new summary was generated via model switch, use it instead.
  // Metrics for the new summary will populate on next refresh; show as null in the meantime.
  const displaySummary: DisplaySummary | null = overrideSummary
    ? {
        id: overrideSummary.id,
        content: overrideSummary.content,
        factualityScore: overrideSummary.factualityScore,
        factualityDetails: null,
        rouge1: null,
        rouge2: null,
        rougeL: null,
        bertScore: null,
        modelId: overrideSummary.modelId,
        modelLabel: overrideSummary.modelId,
      }
    : foundSummary;

  const handleNewSummary = (summary: SummaryResult) => {
    setOverrideSummary(summary);
    void queryClient.invalidateQueries({ queryKey: ['user-articles'] });
    navigate(`/summary/${summary.id}`, { replace: true });
  };

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

  if (!displaySummary || !foundArticle) {
    return (
      <div className="min-h-screen bg-[#f9fafb] py-12 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">Resumo não encontrado</h1>
          <p className="text-gray-600 mb-6">Este resumo pode ter sido removido ou o link está incorreto.</p>
          <button
            type="button"
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
              {displaySummary.modelLabel && (
                <span className="px-3 py-1 bg-gray-100 text-gray-600 text-xs rounded-full">
                  {displaySummary.modelLabel}
                </span>
              )}
              {displaySummary.factualityScore !== null && (
                <span className={`px-3 py-1 text-xs rounded-full ${
                  displaySummary.factualityScore >= 0.8
                    ? 'bg-green-100 text-green-700'
                    : displaySummary.factualityScore >= 0.6
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  Factualidade: {(displaySummary.factualityScore * 100).toFixed(0)}%
                </span>
              )}
            </div>
          </div>

          <FactualityHighlightedMarkdown
            content={displaySummary.content}
            factualityDetails={displaySummary.factualityDetails}
          />
        </div>

        {/* Technical metrics */}
        <MetricsPanel
          factualityScore={displaySummary.factualityScore}
          factualityDetails={displaySummary.factualityDetails}
          rouge1={displaySummary.rouge1}
          rouge2={displaySummary.rouge2}
          rougeL={displaySummary.rougeL}
          bertScore={displaySummary.bertScore}
          pAccuracy={foundArticle.pAccuracy}
        />

        {/* Model switcher */}
        <ModelSwitcher
          articleId={foundArticle.id}
          currentModelId={overrideSummary?.modelId || foundSummary?.modelId || null}
          onNewSummary={handleNewSummary}
        />
      </div>
    </div>
  );
}
