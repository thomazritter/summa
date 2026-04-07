import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { experimentApi } from '../../api/client';
import { ExperimentProgress } from '../../components/ExperimentProgress';

const MIN_FEEDBACK_LENGTH = 10;

export function ExperimentFeedback() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [feedbackText, setFeedbackText] = useState('');
  const [summaryExpanded, setSummaryExpanded] = useState(false);

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

  const feedbackMutation = useMutation({
    mutationFn: (text: string) =>
      experimentApi.submitFeedback(Number(sessionId), text),
    onSuccess: () => {
      navigate(`/experiment/regenerated/${sessionId}`);
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Carregando...</div>;
  }

  if (!session) {
    return <div className="text-center py-8 text-red-600">Sessão não encontrada</div>;
  }

  // Determine if this is article 1 or 2
  const completedCount = (sessions ?? []).filter((s) => s.id !== Number(sessionId)).length;
  const progressStep = completedCount === 0 ? 3 : 6;

  // Show the personalized summary (regardless of A/B order)
  const personalizedSummary =
    session.abOrder.A === 'personalized' ? session.summaryA : session.summaryB;

  const trimmedLength = feedbackText.trim().length;
  const meetsMinimum = trimmedLength >= MIN_FEEDBACK_LENGTH;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <ExperimentProgress currentStep={progressStep} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fase 2: Feedback</h1>
        <p className="text-gray-600 mt-2">
          Abaixo está o resumo personalizado gerado para você.
          Por favor, dê seu feedback sobre o que poderia ser melhorado.
          O sistema irá gerar uma nova versão com base nos seus comentários.
        </p>
      </div>

      {/* Collapsible personalized summary for context */}
      <div className="bg-white rounded-lg border">
        <button
          type="button"
          onClick={() => setSummaryExpanded(!summaryExpanded)}
          className="w-full flex items-center justify-between p-6 text-left"
          aria-expanded={summaryExpanded}
          aria-controls="personalized-summary-content"
        >
          <h2 className="text-lg font-semibold">Resumo Personalizado</h2>
          <span className="text-gray-400 text-xl" aria-hidden="true">
            {summaryExpanded ? '−' : '+'}
          </span>
        </button>
        <div
          id="personalized-summary-content"
          className={`px-6 pb-6 ${summaryExpanded ? '' : 'hidden'}`}
        >
          <div className="prose max-w-none text-gray-700">
            <ReactMarkdown>{personalizedSummary?.content || ''}</ReactMarkdown>
          </div>
        </div>
        {!summaryExpanded && (
          <p className="px-6 pb-4 text-sm text-gray-400">
            Clique para expandir e revisar o resumo antes de dar seu feedback.
          </p>
        )}
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">Seu Feedback</h2>
        <p className="text-sm text-gray-600">
          Escreva o que você gostaria que fosse diferente neste resumo.
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <p className="text-sm font-medium text-blue-800 mb-2">Exemplos de feedback útil:</p>
          <ul className="text-sm text-blue-700 list-disc list-inside space-y-1">
            <li>&ldquo;Gostaria de mais detalhes sobre a metodologia&rdquo;</li>
            <li>&ldquo;O resumo ficou muito superficial nos resultados&rdquo;</li>
            <li>&ldquo;Prefiro uma linguagem mais técnica&rdquo;</li>
          </ul>
        </div>

        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder="Digite seu feedback aqui..."
          className="w-full border rounded-lg p-3 h-32 resize-y focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          maxLength={5000}
          aria-describedby="feedback-char-count"
        />
        <p id="feedback-char-count" className="text-xs text-gray-400">
          {meetsMinimum
            ? `${trimmedLength} caracteres`
            : `${trimmedLength}/${MIN_FEEDBACK_LENGTH} caracteres mínimos`}
        </p>
      </div>

      {feedbackMutation.isPending && (
        <div className="text-center py-4 space-y-3">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-gray-600">Regenerando resumo com seu feedback... Isso pode levar alguns minutos.</p>
        </div>
      )}

      {feedbackMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(feedbackMutation.error as Error).message}
        </div>
      )}

      <button
        onClick={() => meetsMinimum && feedbackMutation.mutate(feedbackText.trim())}
        disabled={!meetsMinimum || feedbackMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {feedbackMutation.isPending ? 'Processando...' : 'Enviar Feedback e Regenerar'}
      </button>
    </div>
  );
}
