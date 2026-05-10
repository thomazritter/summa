import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi, experimentApi } from '../api/client';
import { ModelSwitcher } from '../components/ModelSwitcher';
import { FactualityHighlightedMarkdown } from '../components/FactualityHighlightedMarkdown';
import type { FactualitySentence } from '../components/FactualityHighlightedMarkdown';
import { MetricsPanel } from '../components/MetricsPanel';
import type { SummaryResult } from '../api/client';

interface RegeneratedSummary {
  id: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
  modelId: string | null;
}

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
  const [regenerated, setRegenerated] = useState<RegeneratedSummary | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);

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

  const handleRegenerateWithEvidence = async () => {
    if (!displaySummary) return;
    setRegenLoading(true);
    setRegenError(null);
    try {
      const result = await experimentApi.regenerateSummaryWithEvidence(displaySummary.id);
      setRegenerated({
        id: result.id,
        content: result.content,
        factualityScore: result.factualityScore,
        factualityDetails: result.factualityDetails,
        modelId: result.modelId,
      });
      void queryClient.invalidateQueries({ queryKey: ['user-articles'] });
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Falha ao regenerar resumo');
    } finally {
      setRegenLoading(false);
    }
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

        {/* Guided regeneration by factuality */}
        {(() => {
          const flaggedCount = displaySummary.factualityDetails
            ? displaySummary.factualityDetails.filter((d) => d.label !== 'supported').length
            : 0;
          const noFlagged = flaggedCount === 0;
          const buttonTitle = noFlagged
            ? 'Nenhuma frase deste resumo foi sinalizada como não apoiada pelo artigo.'
            : `Reprocessa o resumo usando os trechos do artigo correspondentes às ${flaggedCount} frase(s) sinalizadas.`;

          return (
            <div className="mt-4 border border-gray-200 rounded-lg bg-white p-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900">
                    Regeneração guiada por factualidade
                  </h3>
                  <p className="text-xs text-gray-600 mt-1">
                    {noFlagged
                      ? 'Todas as frases verificadas têm suporte direto no artigo.'
                      : `${flaggedCount} frase(s) sem suporte direto no artigo. Você pode reprocessar o resumo com as evidências em mãos.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleRegenerateWithEvidence}
                  disabled={noFlagged || regenLoading}
                  title={buttonTitle}
                  className={`py-2.5 px-5 text-sm font-semibold rounded-lg transition-colors ${
                    noFlagged || regenLoading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-[#2563eb] text-white hover:bg-[#1d4ed8]'
                  }`}
                >
                  {regenLoading ? 'Regenerando...' : 'Regenerar com foco em factualidade'}
                </button>
              </div>
              {regenError && (
                <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">
                  {regenError}
                </p>
              )}
            </div>
          );
        })()}

        {/* Regenerated summary side-by-side */}
        {regenerated && (
          <div className="mt-6 bg-white border border-gray-200 rounded-lg p-8">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-gray-900">
                Resumo regenerado com evidências
              </h2>
              <div className="flex items-center gap-3">
                {regenerated.factualityScore !== null ? (
                  <span className={`px-3 py-1 text-xs rounded-full ${
                    regenerated.factualityScore >= 0.8
                      ? 'bg-green-100 text-green-700'
                      : regenerated.factualityScore >= 0.6
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    Factualidade: {(regenerated.factualityScore * 100).toFixed(0)}%
                  </span>
                ) : (
                  <span className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-600">
                    Verificando factualidade...
                  </span>
                )}
              </div>
            </div>
            <p className="text-xs text-gray-500 mb-4">
              Versão reescrita a partir das frases sinalizadas e dos trechos-âncora do artigo.
              O escore de factualidade é recalculado em segundo plano e aparece após alguns segundos.
            </p>
            <FactualityHighlightedMarkdown
              content={regenerated.content}
              factualityDetails={regenerated.factualityDetails}
            />
          </div>
        )}

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
