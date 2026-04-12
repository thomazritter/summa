import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';
import { ExperimentProgress } from '../../components/ExperimentProgress';

export function ExperimentSelectArticle() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
    onSuccess: (session: { id: number; phase: string }) => {
      switch (session.phase) {
        case 'comparison':
          navigate(`/experiment/trial/${session.id}`);
          break;
        case 'complete':
          // Refresh to show updated completion status
          queryClient.invalidateQueries({ queryKey: ['experiment-sessions'] });
          break;
        default:
          navigate(`/experiment/trial/${session.id}`);
      }
    },
  });

  // Redirect to /experiment when no participantId
  useEffect(() => {
    if (!participantId) {
      navigate('/experiment');
    }
  }, [participantId, navigate]);

  // Determine which articles already have sessions
  const completedArticleIds = new Set(
    (sessions ?? []).filter((s) => s.phase === 'complete').map((s) => s.articleId)
  );

  // Map article IDs to their in-progress sessions (not yet complete)
  const inProgressSessionByArticle = new Map<number, { id: number; phase: string }>();
  for (const s of sessions ?? []) {
    if (s.phase !== 'complete') {
      inProgressSessionByArticle.set(s.articleId, s);
    }
  }

  const totalArticles = articles?.length ?? 0;
  const completedCount = completedArticleIds.size;
  const allDone = totalArticles > 0 && articles!.every((a: { id: number }) => completedArticleIds.has(a.id));

  // Redirect to post-test when all articles completed
  useEffect(() => {
    if (allDone) {
      navigate('/experiment/post-test');
    }
  }, [allDone, navigate]);

  if (!participantId) {
    return null;
  }

  if (allDone) {
    return null;
  }

  // Step 2 for first article, step 3 for second
  const progressStep = completedCount === 0 ? 2 : 3;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <ExperimentProgress currentStep={progressStep} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Selecionar Artigo</h1>
        <p className="text-gray-600 mt-2">
          Escolha um artigo para avaliar. Você avaliará resumos gerados a partir deste artigo.
        </p>
        {totalArticles > 0 && (
          <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mt-3">
            {completedCount === 0
              ? `Você avaliará ${totalArticles} artigo${totalArticles > 1 ? 's' : ''} no total.`
              : `Artigo ${completedCount + 1} de ${totalArticles} — falta${totalArticles - completedCount > 1 ? 'm' : ''} ${totalArticles - completedCount} artigo${totalArticles - completedCount > 1 ? 's' : ''}.`}
          </p>
        )}
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
            const inProgress = inProgressSessionByArticle.get(article.id);

            const handleClick = () => {
              if (done) return;
              if (inProgress) {
                // Resume the existing in-progress session
                navigate(`/experiment/trial/${inProgress.id}`);
              } else {
                createSessionMutation.mutate(article.id);
              }
            };

            return (
              <button
                key={article.id}
                type="button"
                disabled={done || createSessionMutation.isPending}
                className={`w-full text-left bg-white p-4 rounded-lg border transition-colors ${
                  done
                    ? 'opacity-60 cursor-default'
                    : 'hover:border-blue-500 cursor-pointer'
                }`}
                onClick={handleClick}
                aria-label={done ? `${article.title} — concluído` : inProgress ? `Continuar: ${article.title}` : `Avaliar: ${article.title}`}
              >
                <h3 className="font-semibold text-lg">{article.title}</h3>
                {article.authors && (
                  <p className="text-sm text-gray-500 mt-1">{article.authors}</p>
                )}
                {done && (
                  <span className="inline-block mt-2 text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                    Concluído
                  </span>
                )}
                {inProgress && (
                  <span className="inline-block mt-2 text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
                    Em andamento - clique para continuar
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
