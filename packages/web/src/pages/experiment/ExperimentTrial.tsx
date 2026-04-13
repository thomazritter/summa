import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { experimentApi } from '../../api/client';
import { ExperimentProgress } from '../../components/ExperimentProgress';

export function ExperimentTrial() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [preference, setPreference] = useState<'A' | 'B' | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const [activeTab, setActiveTab] = useState<'A' | 'B'>('A');

  const participantId = sessionStorage.getItem('experimentParticipantId');

  // Redirect to landing if no participantId in session
  useEffect(() => {
    if (!participantId) {
      navigate('/experiment', { replace: true });
    }
  }, [participantId, navigate]);

  const { data: session, isLoading } = useQuery({
    queryKey: ['experiment-session', sessionId],
    queryFn: () => experimentApi.getSession(Number(sessionId)),
    enabled: !!sessionId,
  });

  // Phase guard: if session already complete, redirect to article selection
  useEffect(() => {
    if (session && session.phase !== 'comparison') {
      navigate('/experiment/select-article', { replace: true });
    }
  }, [session, navigate]);

  // Warn before leaving when form has unsaved data
  useEffect(() => {
    const hasData = preference !== null || rating !== null;
    if (!hasData) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [preference, rating]);

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
    mutationFn: () =>
      experimentApi.evaluateSession(Number(sessionId), {
        preference: preference!,
        rating: rating!,
        comment: comment.trim() || undefined,
      }),
    onSuccess: () => {
      navigate('/experiment/select-article');
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
  const progressStep = completedCount === 0 ? 2 : 3;

  const canSubmit = preference !== null && rating !== null;

  const article = articles?.find((a: { id: number }) => a.id === session.articleId);
  const articleTitle = article?.title;
  const articleUrl = article?.url;

  // Reusable summary block (no ratings inline)
  const renderSummary = (label: 'A' | 'B') => {
    const summaryContent = label === 'A' ? session.summaryA?.content : session.summaryB?.content;

    return (
      <div className="bg-white border border-gray-200 rounded-lg p-6">
        <h2 className="text-lg font-bold mb-4 text-gray-900">Resumo {label}</h2>
        <div className="prose prose-sm max-w-none text-gray-700">
          <ReactMarkdown>{summaryContent || ''}</ReactMarkdown>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      <ExperimentProgress currentStep={progressStep} />

      <div className="max-w-6xl mx-auto py-12 px-6">
        {articleUrl && (
          <div className="bg-amber-50 border border-[#d97706] rounded-lg p-4 mb-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-[#d97706]">Leia o artigo original antes de avaliar os resumos</p>
                <p className="text-sm text-amber-700 mt-1">
                  É importante ler o artigo completo para poder avaliar a qualidade dos resumos.
                </p>
              </div>
              <a
                href={articleUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-4 px-4 py-2 bg-[#d97706] text-white font-medium rounded-lg hover:bg-[#b45309] whitespace-nowrap flex items-center gap-2 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
                Abrir Artigo (PDF)
              </a>
            </div>
          </div>
        )}

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Avaliação de Resumos</h1>
        {articleTitle && (
          <p className="text-sm text-gray-500 mb-2">
            Artigo: <span className="font-medium text-gray-700">{articleTitle}</span>
          </p>
        )}
        <p className="text-gray-600 mb-8">
          Leia os dois resumos abaixo com atenção, escolha qual você prefere e dê uma nota.
          Ambos foram gerados a partir do mesmo artigo.
        </p>

        {/* Mobile: tab switcher */}
        <div className="md:hidden mb-8">
          <div className="flex border-b mb-4" role="tablist" aria-label="Selecionar resumo">
            <button
              role="tab"
              aria-selected={activeTab === 'A'}
              aria-controls="panel-a"
              className={`flex-1 py-2 text-center transition-colors ${
                activeTab === 'A' ? 'border-b-2 border-[#2563eb] font-semibold text-[#2563eb]' : 'text-gray-500'
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
                activeTab === 'B' ? 'border-b-2 border-[#2563eb] font-semibold text-[#2563eb]' : 'text-gray-500'
              }`}
              onClick={() => setActiveTab('B')}
            >
              Resumo B
            </button>
          </div>
          <div id="panel-a" role="tabpanel" className={activeTab === 'A' ? '' : 'hidden'}>
            {renderSummary('A')}
          </div>
          <div id="panel-b" role="tabpanel" className={activeTab === 'B' ? '' : 'hidden'}>
            {renderSummary('B')}
          </div>
        </div>

        {/* Desktop: side-by-side grid */}
        <div className="hidden md:grid md:grid-cols-2 gap-6 mb-8">
          {renderSummary('A')}
          {renderSummary('B')}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-8 space-y-8">
          {/* Preference selection */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 text-center mb-4">Qual resumo você prefere?</h3>
            <div className="flex justify-center gap-4" role="radiogroup" aria-label="Preferência de resumo">
              <button
                type="button"
                role="radio"
                aria-checked={preference === 'A'}
                onClick={() => setPreference('A')}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 font-medium transition-all ${
                  preference === 'A'
                    ? 'border-[#2563eb] bg-blue-50 text-[#2563eb]'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  preference === 'A' ? 'border-[#2563eb]' : 'border-gray-300'
                }`}>
                  {preference === 'A' && <span className="w-2 h-2 rounded-full bg-[#2563eb]" />}
                </span>
                Resumo A
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={preference === 'B'}
                onClick={() => setPreference('B')}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg border-2 font-medium transition-all ${
                  preference === 'B'
                    ? 'border-[#2563eb] bg-blue-50 text-[#2563eb]'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
                }`}
              >
                <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                  preference === 'B' ? 'border-[#2563eb]' : 'border-gray-300'
                }`}>
                  {preference === 'B' && <span className="w-2 h-2 rounded-full bg-[#2563eb]" />}
                </span>
                Resumo B
              </button>
            </div>
          </div>

          {/* Rating for preferred summary */}
          {preference && (
            <div>
              <h3 className="text-lg font-semibold text-gray-900 text-center mb-4">
                Nota para o Resumo {preference} (1-10)
              </h3>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-600">Ruim</span>
                <div className="flex gap-2 flex-1 justify-center">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      aria-label={`Nota ${n}`}
                      className={`w-10 h-10 rounded-full border transition-all ${
                        rating === n
                          ? 'bg-[#2563eb] text-white border-[#2563eb]'
                          : 'border-gray-300 text-gray-700 hover:border-gray-400'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
                <span className="text-xs text-gray-600">Excelente</span>
              </div>
            </div>
          )}

          {/* Optional comment */}
          {preference && (
            <div>
              <label htmlFor="comment" className="block font-medium text-sm text-gray-700 mb-2">
                Comentários (opcional)
              </label>
              <textarea
                id="comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-vertical"
                placeholder="Compartilhe suas observações sobre os resumos..."
              />
            </div>
          )}

          {submitMutation.error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg">
              Erro: {(submitMutation.error as Error).message}
            </div>
          )}

          <div className="space-y-2">
            <button
              type="button"
              onClick={() => canSubmit && submitMutation.mutate()}
              disabled={!canSubmit || submitMutation.isPending}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {submitMutation.isPending ? 'Salvando...' : 'Confirmar e Continuar'}
            </button>
            {!canSubmit && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-[#d97706] rounded-lg px-3 py-2">
                {preference === null && rating === null
                  ? 'Selecione qual resumo você prefere e dê uma nota para continuar.'
                  : preference === null
                    ? 'Selecione qual resumo você prefere.'
                    : 'Dê uma nota para o resumo escolhido.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
