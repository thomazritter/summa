import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';
import { LikertScale } from '../../components/LikertScale';

export function ExperimentPostTest() {
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('experimentParticipantId');

  const [overallSatisfaction, setOverallSatisfaction] = useState<number | null>(null);
  const [wouldUseAgain, setWouldUseAgain] = useState<number | null>(null);
  const [comments, setComments] = useState('');

  const submitMutation = useMutation({
    mutationFn: () =>
      experimentApi.submitPostTest({
        participantId: Number(participantId),
        overallSatisfaction: overallSatisfaction!,
        wouldUseAgain: wouldUseAgain!,
        comments,
      }),
    onSuccess: () => {
      navigate('/experiment/complete');
    },
  });

  if (!participantId) {
    navigate('/experiment');
    return null;
  }

  const canSubmit = overallSatisfaction !== null && wouldUseAgain !== null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Avaliacao Final</h1>
        <p className="text-gray-600 mt-2">
          Por favor, avalie sua experiencia geral com o sistema.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <LikertScale
          label="Satisfacao geral com os resumos"
          value={overallSatisfaction}
          onChange={setOverallSatisfaction}
          lowLabel="Insatisfeito"
          highLabel="Muito satisfeito"
        />

        <LikertScale
          label="Usaria novamente este sistema?"
          value={wouldUseAgain}
          onChange={setWouldUseAgain}
          lowLabel="Nao usaria"
          highLabel="Com certeza"
        />

        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            Comentarios adicionais (opcional)
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={4}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Compartilhe suas impressoes sobre os resumos, a interface ou sugestoes de melhoria..."
          />
        </div>
      </div>

      {submitMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(submitMutation.error as Error).message}
        </div>
      )}

      <button
        onClick={() => canSubmit && submitMutation.mutate()}
        disabled={!canSubmit || submitMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitMutation.isPending ? 'Salvando...' : 'Finalizar Experimento'}
      </button>
    </div>
  );
}
