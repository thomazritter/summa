import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';

export function ExperimentSelectArticle() {
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('experimentParticipantId');

  const { data: articles, isLoading: loadingArticles } = useQuery({
    queryKey: ['experiment-articles'],
    queryFn: () => experimentApi.getArticles(),
  });

  const { data: sessions } = useQuery({
    queryKey: ['experiment-sessions', participantId],
    queryFn: () => experimentApi.getParticipantSessions(Number(participantId)),
    enabled: !!participantId,
  });

  const createSessionMutation = useMutation({
    mutationFn: (articleId: number) =>
      experimentApi.createSession(Number(participantId), articleId),
    onSuccess: (session) => {
      navigate(`/experiment/trial/${session.id}`);
    },
  });

  if (!participantId) {
    navigate('/experiment');
    return null;
  }

  // Determine which articles already have sessions
  const completedArticleIds = new Set(
    (sessions ?? []).map((s) => s.articleId)
  );

  const allDone = articles && articles.length > 0 && articles.every((a) => completedArticleIds.has(a.id));

  if (allDone) {
    navigate('/experiment/complete');
    return null;
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Selecionar Artigo</h1>
        <p className="text-gray-600 mt-2">
          Escolha um artigo para avaliar. Voce avaliara resumos gerados a partir deste artigo.
        </p>
      </div>

      {loadingArticles && <div className="text-center py-8 text-gray-500">Carregando artigos...</div>}

      {createSessionMutation.isPending && (
        <div className="text-center py-8 space-y-3">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto"></div>
          <p className="text-gray-600">Gerando resumos... Isso pode levar alguns minutos.</p>
        </div>
      )}

      {createSessionMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(createSessionMutation.error as Error).message}
        </div>
      )}

      {!createSessionMutation.isPending && (
        <div className="grid gap-4">
          {articles?.map((article) => {
            const done = completedArticleIds.has(article.id);
            return (
              <div
                key={article.id}
                className={`bg-white p-4 rounded-lg border ${
                  done
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:border-blue-500 cursor-pointer'
                }`}
                onClick={() => !done && createSessionMutation.mutate(article.id)}
              >
                <h3 className="font-semibold text-lg">{article.title}</h3>
                {article.authors && (
                  <p className="text-sm text-gray-500 mt-1">{article.authors}</p>
                )}
                {done && (
                  <span className="inline-block mt-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Concluido
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
