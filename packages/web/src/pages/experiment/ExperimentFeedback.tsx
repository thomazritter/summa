import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';

export function ExperimentFeedback() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [feedbackText, setFeedbackText] = useState('');

  const { data: session, isLoading } = useQuery({
    queryKey: ['experiment-session', sessionId],
    queryFn: () => experimentApi.getSession(Number(sessionId)),
    enabled: !!sessionId,
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
    return <div className="text-center py-8 text-red-600">Sessao nao encontrada</div>;
  }

  // Show the personalized summary (regardless of A/B order)
  const personalizedSummary =
    session.abOrder.A === 'personalized' ? session.summaryA : session.summaryB;

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fase 2: Feedback</h1>
        <p className="text-gray-600 mt-2">
          Abaixo esta o resumo personalizado gerado para voce.
          Por favor, de seu feedback sobre o que poderia ser melhorado.
          O sistema ira gerar uma nova versao com base nos seus comentarios.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border">
        <h2 className="text-lg font-semibold mb-4">Resumo Personalizado</h2>
        <div className="prose max-w-none text-gray-700">
          {personalizedSummary?.content.split('\n').map((para, i) => (
            <p key={i} className="mb-3">{para}</p>
          ))}
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">Seu Feedback</h2>
        <p className="text-sm text-gray-600">
          Escreva o que voce gostaria que fosse diferente neste resumo.
          Exemplos: "queria mais foco em X", "ficou superficial na parte Y",
          "a linguagem poderia ser mais acessivel".
        </p>
        <textarea
          value={feedbackText}
          onChange={(e) => setFeedbackText(e.target.value)}
          placeholder="Digite seu feedback aqui..."
          className="w-full border rounded-lg p-3 h-32 resize-y"
          maxLength={5000}
        />
        <p className="text-xs text-gray-400">{feedbackText.length}/5000</p>
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
        onClick={() => feedbackText.trim() && feedbackMutation.mutate(feedbackText.trim())}
        disabled={!feedbackText.trim() || feedbackMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {feedbackMutation.isPending ? 'Processando...' : 'Enviar Feedback e Regenerar'}
      </button>
    </div>
  );
}
