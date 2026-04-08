import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { experimentApi } from '../../api/client';
import { LikertScale } from '../../components/LikertScale';
import { ExperimentProgress } from '../../components/ExperimentProgress';

type SummaryRatings = {
  utilidade: number | null;
  clareza: number | null;
  adequacaoPerfil: number | null;
  factualidadePercebida: number | null;
};

const emptyRatings = (): SummaryRatings => ({
  utilidade: null,
  clareza: null,
  adequacaoPerfil: null,
  factualidadePercebida: null,
});

const ratingLabels: Record<keyof SummaryRatings, string> = {
  utilidade: 'Utilidade',
  clareza: 'Clareza',
  adequacaoPerfil: 'Adequação ao Perfil',
  factualidadePercebida: 'Factualidade Percebida',
};

function getMissingItems(ratingsA: SummaryRatings, ratingsB: SummaryRatings, selected: 'A' | 'B' | null): string[] {
  const missing: string[] = [];

  for (const [key, label] of Object.entries(ratingLabels)) {
    if (ratingsA[key as keyof SummaryRatings] === null) {
      missing.push(`${label} (Resumo A)`);
    }
  }
  for (const [key, label] of Object.entries(ratingLabels)) {
    if (ratingsB[key as keyof SummaryRatings] === null) {
      missing.push(`${label} (Resumo B)`);
    }
  }
  if (selected === null) {
    missing.push('Preferência');
  }

  return missing;
}

export function ExperimentTrial() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<'A' | 'B' | null>(null);
  const [ratingsA, setRatingsA] = useState<SummaryRatings>(emptyRatings());
  const [ratingsB, setRatingsB] = useState<SummaryRatings>(emptyRatings());
  const [commentA, setCommentA] = useState('');
  const [commentB, setCommentB] = useState('');
  const [preferenceReason, setPreferenceReason] = useState('');
  const [activeTab, setActiveTab] = useState<'A' | 'B'>('A');

  const participantId = sessionStorage.getItem('experimentParticipantId');


  const { data: session, isLoading } = useQuery({
    queryKey: ['experiment-session', sessionId],
    queryFn: () => experimentApi.getSession(Number(sessionId)),
    enabled: !!sessionId,
  });

  const { data: sessions } = useQuery({
    queryKey: ['experiment-sessions', participantId],
    queryFn: () => experimentApi.getParticipantSessions(Number(participantId)),
    enabled: !!participantId,
  });

  const { data: articles } = useQuery({
    queryKey: ['experiment-articles'],
    queryFn: () => experimentApi.getArticles(),
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      const summaryAId = session!.summaryA!.id;
      const summaryBId = session!.summaryB!.id;

      return experimentApi.submitRatingsAndPreference(Number(sessionId), {
        preference: selected!,
        preferenceReason,
        ratings: [
          {
            summaryId: summaryAId,
            abLabel: 'A',
            utilidade: ratingsA.utilidade!,
            clareza: ratingsA.clareza!,
            adequacaoPerfil: ratingsA.adequacaoPerfil!,
            factualidadePercebida: ratingsA.factualidadePercebida!,
            comment: commentA,
          },
          {
            summaryId: summaryBId,
            abLabel: 'B',
            utilidade: ratingsB.utilidade!,
            clareza: ratingsB.clareza!,
            adequacaoPerfil: ratingsB.adequacaoPerfil!,
            factualidadePercebida: ratingsB.factualidadePercebida!,
            comment: commentB,
          },
        ],
      });
    },
    onSuccess: () => {
      navigate(`/experiment/feedback/${sessionId}`);
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Carregando resumos...</div>;
  }

  if (!session) {
    return <div className="text-center py-8 text-red-600">Sessão não encontrada</div>;
  }

  // Determine if this is article 1 or 2 based on other sessions
  const completedCount = (sessions ?? []).filter((s) => s.id !== Number(sessionId)).length;
  const progressStep = completedCount === 0 ? 2 : 5;

  const allRated = (r: SummaryRatings) => Object.values(r).every((v) => v !== null);
  const canSubmit = selected !== null && allRated(ratingsA) && allRated(ratingsB);
  const missingItems = getMissingItems(ratingsA, ratingsB, selected);

  const article = articles?.find((a: any) => a.id === session.articleId);
  const articleTitle = article?.title;
  const articleUrl = article?.url;

  // Reusable summary + ratings block
  const renderSummaryContent = (label: 'A' | 'B') => {
    const summaryContent = label === 'A' ? session.summaryA?.content : session.summaryB?.content;
    const ratings = label === 'A' ? ratingsA : ratingsB;
    const setRatings = label === 'A' ? setRatingsA : setRatingsB;
    const comment = label === 'A' ? commentA : commentB;
    const setComment = label === 'A' ? setCommentA : setCommentB;

    return (
      <div>
        <div className="bg-white p-6 rounded-lg border-2 border-gray-200">
          <h2 className="text-lg font-bold mb-4 text-center">Resumo {label}</h2>
          <div className="prose prose-sm max-w-none text-gray-700">
            <ReactMarkdown>{summaryContent || ''}</ReactMarkdown>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg border mt-4 space-y-2">
          <h4 className="font-semibold text-gray-800 mb-3">Avalie o Resumo {label}:</h4>
          <LikertScale label="Utilidade" value={ratings.utilidade} onChange={(v) => setRatings((prev) => ({ ...prev, utilidade: v }))} lowLabel="Pouco útil" highLabel="Muito útil" />
          <LikertScale label="Clareza" value={ratings.clareza} onChange={(v) => setRatings((prev) => ({ ...prev, clareza: v }))} lowLabel="Confuso" highLabel="Muito claro" />
          <LikertScale label="Adequação ao Perfil" value={ratings.adequacaoPerfil} onChange={(v) => setRatings((prev) => ({ ...prev, adequacaoPerfil: v }))} lowLabel="Inadequado" highLabel="Adequado" />
          <LikertScale label="Factualidade Percebida" value={ratings.factualidadePercebida} onChange={(v) => setRatings((prev) => ({ ...prev, factualidadePercebida: v }))} lowLabel="Duvidoso" highLabel="Confiável" />
          <div className="mt-3">
            <label className="block mb-2 font-medium text-sm text-gray-700">
              Comentários sobre este resumo (opcional)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={3}
              className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              placeholder={`Alguma observação sobre o Resumo ${label}...`}
            />
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <ExperimentProgress currentStep={progressStep} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fase 1: Comparação de Resumos</h1>
        {articleTitle && (
          <p className="text-sm text-gray-500 mt-1">
            Artigo: <span className="font-medium text-gray-700">{articleTitle}</span>
          </p>
        )}
        <p className="text-gray-600 mt-2">
          Leia os dois resumos abaixo com atenção, avalie cada um individualmente e indique qual você prefere.
          Ambos foram gerados automaticamente a partir do mesmo artigo.
        </p>
      </div>

      {articleUrl && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex items-center justify-between">
          <div>
            <p className="font-medium text-amber-900">Leia o artigo original antes de avaliar os resumos</p>
            <p className="text-sm text-amber-700 mt-1">
              É importante ler o artigo completo para poder avaliar a qualidade dos resumos.
            </p>
          </div>
          <a
            href={articleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-4 px-4 py-2 bg-amber-600 text-white font-medium rounded-lg hover:bg-amber-700 whitespace-nowrap flex items-center gap-2 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Abrir Artigo (PDF)
          </a>
        </div>
      )}

      {/* Mobile: tab switcher */}
      <div className="md:hidden">
        <div className="flex border-b mb-4" role="tablist" aria-label="Selecionar resumo">
          <button
            role="tab"
            aria-selected={activeTab === 'A'}
            aria-controls="panel-a"
            className={`flex-1 py-2 text-center transition-colors ${
              activeTab === 'A' ? 'border-b-2 border-blue-500 font-semibold text-blue-700' : 'text-gray-500'
            }`}
            onClick={() => setActiveTab('A')}
          >
            Resumo A
          </button>
          <button
            role="tab"
            aria-selected={activeTab === 'B'}
            aria-controls="panel-b"
            className={`flex-1 py-2 text-center transition-colors ${
              activeTab === 'B' ? 'border-b-2 border-blue-500 font-semibold text-blue-700' : 'text-gray-500'
            }`}
            onClick={() => setActiveTab('B')}
          >
            Resumo B
          </button>
        </div>
        <div id="panel-a" role="tabpanel" className={activeTab === 'A' ? '' : 'hidden'}>
          {renderSummaryContent('A')}
        </div>
        <div id="panel-b" role="tabpanel" className={activeTab === 'B' ? '' : 'hidden'}>
          {renderSummaryContent('B')}
        </div>
      </div>

      {/* Desktop: side-by-side grid */}
      <div className="hidden md:grid md:grid-cols-2 gap-6">
        {renderSummaryContent('A')}
        {renderSummaryContent('B')}
      </div>

      {/* Explicit preference selection */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h3 className="text-lg font-semibold text-gray-900 text-center">Qual resumo você prefere?</h3>
        <div className="flex justify-center gap-4" role="radiogroup" aria-label="Preferência de resumo">
          <button
            type="button"
            role="radio"
            aria-checked={selected === 'A'}
            onClick={() => setSelected('A')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 font-medium transition-colors ${
              selected === 'A'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              selected === 'A' ? 'border-blue-500' : 'border-gray-300'
            }`}>
              {selected === 'A' && <span className="w-2 h-2 rounded-full bg-blue-500" />}
            </span>
            Resumo A
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={selected === 'B'}
            onClick={() => setSelected('B')}
            className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 font-medium transition-colors ${
              selected === 'B'
                ? 'border-blue-500 bg-blue-50 text-blue-700'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
            }`}
          >
            <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
              selected === 'B' ? 'border-blue-500' : 'border-gray-300'
            }`}>
              {selected === 'B' && <span className="w-2 h-2 rounded-full bg-blue-500" />}
            </span>
            Resumo B
          </button>
        </div>

        {selected && (
          <div className="mt-4">
            <label className="block mb-2 font-medium text-sm text-gray-700">
              Por que você prefere o Resumo {selected}? (opcional)
            </label>
            <textarea
              value={preferenceReason}
              onChange={(e) => setPreferenceReason(e.target.value)}
              rows={3}
              className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              placeholder="O que fez você preferir este resumo..."
            />
          </div>
        )}
      </div>

      {submitMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(submitMutation.error as Error).message}
        </div>
      )}

      <div className="space-y-2">
        <button
          onClick={() => canSubmit && submitMutation.mutate()}
          disabled={!canSubmit || submitMutation.isPending}
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitMutation.isPending ? 'Salvando...' : 'Confirmar Preferência e Continuar'}
        </button>
        {!canSubmit && missingItems.length > 0 && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Para continuar, complete: {missingItems.join(', ')}
          </p>
        )}
      </div>
    </div>
  );
}
