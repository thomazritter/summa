interface ExperimentProgressProps {
  currentStep: number;
  totalSteps?: number;
}

const STEP_NAMES: Record<number, string> = {
  1: 'Cadastro',
  2: 'Artigo 1 — Avaliar resumos',
  3: 'Artigo 2 — Avaliar resumos',
  4: 'Avaliação Final',
};

export function ExperimentProgress({ currentStep, totalSteps = 4 }: ExperimentProgressProps) {
  const percentage = (currentStep / totalSteps) * 100;
  const stepName = STEP_NAMES[currentStep] ?? `Etapa ${currentStep}`;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600">
          Etapa {currentStep} de {totalSteps}
        </span>
        <span className="text-xs text-gray-500">{stepName}</span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-green-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
