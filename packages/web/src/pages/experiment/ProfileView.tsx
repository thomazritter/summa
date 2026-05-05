import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';

interface DimensionConfig {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
}

const DIMENSIONS: DimensionConfig[] = [
  {
    key: 'expertise',
    label: 'Nível de expertise',
    options: [
      { value: 'beginner', label: 'Iniciante' },
      { value: 'intermediate', label: 'Intermediário' },
      { value: 'advanced', label: 'Avançado' },
      { value: 'expert', label: 'Especialista' },
    ],
  },
  {
    key: 'focus',
    label: 'Foco de leitura',
    options: [
      { value: 'concepts', label: 'Conceitos' },
      { value: 'methodology', label: 'Metodologia' },
      { value: 'results', label: 'Resultados' },
      { value: 'applications', label: 'Aplicações' },
      { value: 'all', label: 'Todos' },
    ],
  },
  {
    key: 'depth',
    label: 'Profundidade',
    options: [
      { value: 'brief', label: 'Breve' },
      { value: 'moderate', label: 'Moderado' },
      { value: 'detailed', label: 'Detalhado' },
      { value: 'comprehensive', label: 'Abrangente' },
    ],
  },
  {
    key: 'context',
    label: 'Contexto de uso',
    options: [
      { value: 'quick_review', label: 'Revisão rápida' },
      { value: 'learning', label: 'Aprendizado' },
      { value: 'research', label: 'Pesquisa' },
      { value: 'teaching', label: 'Ensino' },
    ],
  },
  {
    key: 'structure',
    label: 'Estrutura preferida',
    options: [
      { value: 'prose', label: 'Prosa corrida' },
      { value: 'bullets', label: 'Tópicos' },
      { value: 'mixed', label: 'Misto' },
    ],
  },
  {
    key: 'english_comfort',
    label: 'Termos em inglês',
    options: [
      { value: 'keep_english', label: 'Manter em inglês' },
      { value: 'translate', label: 'Traduzir' },
    ],
  },
];

const SOURCE_BADGES: Record<string, { label: string; classes: string }> = {
  questionnaire: {
    label: 'Derivado do questionário',
    classes: 'bg-blue-100 text-[#2563eb]',
  },
  manual: {
    label: 'Editado manualmente',
    classes: 'bg-amber-100 text-[#d97706]',
  },
  inferred: {
    label: 'Inferido do currículo',
    classes: 'bg-purple-100 text-purple-700',
  },
};

export function ProfileView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const participantId = sessionStorage.getItem('experimentParticipantId');

  const [selections, setSelections] = useState<Record<string, string>>({});
  const [originalValues, setOriginalValues] = useState<Record<string, string>>({});
  const [domain, setDomain] = useState('');
  const [originalDomain, setOriginalDomain] = useState('');
  const [currentProject, setCurrentProject] = useState('');
  const [originalCurrentProject, setOriginalCurrentProject] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    if (!participantId) {
      navigate('/dashboard');
    }
  }, [participantId, navigate]);

  const { data: profile, isLoading, error } = useQuery({
    queryKey: ['experiment-profile'],
    queryFn: () => experimentApi.getProfile(),
    enabled: !!participantId,
  });

  useEffect(() => {
    if (profile?.dimensions) {
      const values: Record<string, string> = {};
      for (const [key, val] of Object.entries(profile.dimensions)) {
        if (val && key !== 'domain' && key !== 'currentProject') values[key] = val;
      }
      setSelections(values);
      setOriginalValues(values);

      const profileDomain = profile.dimensions.domain || '';
      setDomain(profileDomain);
      setOriginalDomain(profileDomain);

      const profileCurrentProject = profile.dimensions.currentProject || '';
      setCurrentProject(profileCurrentProject);
      setOriginalCurrentProject(profileCurrentProject);
    }
  }, [profile]);

  const updateMutation = useMutation({
    mutationFn: (overrides: Record<string, string>) =>
      experimentApi.updateProfile(overrides),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment-profile'] });
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => experimentApi.resetProfile(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['experiment-profile'] });
      setShowResetConfirm(false);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    },
  });

  if (!participantId) {
    return null;
  }

  const hasDimensionChanges = Object.keys(selections).some(
    (key) => selections[key] !== originalValues[key]
  );
  const hasChanges =
    hasDimensionChanges ||
    domain !== originalDomain ||
    currentProject !== originalCurrentProject;

  const hasOverrides = profile?.sources
    ? Object.values(profile.sources).some((source) => source === 'manual')
    : false;

  const handleSave = () => {
    const overrides: Record<string, string> = {};
    for (const key of Object.keys(selections)) {
      if (selections[key] !== originalValues[key]) {
        overrides[key] = selections[key];
      }
    }
    if (domain !== originalDomain) {
      overrides.domain = domain;
    }
    if (currentProject !== originalCurrentProject) {
      overrides.currentProject = currentProject;
    }
    if (Object.keys(overrides).length > 0) {
      updateMutation.mutate(overrides);
    }
  };

  const handleSelect = (dimensionKey: string, value: string) => {
    setSelections((prev) => ({ ...prev, [dimensionKey]: value }));
    setShowSuccess(false);
  };

  const getSourceBadge = (source: string) => {
    const badge = SOURCE_BADGES[source] || SOURCE_BADGES.questionnaire;
    return (
      <span className={`${badge.classes} text-xs rounded-full px-3 py-1`}>
        {badge.label}
      </span>
    );
  };

  return (
    <div className="min-h-screen bg-[#f9fafb] py-12 px-6">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="text-[#2563eb] hover:text-[#1d4ed8] text-sm font-medium transition-colors"
            aria-label="Voltar ao dashboard"
          >
            &larr; Voltar ao dashboard
          </button>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 mb-2">Seu Perfil</h1>
        <p className="text-gray-600 mb-8">
          Visualize e ajuste as dimensões do seu perfil de leitura. Alterações afetarão
          os próximos resumos gerados.
        </p>

        {showSuccess && (
          <div
            className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-lg mb-6"
            role="status"
            aria-live="polite"
          >
            Perfil atualizado com sucesso.
          </div>
        )}

        {error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6" role="alert">
            Erro ao carregar perfil: {(error as Error).message}
          </div>
        )}

        {updateMutation.error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6" role="alert">
            Erro ao salvar: {(updateMutation.error as Error).message}
          </div>
        )}

        {resetMutation.error && (
          <div className="bg-red-50 text-red-700 p-4 rounded-lg mb-6" role="alert">
            Erro ao resetar: {(resetMutation.error as Error).message}
          </div>
        )}

        {isLoading && (
          <div className="text-center py-12 text-gray-500">Carregando perfil...</div>
        )}

        {profile && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {DIMENSIONS.map((dimension) => {
                const currentValue = selections[dimension.key] || '';
                const hasChanged = currentValue !== originalValues[dimension.key];
                const source = hasChanged ? 'manual' : (profile.sources[dimension.key] || 'questionnaire');

                return (
                  <div
                    key={dimension.key}
                    className="bg-white border border-gray-200 rounded-lg p-6"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <label className="text-sm font-medium text-gray-700">
                        {dimension.label}
                      </label>
                      {getSourceBadge(
                        currentValue !== originalValues[dimension.key]
                          ? 'manual'
                          : source
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {dimension.options.map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => handleSelect(dimension.key, opt.value)}
                          className={`p-3 border rounded-lg text-center text-sm transition-all ${
                            currentValue === opt.value
                              ? 'bg-blue-50 border-[#2563eb] text-[#2563eb] font-medium'
                              : 'border-gray-300 hover:border-gray-400 text-gray-700'
                          }`}
                          aria-pressed={currentValue === opt.value}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Free-text profile fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {/* Domain card */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <label
                    htmlFor="profile-domain"
                    className="text-sm font-medium text-gray-700"
                  >
                    Domínio Profissional
                  </label>
                  {getSourceBadge(
                    domain !== originalDomain
                      ? 'manual'
                      : (profile.sources.domain || 'questionnaire')
                  )}
                </div>
                <input
                  id="profile-domain"
                  type="text"
                  value={domain}
                  onChange={(e) => {
                    setDomain(e.target.value);
                    setShowSuccess(false);
                  }}
                  placeholder="Ex: Backend Engineering, Data Science, DevOps..."
                  maxLength={500}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                />
              </div>

              {/* Current Project card */}
              <div className="bg-white border border-gray-200 rounded-lg p-6">
                <div className="flex items-center justify-between mb-4">
                  <label
                    htmlFor="profile-current-project"
                    className="text-sm font-medium text-gray-700"
                  >
                    Projeto Atual
                  </label>
                  {getSourceBadge(
                    currentProject !== originalCurrentProject
                      ? 'manual'
                      : (profile.sources.currentProject || 'questionnaire')
                  )}
                </div>
                <textarea
                  id="profile-current-project"
                  value={currentProject}
                  onChange={(e) => {
                    setCurrentProject(e.target.value);
                    setShowSuccess(false);
                  }}
                  placeholder="Descreva brevemente o que você está trabalhando..."
                  maxLength={2000}
                  rows={3}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-none"
                />
                <p className="text-xs text-gray-400 text-right mt-1">
                  {currentProject.length}/2000
                </p>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handleSave}
                disabled={!hasChanges || updateMutation.isPending}
                className="py-3 px-6 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {updateMutation.isPending ? 'Salvando...' : 'Salvar'}
              </button>

              {hasOverrides && !showResetConfirm && (
                <button
                  type="button"
                  onClick={() => setShowResetConfirm(true)}
                  className="py-3 px-6 border border-gray-300 text-gray-700 font-semibold rounded-lg hover:border-gray-400 transition-colors"
                >
                  Resetar padrões
                </button>
              )}

              {showResetConfirm && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-600">Tem certeza?</span>
                  <button
                    type="button"
                    onClick={() => resetMutation.mutate()}
                    disabled={resetMutation.isPending}
                    className="py-2 px-4 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
                  >
                    {resetMutation.isPending ? 'Resetando...' : 'Confirmar'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(false)}
                    className="py-2 px-4 border border-gray-300 text-gray-700 text-sm rounded-lg hover:border-gray-400 transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
