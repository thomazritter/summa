import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';
import { LikertScale } from '../../components/LikertScale';

export function ExperimentRegenerated() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [rating, setRating] = useState<'improved' | 'same' | 'worse' | null>(null);
  const [satisfaction, setSatisfaction] = useState<number | null>(null);

  const { data: regenerated, isLoading } = useQuery({
    queryKey: ['experiment-regenerated', sessionId],
    queryFn: () => experimentApi.getRegenerated(Number(sessionId)),
    enabled: !!sessionId,
  });

  const rateMutation = useMutation({
    mutationFn: (improvementRating: 'improved' | 'same' | 'worse') =>
      experimentApi.rateRegeneration(Number(sessionId), improvementRating, satisfaction!),
    onSuccess: () => {
      navigate('/experiment/select-article');
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Carregando...</div>;
  }

  if (!regenerated) {
    return <div className="text-center py-8 text-red-600">Resumo regenerado nao encontrado</div>;
  }

  const ratingOptions = [
    { value: 'improved' as const, label: 'Melhorou', color: 'green' },
    { value: 'same' as const, label: 'Ficou Igual', color: 'yellow' },
    { value: 'worse' as const, label: 'Piorou', color: 'red' },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Resumo Regenerado</h1>
        <p className="text-gray-600 mt-2">
          O sistema gerou uma nova versao do resumo incorporando seu feedback.
          Compare com a versao anterior e avalie se houve melhoria.
        </p>
      </div>

      <div className="bg-yellow-50 p-4 rounded-lg border border-yellow-200">
        <h3 className="font-medium text-yellow-900 mb-2">Seu feedback foi:</h3>
        <p className="text-yellow-800 italic">"{regenerated.feedbackText}"</p>
      </div>

      <div className="bg-white p-6 rounded-lg border">
        <h2 className="text-lg font-semibold mb-4">Nova Versao do Resumo</h2>
        <div className="prose max-w-none text-gray-700">
          {regenerated.summary?.content.split('\n').map((para, i) => (
            <p key={i} className="mb-3">{para}</p>
          ))}
        </div>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">O novo resumo melhorou?</h2>
        <div className="grid grid-cols-3 gap-4">
          {ratingOptions.map((opt) => (
            <button
              key={opt.value}
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

        <LikertScale
          label="Satisfacao geral com o resumo regenerado"
          value={satisfaction}
          onChange={setSatisfaction}
          lowLabel="Insatisfeito"
          highLabel="Muito satisfeito"
        />
      </div>

      {rateMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(rateMutation.error as Error).message}
        </div>
      )}

      <button
        onClick={() => rating && satisfaction !== null && rateMutation.mutate(rating)}
        disabled={!rating || satisfaction === null || rateMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {rateMutation.isPending ? 'Salvando...' : 'Continuar'}
      </button>
    </div>
  );
}
