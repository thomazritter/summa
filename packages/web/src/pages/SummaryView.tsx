import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '../api/client';
import { FactualityHighlightedMarkdown } from '../components/FactualityHighlightedMarkdown';
import type { FactualitySentence } from '../components/FactualityHighlightedMarkdown';
import { SummaryRatingPanel } from '../components/SummaryRatingPanel';

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
  const [factInfoOpen, setFactInfoOpen] = useState(false);

  const summaryId = Number(id);
  const { data: articles, isLoading } = useQuery({
    queryKey: ['user-articles'],
    queryFn: () => userApi.getArticles(),
    // Poll the list endpoint while this summary's factuality score is still
    // null (background FineSurE job not finished) so the "Verificando..."
    // badge resolves on its own.
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
              {displaySummary.factualityScore !== null ? (
                <div className="relative flex items-center gap-1">
                  <span className={`px-3 py-1 text-xs rounded-full ${
                    displaySummary.factualityScore >= 0.8
                      ? 'bg-green-100 text-green-700'
                      : displaySummary.factualityScore >= 0.6
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    Factualidade: {(displaySummary.factualityScore * 100).toFixed(0)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setFactInfoOpen((v) => !v)}
                    aria-label="Como interpretar o score de factualidade"
                    className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xs font-semibold"
                  >
                    ?
                  </button>
                  {factInfoOpen && (
                    <div
                      role="tooltip"
                      className="absolute right-0 top-full mt-2 w-80 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-xs text-gray-700 leading-relaxed"
                    >
                      <p className="font-semibold text-gray-900 mb-2">Sobre o score de factualidade</p>
                      <p className="mb-2">
                        Cada frase do resumo é avaliada por um modelo de linguagem que classifica a
                        sentença em uma das categorias do protocolo FineSurE (entidade, predicado,
                        relação circunstancial, sentimento, contradição, fora do escopo, etc.) ou
                        como sem erro. O score corresponde à proporção de frases sem erro no resumo.
                      </p>
                      <p className="mb-2">
                        A avaliação pode errar, sobretudo em paráfrases legítimas, sínteses que combinam
                        trechos distantes do artigo, ou frases redigidas em português a partir de um
                        artigo em inglês.
                      </p>
                      <p>
                        Use o score como indicador de quais frases vale a pena conferir, não como
                        veredito automático sobre o resumo. Passe o cursor sobre uma frase destacada
                        para ver a categoria e a justificativa atribuídas pelo modelo.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <span className="px-3 py-1 text-xs rounded-full bg-gray-100 text-gray-600">
                  Verificando factualidade...
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
        </div>

        {/* Rating panel: collects Likert feedback after reading. */}
        {displaySummary?.id && (
          <SummaryRatingPanel summaryId={displaySummary.id} />
        )}
      </div>
    </div>
  );
}
