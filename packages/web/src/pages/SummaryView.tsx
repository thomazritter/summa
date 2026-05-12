import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi, experimentApi } from '../api/client';
import { FactualityHighlightedMarkdown } from '../components/FactualityHighlightedMarkdown';
import type { FactualitySentence } from '../components/FactualityHighlightedMarkdown';
import { SummaryRatingPanel } from '../components/SummaryRatingPanel';

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
  profile: {
    expertise: string;
    focus: string;
    depth: string;
    context: string;
    domain?: string | null;
    currentProject?: string | null;
  } | null;
}

export function SummaryView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [regenerated, setRegenerated] = useState<RegeneratedSummary | null>(null);
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const regenPanelRef = useRef<HTMLDivElement | null>(null);

  // Scroll the regen panel into view once it appears. Without this, users
  // see the unchanged parent at the top and assume the regeneration did
  // nothing, missing the new panel further down the page.
  useEffect(() => {
    if (!regenerated) return;
    regenPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [regenerated?.id]);

  const summaryId = Number(id);
  const { data: articles, isLoading } = useQuery({
    queryKey: ['user-articles'],
    queryFn: () => userApi.getArticles(),
    // Same pattern as Dashboard: while the summary on this page still has a
    // null factuality score (background NLI job not finished), poll the
    // list endpoint so the "Verificando..." badge resolves on its own.
    refetchInterval: (query) => {
      const data = query.state.data as Awaited<ReturnType<typeof userApi.getArticles>> | undefined;
      if (!data) return false;
      const current = data
        .flatMap((article) => article.summaries)
        .find((s) => s.id === summaryId);
      return current && current.factualityScore === null ? 5000 : false;
    },
    refetchOnWindowFocus: true,
  });

  // Find the summary across all articles
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
          profile: match.profile,
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

  const displaySummary: DisplaySummary | null = foundSummary;

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

  // Poll for the regen's factuality score until the background NLI job
  // finishes. The endpoint returns the row immediately after INSERT, so
  // factualityScore starts null and only fills in once checkFactuality
  // completes asynchronously. Without this loop, the "Verificando..."
  // label would stay forever even after the score is ready.
  useEffect(() => {
    if (!regenerated) return;
    if (regenerated.factualityScore !== null) return;

    let cancelled = false;
    let pollCount = 0;
    const maxPolls = 24; // 24 × 5s = 2 min hard ceiling

    const tick = async () => {
      if (cancelled) return;
      pollCount += 1;
      try {
        const fresh = await userApi.getArticles();
        if (cancelled) return;
        for (const article of fresh) {
          const match = article.summaries.find((s) => s.id === regenerated.id);
          if (match && match.factualityScore !== null) {
            setRegenerated({
              id: match.id,
              content: match.content,
              factualityScore: match.factualityScore,
              factualityDetails: match.factualityDetails,
              modelId: match.modelId,
            });
            queryClient.setQueryData(['user-articles'], fresh);
            return;
          }
        }
        if (pollCount < maxPolls) {
          setTimeout(tick, 5000);
        }
      } catch {
        if (pollCount < maxPolls) {
          setTimeout(tick, 5000);
        }
      }
    };

    const initial = setTimeout(tick, 5000);
    return () => {
      cancelled = true;
      clearTimeout(initial);
    };
  }, [regenerated?.id, regenerated?.factualityScore, queryClient]);

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
            <h2 className="text-lg font-semibold text-gray-900">
              {regenerated ? 'Resumo original' : 'Resumo Personalizado'}
            </h2>
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

          {displaySummary.profile && (
            <div className="mb-5 -mt-2">
              <div className="text-xs text-gray-500 mb-1.5">
                Perfil aplicado a este resumo
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="bg-blue-50 text-[#2563eb] text-xs font-medium rounded-full px-2.5 py-0.5">
                  Expertise: {displaySummary.profile.expertise}
                </span>
                <span className="bg-blue-50 text-[#2563eb] text-xs font-medium rounded-full px-2.5 py-0.5">
                  Foco: {displaySummary.profile.focus}
                </span>
                <span className="bg-blue-50 text-[#2563eb] text-xs font-medium rounded-full px-2.5 py-0.5">
                  Profundidade: {displaySummary.profile.depth}
                </span>
                <span className="bg-blue-50 text-[#2563eb] text-xs font-medium rounded-full px-2.5 py-0.5">
                  Contexto: {displaySummary.profile.context}
                </span>
                {displaySummary.profile.domain && (
                  <span className="bg-purple-50 text-purple-700 text-xs font-medium rounded-full px-2.5 py-0.5">
                    Domínio: {displaySummary.profile.domain}
                  </span>
                )}
                {displaySummary.profile.currentProject && (
                  <span className="bg-purple-50 text-purple-700 text-xs font-medium rounded-full px-2.5 py-0.5">
                    Projeto: {displaySummary.profile.currentProject}
                  </span>
                )}
              </div>
            </div>
          )}

          <FactualityHighlightedMarkdown
            content={displaySummary.content}
            factualityDetails={displaySummary.factualityDetails}
          />

          {/* Guided regeneration by factuality, attached to the primary summary card */}
          {(() => {
            const flaggedCount = displaySummary.factualityDetails
              ? displaySummary.factualityDetails.filter((d) => d.label !== 'supported').length
              : 0;
            const noFlagged = flaggedCount === 0;
            // One regen per parent: disable once a child summary exists in the
            // article (either tracked in local `regenerated` state from this
            // session, or persisted from a previous session).
            const alreadyRegenerated = regenerated !== null
              || (foundArticle ? (
                articles?.find((a) => a.id === foundArticle.id)?.summaries
                  .some((s) => s.parentSummaryId === displaySummary.id)
                ?? false
              ) : false);
            const disabled = noFlagged || regenLoading || alreadyRegenerated;
            const buttonTitle = alreadyRegenerated
              ? 'Este resumo já foi regenerado uma vez. Apenas uma regeneração por resumo é permitida.'
              : noFlagged
                ? 'Nenhuma frase deste resumo foi sinalizada como não apoiada pelo artigo.'
                : `Reprocessa o resumo usando os trechos do artigo correspondentes às ${flaggedCount} frase(s) sinalizadas.`;

            return (
              <div className="mt-5 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  onClick={handleRegenerateWithEvidence}
                  disabled={disabled}
                  title={buttonTitle}
                  className={`text-sm transition-colors ${
                    disabled
                      ? 'text-gray-400 cursor-not-allowed'
                      : 'text-[#2563eb] hover:text-[#1d4ed8] hover:underline'
                  }`}
                >
                  {regenLoading
                    ? 'Regenerando…'
                    : alreadyRegenerated
                      ? 'Já regenerado'
                      : noFlagged
                        ? 'Regenerar com foco em factualidade'
                        : `Regenerar com foco em factualidade (${flaggedCount} frase${flaggedCount === 1 ? '' : 's'} sinalizada${flaggedCount === 1 ? '' : 's'})`}
                </button>
                {regenError && (
                  <p className="mt-2 text-xs text-red-700">{regenError}</p>
                )}
              </div>
            );
          })()}
        </div>

        {/* Regenerated summary side-by-side */}
        {regenerated && (
          <div ref={regenPanelRef} className="mt-6 bg-white border-2 border-[#2563eb] rounded-lg p-8 ring-4 ring-blue-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-[#1d4ed8]">
                Resumo regenerado com evidências (nova versão)
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

        {/* Rating panel: collects Likert feedback after reading. */}
        {displaySummary?.id && (
          <SummaryRatingPanel summaryId={displaySummary.id} />
        )}
      </div>
    </div>
  );
}
