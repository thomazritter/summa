import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '../api/client';
import { FactualityHighlightedMarkdown } from '../components/FactualityHighlightedMarkdown';
import type { FactualitySentence } from '../components/FactualityHighlightedMarkdown';
import { SummaryRatingPanel } from '../components/SummaryRatingPanel';

interface KeyfactAlignment {
  fact: string;
  covered: boolean;
  lineNumbers: number[];
}

interface DisplaySummary {
  id: number;
  content: string;
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
  completenessScore: number | null;
  concisenessScore: number | null;
  keyfactAlignment: KeyfactAlignment[] | null;
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
  const [highlightsOn, setHighlightsOn] = useState(true);

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
          completenessScore: match.completenessScore,
          concisenessScore: match.concisenessScore,
          keyfactAlignment: match.keyfactAlignment,
          modelId: match.modelId,
          modelLabel: match.modelLabel,
          profile: match.profile,
        };
        foundArticle = {
          id: article.id,
          title: article.title,
          authors: article.authors,
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
                <div className="relative flex items-center gap-1.5">
                  <span className={`px-3 py-1 text-xs rounded-full ${
                    displaySummary.factualityScore >= 0.8
                      ? 'bg-green-100 text-green-700'
                      : displaySummary.factualityScore >= 0.6
                      ? 'bg-amber-100 text-amber-700'
                      : 'bg-red-100 text-red-700'
                  }`}>
                    Fidelidade: {(displaySummary.factualityScore * 100).toFixed(0)}%
                  </span>
                  {displaySummary.completenessScore !== null && (
                    <span className="px-3 py-1 text-xs rounded-full bg-blue-50 text-blue-700">
                      Cobertura: {(displaySummary.completenessScore * 100).toFixed(0)}%
                    </span>
                  )}
                  {displaySummary.concisenessScore !== null && (
                    <span className="px-3 py-1 text-xs rounded-full bg-blue-50 text-blue-700">
                      Concisão: {(displaySummary.concisenessScore * 100).toFixed(0)}%
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setFactInfoOpen((v) => !v)}
                    aria-label="Como interpretar os scores de factualidade"
                    className="w-5 h-5 flex items-center justify-center rounded-full text-gray-400 hover:text-gray-700 hover:bg-gray-100 text-xs font-semibold"
                  >
                    ?
                  </button>
                  {factInfoOpen && (
                    <div
                      role="tooltip"
                      className="absolute right-0 top-full mt-2 w-96 z-20 bg-white border border-gray-200 rounded-lg shadow-lg p-4 text-xs text-gray-700 leading-relaxed"
                    >
                      <p className="font-semibold text-gray-900 mb-2">Como interpretar as três dimensões</p>
                      <p className="mb-2">
                        O verificador aplica o protocolo FineSurE, que mede três aspectos independentes
                        do resumo em relação ao artigo de origem.
                      </p>
                      <p className="mb-1.5">
                        <strong>Fidelidade</strong> é a proporção de frases sem erro factual (entidade,
                        predicado, fora de contexto e variantes). Quanto mais alta, mais consistente o
                        resumo é com o texto do artigo.
                      </p>
                      <p className="mb-1.5">
                        <strong>Cobertura</strong> é a proporção de pontos do <em>abstract</em> do
                        artigo que aparecem no resumo. Resumos mais curtos ou voltados a iniciantes
                        tendem a ter cobertura menor por desenho.
                      </p>
                      <p className="mb-2">
                        <strong>Concisão</strong> é a proporção de frases do resumo que correspondem
                        a algum ponto do <em>abstract</em>. Valores menores indicam mais contexto,
                        qualificadores ou discussão metodológica adicionados pelo modelo.
                      </p>
                      <p>
                        A avaliação pode errar em paráfrases legítimas ou em sínteses que combinam
                        trechos distantes do artigo. Use os scores como indicador, não como veredito.
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

          {displaySummary.factualityDetails && displaySummary.factualityDetails.length > 0 && (
            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={() => setHighlightsOn((v) => !v)}
                aria-pressed={highlightsOn}
                className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-full hover:border-gray-300 hover:bg-gray-50 transition-colors text-gray-600"
              >
                <span
                  className={`inline-block w-7 h-4 rounded-full relative transition-colors ${
                    highlightsOn ? 'bg-[#2563eb]' : 'bg-gray-300'
                  }`}
                  aria-hidden="true"
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      highlightsOn ? 'translate-x-3' : ''
                    }`}
                  />
                </span>
                Destaques de factualidade
              </button>
            </div>
          )}

          <FactualityHighlightedMarkdown
            content={displaySummary.content}
            factualityDetails={highlightsOn ? displaySummary.factualityDetails : null}
          />

          {displaySummary.keyfactAlignment && displaySummary.keyfactAlignment.length > 0 && (() => {
            const uncovered = displaySummary.keyfactAlignment.filter((k) => !k.covered);
            const coveredLines = new Set(
              displaySummary.keyfactAlignment.flatMap((k) => k.lineNumbers),
            );
            const lowDensity = (displaySummary.factualityDetails ?? [])
              .map((d, idx) => ({ line: idx + 1, sentence: d.sentence }))
              .filter((d) => !coveredLines.has(d.line));
            return (
              <div className="mt-8 pt-6 border-t border-gray-100 space-y-6">
                <section>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    Pontos do <em>abstract</em> não cobertos pelo resumo
                  </h3>
                  {uncovered.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      O resumo cobre todos os pontos extraídos do <em>abstract</em> do artigo.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {uncovered.map((k, i) => (
                        <li
                          key={i}
                          className="text-xs text-gray-700 flex items-start gap-2 leading-relaxed"
                        >
                          <span className="text-gray-400 mt-0.5">•</span>
                          <span>{k.fact}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">
                    Frases do resumo sem alinhamento direto ao <em>abstract</em>
                  </h3>
                  {lowDensity.length === 0 ? (
                    <p className="text-xs text-gray-500">
                      Todas as frases do resumo correspondem a algum ponto do <em>abstract</em>.
                    </p>
                  ) : (
                    <ul className="space-y-1.5">
                      {lowDensity.map((d) => (
                        <li
                          key={d.line}
                          className="text-xs text-gray-700 flex items-start gap-2 leading-relaxed"
                        >
                          <span className="text-gray-400 mt-0.5">[{d.line}]</span>
                          <span>{d.sentence}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              </div>
            );
          })()}
        </div>

        {/* Rating panel: collects Likert feedback after reading. */}
        {displaySummary?.id && (
          <SummaryRatingPanel summaryId={displaySummary.id} />
        )}
      </div>
    </div>
  );
}
