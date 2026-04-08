import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { experimentApi } from '../../api/client';
import { LikertScale } from '../../components/LikertScale';
import { ExperimentProgress } from '../../components/ExperimentProgress';

export function ExperimentRegenerated() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('experimentParticipantId');
  const [rating, setRating] = useState<'improved' | 'same' | 'worse' | null>(null);
  const [utilityRating, setUtilityRating] = useState<number | null>(null);
  const [clarityRating, setClarityRating] = useState<number | null>(null);
  const [adequacyRating, setAdequacyRating] = useState<number | null>(null);
  const [changeDescription, setChangeDescription] = useState('');
  const [originalExpanded, setOriginalExpanded] = useState(false);

  const { data: regenerated, isLoading: loadingRegenerated } = useQuery({
    queryKey: ['experiment-regenerated', sessionId],
    queryFn: () => experimentApi.getRegenerated(Number(sessionId)),
    enabled: !!sessionId,
  });

  const { data: session, isLoading: loadingSession } = useQuery({
    queryKey: ['experiment-session', sessionId],
    queryFn: () => experimentApi.getSession(Number(sessionId)),
    enabled: !!sessionId,
  });

  // Phase guard: redirect if session is not in regenerated phase
  useEffect(() => {
    if (session && session.phase === 'comparison') {
      navigate(`/experiment/trial/${sessionId}`, { replace: true });
    }
    if (session && session.phase === 'feedback') {
      navigate(`/experiment/feedback/${sessionId}`, { replace: true });
    }
    if (session && session.phase === 'complete') {
      navigate('/experiment/select-article', { replace: true });
    }
  }, [session, sessionId, navigate]);

  // Warn before leaving when form has unsaved data
  useEffect(() => {
    const hasData = rating !== null || utilityRating !== null || clarityRating !== null || adequacyRating !== null;
    if (!hasData) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [rating, utilityRating, clarityRating, adequacyRating]);

  const { data: articles } = useQuery({
    queryKey: ['experiment-articles'],
    queryFn: () => experimentApi.getArticles(),
  });

  const { data: sessions } = useQuery({
    queryKey: ['experiment-sessions', participantId],
    queryFn: () => experimentApi.getParticipantSessions(Number(participantId)),
    enabled: !!participantId,
  });

  const rateMutation = useMutation({
    mutationFn: () =>
      experimentApi.rateRegeneration(Number(sessionId), {
        improvementRating: rating!,
        utilityRating: utilityRating!,
        clarityRating: clarityRating!,
        adequacyRating: adequacyRating!,
        changeDescription,
      }),
    onSuccess: () => {
      navigate('/experiment/select-article');
    },
  });

  const isLoading = loadingRegenerated || loadingSession;

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Carregando...</div>;
  }

  if (!regenerated) {
    return <div className="text-center py-8 text-red-600">Resumo regenerado não encontrado</div>;
  }

  // Get original personalized summary from the session
  const originalPersonalizedSummary = session
    ? session.abOrder.A === 'personalized'
      ? session.summaryA
      : session.summaryB
    : null;

  // Determine if this is the last article
  const totalArticles = articles?.length ?? 0;
  const completedArticleIds = new Set(
    (sessions ?? []).map((s) => s.articleId)
  );
  // Current session's article counts as about-to-be-completed
  if (session) {
    completedArticleIds.add(session.articleId);
  }
  const isLastArticle = totalArticles > 0 && completedArticleIds.size >= totalArticles;

  // Determine if this is article 1 or 2 for progress
  const otherSessionsCount = (sessions ?? []).filter((s) => s.id !== Number(sessionId)).length;
  const progressStep = otherSessionsCount === 0 ? 4 : 7;

  const ratingOptions = [
    { value: 'improved' as const, label: 'Melhorou', color: 'green' },
    { value: 'same' as const, label: 'Ficou Igual', color: 'yellow' },
    { value: 'worse' as const, label: 'Piorou', color: 'red' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <ExperimentProgress currentStep={progressStep} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Resumo Regenerado</h1>
        <p className="text-gray-600 mt-2">
          O sistema gerou uma nova versão do resumo incorporando seu feedback.
          Compare com a versão anterior e avalie se houve melhoria.
        </p>
      </div>

      <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
        <h3 className="font-medium text-yellow-900 mb-2">Seu feedback foi:</h3>
        <p className="text-yellow-800 italic">&ldquo;{regenerated.feedbackText}&rdquo;</p>
      </div>

      {/* Original summary — collapsible */}
      {originalPersonalizedSummary && (
        <div className="bg-white rounded-lg border border-gray-300">
          <button
            type="button"
            onClick={() => setOriginalExpanded(!originalExpanded)}
            className="w-full flex items-center justify-between p-4 text-left"
            aria-expanded={originalExpanded}
            aria-controls="original-summary-content"
          >
            <h2 className="text-lg font-semibold text-gray-700">Versão Original</h2>
            <span className="text-gray-400 text-xl" aria-hidden="true">
              {originalExpanded ? '▲' : '▼'}
            </span>
          </button>
          {originalExpanded && (
            <div id="original-summary-content" className="px-6 pb-6 border-t border-gray-200 pt-4">
              <div className="prose max-w-none text-gray-600">
                <ReactMarkdown>{originalPersonalizedSummary.content}</ReactMarkdown>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Regenerated summary */}
      <div className="bg-white p-6 rounded-lg border-2 border-blue-300">
        <h2 className="text-lg font-semibold mb-4 text-blue-900">Versão Regenerada</h2>
        <div className="prose max-w-none text-gray-700">
          <ReactMarkdown>{regenerated.summary?.content || ''}</ReactMarkdown>
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">Avalie o resumo regenerado abaixo:</h2>

        <div>
          <h3 className="font-medium text-gray-700 mb-3">O novo resumo melhorou?</h3>
          <div className="grid grid-cols-3 gap-4">
            {ratingOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRating(opt.value)}
                className={`p-4 border-2 rounded-lg text-center font-medium transition-colors ${
                  rating === opt.value
                    ? opt.color === 'green'
                      ? 'border-green-500 bg-green-50 text-green-900'
                      : opt.color === 'yellow'
                      ? 'border-yellow-500 bg-yellow-50 text-yellow-900'
                      : 'border-red-500 bg-red-50 text-red-900'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <LikertScale
          label="Utilidade da nova versão — O resumo me ajudou a entender o artigo?"
          value={utilityRating}
          onChange={setUtilityRating}
          lowLabel="Pouco útil"
          highLabel="Muito útil"
        />
        <LikertScale
          label="Clareza da nova versão — O texto está claro e bem organizado?"
          value={clarityRating}
          onChange={setClarityRating}
          lowLabel="Confuso"
          highLabel="Muito claro"
        />
        <LikertScale
          label="Adequação da nova versão — O nível de detalhe e linguagem são adequados pra mim?"
          value={adequacyRating}
          onChange={setAdequacyRating}
          lowLabel="Inadequado"
          highLabel="Adequado"
        />

        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            O que mudou em relação ao resumo anterior? (opcional)
          </label>
          <textarea
            value={changeDescription}
            onChange={(e) => setChangeDescription(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Descreva as diferenças que você percebeu..."
          />
        </div>
      </div>

      {rateMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(rateMutation.error as Error).message}
        </div>
      )}

      <button
        type="button"
        onClick={() => rateMutation.mutate()}
        disabled={!rating || utilityRating === null || clarityRating === null || adequacyRating === null || rateMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {rateMutation.isPending
          ? 'Salvando...'
          : isLastArticle
          ? 'Continuar para avaliação final'
          : 'Continuar para o próximo artigo'}
      </button>
    </div>
  );
}
