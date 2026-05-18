export interface DimensionOption {
  value: string;
  label: string;
}

export interface DimensionConfig {
  key: string;
  label: string;
  options: DimensionOption[];
}

export const PROFILE_DIMENSIONS: DimensionConfig[] = [
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
];

