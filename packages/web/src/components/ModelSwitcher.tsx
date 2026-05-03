import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { userApi } from '../api/client';
import type { SummaryResult } from '../api/client';

interface ModelSwitcherProps {
  articleId: number;
  currentModelId: string | null;
  onNewSummary: (summary: SummaryResult) => void;
}

export function ModelSwitcher({ articleId, currentModelId, onNewSummary }: ModelSwitcherProps) {
  const [selectedModelId, setSelectedModelId] = useState('');

  const {
    data: models,
    isLoading: modelsLoading,
    error: modelsError,
  } = useQuery({
    queryKey: ['available-models'],
    queryFn: () => userApi.getModels(),
    staleTime: 5 * 60 * 1000,
  });

  const generateMutation = useMutation({
    mutationFn: (modelId: string) => userApi.summarize(articleId, modelId),
    onSuccess: (data) => {
      onNewSummary(data);
      setSelectedModelId('');
    },
  });

  const isCurrentModel = selectedModelId === currentModelId;
  const canGenerate = selectedModelId !== '' && !isCurrentModel && !generateMutation.isPending;

  return (
    <section
      className="bg-gray-50 border border-gray-200 rounded-lg p-6 mt-6"
      aria-labelledby={`model-switcher-heading-${articleId}`}
    >
      <h3
        id={`model-switcher-heading-${articleId}`}
        className="text-sm font-semibold text-gray-700 mb-3"
      >
        Tentar outro modelo
      </h3>

      {modelsLoading && (
        <p className="text-sm text-gray-500">Carregando modelos...</p>
      )}

      {modelsError && (
        <p className="text-sm text-red-600" role="alert">
          Erro ao carregar modelos: {(modelsError as Error).message}
        </p>
      )}

      {models && (
        <div className="space-y-4">
          <div>
            <label htmlFor={`model-select-${articleId}`} className="sr-only">
              Selecione um modelo
            </label>
            <select
              id={`model-select-${articleId}`}
              value={selectedModelId}
              onChange={(e) => setSelectedModelId(e.target.value)}
              disabled={generateMutation.isPending}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-white text-gray-900 focus:ring-2 focus:ring-[#2563eb] focus:border-[#2563eb] focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">Selecione um modelo</option>
              {models.map((model) => (
                <option
                  key={model.id}
                  value={model.id}
                  disabled={model.id === currentModelId}
                >
                  {model.name} — {model.description}
                  {model.id === currentModelId ? ' (modelo atual)' : ''}
                </option>
              ))}
            </select>
          </div>

          {isCurrentModel && (
            <p className="text-xs text-amber-600">
              Este ja e o modelo utilizado no resumo atual.
            </p>
          )}

          <button
            type="button"
            onClick={() => generateMutation.mutate(selectedModelId)}
            disabled={!canGenerate}
            className="px-6 py-3 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            aria-busy={generateMutation.isPending}
          >
            {generateMutation.isPending ? 'Gerando...' : 'Gerar com este modelo'}
          </button>

          {generateMutation.isError && (
            <p className="text-sm text-red-600" role="alert">
              Erro ao gerar resumo: {(generateMutation.error as Error).message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
