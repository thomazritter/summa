import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';

export function ExperimentPostTest() {
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('experimentParticipantId');

  const [noticedDifference, setNoticedDifference] = useState('');
  const [differenceType, setDifferenceType] = useState('');
  const [wouldUseDaily, setWouldUseDaily] = useState('');
  const [improvements, setImprovements] = useState('');
  const [comments, setComments] = useState('');

  const submitMutation = useMutation({
    mutationFn: () =>
      experimentApi.submitPostTest({
        participantId: Number(participantId),
        noticedDifference,
        differenceType,
        wouldUseDaily,
        improvements,
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

  const canSubmit = noticedDifference.trim().length > 0 && wouldUseDaily.trim().length > 0;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Avaliacao Final</h1>
        <p className="text-gray-600 mt-2">
          Por favor, responda as perguntas abaixo sobre sua experiencia com o sistema.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-6">
        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            Voce percebeu diferenca entre os resumos A e B? <span className="text-red-500">*</span>
          </label>
          <textarea
            value={noticedDifference}
            onChange={(e) => setNoticedDifference(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Descreva se percebeu diferencas entre os resumos..."
          />
        </div>

        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            Se sim, qual tipo de diferenca? (opcional)
          </label>
          <textarea
            value={differenceType}
            onChange={(e) => setDifferenceType(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Ex: nivel de detalhe, linguagem, organizacao..."
          />
        </div>

        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            Voce usaria um sistema assim no dia a dia? <span className="text-red-500">*</span>
          </label>
          <textarea
            value={wouldUseDaily}
            onChange={(e) => setWouldUseDaily(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Explique se e como voce usaria o sistema..."
          />
        </div>

        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            O que melhoraria no sistema? (opcional)
          </label>
          <textarea
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Sugestoes de melhoria para o sistema..."
          />
        </div>

        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            Comentarios adicionais (opcional)
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Compartilhe suas impressoes sobre os resumos, a interface ou qualquer outro aspecto..."
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
