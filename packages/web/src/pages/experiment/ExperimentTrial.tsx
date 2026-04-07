import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';
import { LikertScale } from '../../components/LikertScale';

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

export function ExperimentTrial() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<'A' | 'B' | null>(null);
  const [ratingsA, setRatingsA] = useState<SummaryRatings>(emptyRatings());
  const [ratingsB, setRatingsB] = useState<SummaryRatings>(emptyRatings());

  const { data: session, isLoading } = useQuery({
    queryKey: ['experiment-session', sessionId],
    queryFn: () => experimentApi.getSession(Number(sessionId)),
    enabled: !!sessionId,
  });

  const submitMutation = useMutation({
    mutationFn: () => {
      const summaryAId = session!.summaryA!.id;
      const summaryBId = session!.summaryB!.id;

      return experimentApi.submitRatingsAndPreference(Number(sessionId), {
        preference: selected!,
        ratings: [
          {
            summaryId: summaryAId,
            abLabel: 'A',
            utilidade: ratingsA.utilidade!,
            clareza: ratingsA.clareza!,
            adequacaoPerfil: ratingsA.adequacaoPerfil!,
            factualidadePercebida: ratingsA.factualidadePercebida!,
          },
          {
            summaryId: summaryBId,
            abLabel: 'B',
            utilidade: ratingsB.utilidade!,
            clareza: ratingsB.clareza!,
            adequacaoPerfil: ratingsB.adequacaoPerfil!,
            factualidadePercebida: ratingsB.factualidadePercebida!,
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
    return <div className="text-center py-8 text-red-600">Sessao nao encontrada</div>;
  }

  const allRated = (r: SummaryRatings) => Object.values(r).every((v) => v !== null);
  const canSubmit = selected !== null && allRated(ratingsA) && allRated(ratingsB);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Fase 1: Comparacao de Resumos</h1>
        <p className="text-gray-600 mt-2">
          Leia os dois resumos abaixo com atencao, avalie cada um individualmente e indique qual voce prefere.
          Ambos foram gerados automaticamente a partir do mesmo artigo.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Summary A */}
        <div>
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

          <div className="bg-white p-4 rounded-lg border mt-4 space-y-2">
            <h4 className="font-semibold text-gray-800 mb-3">Avalie o Resumo A:</h4>
            <LikertScale label="Utilidade" value={ratingsA.utilidade} onChange={(v) => setRatingsA((prev) => ({ ...prev, utilidade: v }))} lowLabel="Pouco util" highLabel="Muito util" />
            <LikertScale label="Clareza" value={ratingsA.clareza} onChange={(v) => setRatingsA((prev) => ({ ...prev, clareza: v }))} lowLabel="Confuso" highLabel="Muito claro" />
            <LikertScale label="Adequacao ao Perfil" value={ratingsA.adequacaoPerfil} onChange={(v) => setRatingsA((prev) => ({ ...prev, adequacaoPerfil: v }))} lowLabel="Inadequado" highLabel="Adequado" />
            <LikertScale label="Factualidade Percebida" value={ratingsA.factualidadePercebida} onChange={(v) => setRatingsA((prev) => ({ ...prev, factualidadePercebida: v }))} lowLabel="Duvidoso" highLabel="Confiavel" />
          </div>
        </div>

        {/* Summary B */}
        <div>
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

          <div className="bg-white p-4 rounded-lg border mt-4 space-y-2">
            <h4 className="font-semibold text-gray-800 mb-3">Avalie o Resumo B:</h4>
            <LikertScale label="Utilidade" value={ratingsB.utilidade} onChange={(v) => setRatingsB((prev) => ({ ...prev, utilidade: v }))} lowLabel="Pouco util" highLabel="Muito util" />
            <LikertScale label="Clareza" value={ratingsB.clareza} onChange={(v) => setRatingsB((prev) => ({ ...prev, clareza: v }))} lowLabel="Confuso" highLabel="Muito claro" />
            <LikertScale label="Adequacao ao Perfil" value={ratingsB.adequacaoPerfil} onChange={(v) => setRatingsB((prev) => ({ ...prev, adequacaoPerfil: v }))} lowLabel="Inadequado" highLabel="Adequado" />
            <LikertScale label="Factualidade Percebida" value={ratingsB.factualidadePercebida} onChange={(v) => setRatingsB((prev) => ({ ...prev, factualidadePercebida: v }))} lowLabel="Duvidoso" highLabel="Confiavel" />
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
        {submitMutation.isPending ? 'Salvando...' : 'Confirmar Preferencia e Continuar'}
      </button>
    </div>
  );
}
