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
    <div className="min-h-screen bg-[#f9fafb]">
      <ExperimentProgress currentStep={progressStep} />

      <div className="max-w-3xl mx-auto py-12 px-6">
        {totalArticles > 0 && (
          <div className="bg-blue-50 border border-[#2563eb] rounded-lg p-4 mb-6">
            <p className="text-[#2563eb]">
              {completedCount === 0
                ? `Você avaliará ${totalArticles} artigo${totalArticles > 1 ? 's' : ''} no total.`
                : `Artigo ${completedCount + 1} de ${totalArticles} — falta${totalArticles - completedCount > 1 ? 'm' : ''} ${totalArticles - completedCount} artigo${totalArticles - completedCount > 1 ? 's' : ''}.`}
            </p>
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">Seleção de Artigos</h1>
          <p className="mb-8 text-gray-700">
            Escolha um artigo para avaliar. Você avaliará resumos gerados a partir deste artigo.
          </p>

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
            <div className="space-y-4">
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
                    className={`w-full text-left border border-gray-300 rounded-lg p-6 transition-all ${
                      done
                        ? 'opacity-60 cursor-default'
                        : 'hover:border-[#2563eb] cursor-pointer'
                    }`}
                    onClick={handleClick}
                    aria-label={done ? `${article.title} — concluído` : inProgress ? `Continuar: ${article.title}` : `Avaliar: ${article.title}`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{article.title}</h3>
                      {done && (
                        <span className="flex-shrink-0 px-3 py-1 bg-green-100 text-[#16a34a] text-xs rounded-full">
                          Concluído
                        </span>
                      )}
                      {inProgress && (
                        <span className="flex-shrink-0 px-3 py-1 bg-amber-100 text-[#d97706] text-xs rounded-full">
                          Em andamento
                        </span>
                      )}
                    </div>
                    {article.authors && (
                      <p className="text-sm text-gray-600">{article.authors}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
