import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';

export function ExperimentTrial() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<'A' | 'B' | null>(null);

  const { data: session, isLoading } = useQuery({
    queryKey: ['experiment-session', sessionId],
    queryFn: () => experimentApi.getSession(Number(sessionId)),
    enabled: !!sessionId,
  });

  const preferenceMutation = useMutation({
    mutationFn: (preference: 'A' | 'B') =>
      experimentApi.recordPreference(Number(sessionId), preference),
    onSuccess: () => {
      navigate(`/experiment/feedback/${sessionId}`);
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-gray-500">Carregando resumos...</div>;
  }

  if (!session) {
    return <div className="text-center py-8 text-red-600">Sessao nao encontrada</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fase 1: Comparacao de Resumos</h1>
        <p className="text-gray-600 mt-2">
          Leia os dois resumos abaixo com atencao e indique qual voce prefere.
          Ambos foram gerados automaticamente a partir do mesmo artigo.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Summary A */}
        <div
          className={`bg-white p-6 rounded-lg border-2 transition-colors cursor-pointer ${
            selected === 'A' ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'
          }`}
          onClick={() => setSelected('A')}
        >
          <h2 className="text-lg font-bold mb-4 text-center">Resumo A</h2>
          <div className="prose prose-sm max-w-none text-gray-700">
            {session.summaryA?.content.split('\n').map((para, i) => (
              <p key={i} className="mb-3">{para}</p>
            ))}
          </div>
        </div>

        {/* Summary B */}
        <div
          className={`bg-white p-6 rounded-lg border-2 transition-colors cursor-pointer ${
            selected === 'B' ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200 hover:border-blue-300'
          }`}
          onClick={() => setSelected('B')}
        >
          <h2 className="text-lg font-bold mb-4 text-center">Resumo B</h2>
          <div className="prose prose-sm max-w-none text-gray-700">
            {session.summaryB?.content.split('\n').map((para, i) => (
              <p key={i} className="mb-3">{para}</p>
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <div className="bg-blue-50 p-4 rounded-lg border border-blue-200 text-center">
          <p className="text-blue-900 font-medium">
            Voce selecionou: <strong>Resumo {selected}</strong>
          </p>
        </div>
      )}

      {preferenceMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(preferenceMutation.error as Error).message}
        </div>
      )}

      <button
        onClick={() => selected && preferenceMutation.mutate(selected)}
        disabled={!selected || preferenceMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {preferenceMutation.isPending ? 'Salvando...' : 'Confirmar Preferencia e Continuar'}
      </button>
    </div>
  );
}
