import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { userApi } from '../api/client';
import { LikertScale } from './LikertScale';

interface Props {
  summaryId: number;
}

const DIMENSIONS = [
  {
    key: 'utilidade' as const,
    label: 'Utilidade',
    description: 'O resumo foi útil para entender o artigo?',
    lowLabel: 'Pouco útil',
    highLabel: 'Muito útil',
  },
  {
    key: 'clareza' as const,
    label: 'Clareza',
    description: 'O resumo está escrito de forma clara?',
    lowLabel: 'Confuso',
    highLabel: 'Muito claro',
  },
  {
    key: 'adequacao_perfil' as const,
    label: 'Adequação ao seu perfil',
    description: 'O nível e o foco do resumo bateram com seu perfil?',
    lowLabel: 'Desalinhado',
    highLabel: 'Alinhado',
  },
  {
    key: 'factualidade_percebida' as const,
    label: 'Factualidade percebida',
    description: 'O resumo parece fiel ao conteúdo do artigo?',
    lowLabel: 'Pouco fiel',
    highLabel: 'Muito fiel',
  },
];

export function SummaryRatingPanel({ summaryId }: Props) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['summary-rating', summaryId],
    queryFn: () => userApi.getRating(summaryId),
  });

  const existing = data?.rating ?? null;

  const [scores, setScores] = useState<{
    utilidade: number | null;
    clareza: number | null;
    adequacao_perfil: number | null;
    factualidade_percebida: number | null;
  }>({
    utilidade: null,
    clareza: null,
    adequacao_perfil: null,
    factualidade_percebida: null,
  });
  const [comment, setComment] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      if (
        scores.utilidade === null
        || scores.clareza === null
        || scores.adequacao_perfil === null
        || scores.factualidade_percebida === null
      ) {
        throw new Error('Avalie todas as dimensões antes de enviar.');
      }
      return userApi.rateSummary(summaryId, {
        utilidade: scores.utilidade,
        clareza: scores.clareza,
        adequacao_perfil: scores.adequacao_perfil,
        factualidade_percebida: scores.factualidade_percebida,
        comment: comment.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['summary-rating', summaryId] });
    },
  });

  if (isLoading) {
    return null;
  }

  if (existing) {
    return (
      <div className="mt-8 p-5 bg-emerald-50 border border-emerald-200 rounded-lg">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-emerald-900">
            Avaliação enviada
          </h3>
          <span className="text-xs text-emerald-700">
            {new Date(existing.createdAt).toLocaleDateString('pt-BR')}
          </span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm text-emerald-900">
          {DIMENSIONS.map((d) => (
            <div key={d.key}>
              <div className="text-xs text-emerald-700">{d.label}</div>
              <div className="text-lg font-semibold">{existing[d.key]} / 5</div>
            </div>
          ))}
        </div>
        {existing.comment && (
          <div className="mt-3 pt-3 border-t border-emerald-200">
            <div className="text-xs text-emerald-700 mb-1">Seu comentário</div>
            <p className="text-sm text-emerald-900 italic">"{existing.comment}"</p>
          </div>
        )}
      </div>
    );
  }

  const canSubmit =
    scores.utilidade !== null
    && scores.clareza !== null
    && scores.adequacao_perfil !== null
    && scores.factualidade_percebida !== null
    && !mutation.isPending;

  return (
    <div className="mt-8 p-5 bg-white border border-gray-200 rounded-lg">
      <h3 className="text-base font-semibold text-gray-900 mb-1">
        Avaliar este resumo
      </h3>
      <p className="text-sm text-gray-600 mb-5">
        Avalie cada dimensão em uma escala de 1 a 5. Sua resposta é opcional e
        ajuda a refinar a personalização em versões futuras do sistema.
      </p>

      <div className="space-y-2">
        {DIMENSIONS.map((d) => (
          <div key={d.key}>
            <p className="text-xs text-gray-500 mb-1">{d.description}</p>
            <LikertScale
              label={d.label}
              value={scores[d.key]}
              onChange={(v) => setScores((s) => ({ ...s, [d.key]: v }))}
              lowLabel={d.lowLabel}
              highLabel={d.highLabel}
            />
          </div>
        ))}
      </div>

      <div className="mt-4">
        <label className="block mb-2 font-medium text-sm text-gray-700">
          Comentário (opcional)
        </label>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="O que motivou suas notas? O que mudaria?"
          className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-blue-500"
        />
        <div className="text-xs text-gray-400 text-right mt-1">
          {comment.length} / 2000
        </div>
      </div>

      {mutation.isError && (
        <p className="text-sm text-red-600 mt-3">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Erro ao enviar avaliação.'}
        </p>
      )}

      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={!canSubmit}
        className="mt-4 py-2.5 px-5 bg-[#2563eb] text-white font-medium text-sm rounded-lg hover:bg-[#1d4ed8] disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
      >
        {mutation.isPending ? 'Enviando…' : 'Enviar avaliação'}
      </button>
    </div>
  );
}
