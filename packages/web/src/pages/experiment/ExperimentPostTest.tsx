import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';
import { ExperimentProgress } from '../../components/ExperimentProgress';

const DIFFERENCE_OPTIONS = [
  { value: 'yes', label: 'Sim' },
  { value: 'no', label: 'Não' },
  { value: 'unsure', label: 'Não tenho certeza' },
] as const;

const DAILY_USE_OPTIONS = [
  { value: 'definitely_yes', label: 'Sim, com certeza' },
  { value: 'probably_yes', label: 'Provavelmente sim' },
  { value: 'maybe', label: 'Talvez' },
  { value: 'probably_no', label: 'Provavelmente não' },
  { value: 'no', label: 'Não' },
] as const;

export function ExperimentPostTest() {
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('experimentParticipantId');

  const [noticedDifference, setNoticedDifference] = useState<string | null>(null);
  const [differenceType, setDifferenceType] = useState('');
  const [wouldUseDaily, setWouldUseDaily] = useState<string | null>(null);
  const [improvements, setImprovements] = useState('');
  const [comments, setComments] = useState('');

  const submitMutation = useMutation({
    mutationFn: () =>
      experimentApi.submitPostTest({
        participantId: Number(participantId),
        noticedDifference: noticedDifference!,
        differenceType,
        wouldUseDaily: wouldUseDaily!,
        improvements,
        comments,
      }),
    onSuccess: () => {
      sessionStorage.setItem('postTestCompleted', 'true');
      navigate('/experiment/complete');
    },
  });

  if (!participantId) {
    navigate('/experiment');
    return null;
  }

  const canSubmit = noticedDifference !== null && wouldUseDaily !== null;

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <ExperimentProgress currentStep={8} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Avaliação Final</h1>
        <p className="text-gray-600 mt-2">
          Por favor, responda as perguntas abaixo sobre sua experiência com o sistema.
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Campos com <span className="text-red-500">*</span> são obrigatórios.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-6">
        {/* Question 1: Noticed difference — radio */}
        <fieldset>
          <legend className="block mb-3 font-medium text-sm text-gray-700">
            Você percebeu diferença entre os resumos A e B? <span className="text-red-500">*</span>
          </legend>
          <div className="space-y-2" role="radiogroup" aria-label="Você percebeu diferença entre os resumos A e B?">
            {DIFFERENCE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  noticedDifference === opt.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="noticedDifference"
                  value={opt.value}
                  checked={noticedDifference === opt.value}
                  onChange={() => setNoticedDifference(opt.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Question 2: Type of difference — conditional, shown only if Q1 = yes */}
        {noticedDifference === 'yes' && (
          <div>
            <label className="block mb-2 font-medium text-sm text-gray-700">
              Se sim, qual tipo de diferença? (opcional)
            </label>
            <textarea
              value={differenceType}
              onChange={(e) => setDifferenceType(e.target.value)}
              rows={3}
              className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
              placeholder="Ex: nível de detalhe, linguagem, organização..."
            />
          </div>
        )}

        {/* Question 3: Would use daily — radio */}
        <fieldset>
          <legend className="block mb-3 font-medium text-sm text-gray-700">
            Você usaria um sistema assim no dia a dia? <span className="text-red-500">*</span>
          </legend>
          <div className="space-y-2" role="radiogroup" aria-label="Você usaria um sistema assim no dia a dia?">
            {DAILY_USE_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-center gap-3 p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                  wouldUseDaily === opt.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <input
                  type="radio"
                  name="wouldUseDaily"
                  value={opt.value}
                  checked={wouldUseDaily === opt.value}
                  onChange={() => setWouldUseDaily(opt.value)}
                  className="w-4 h-4 text-blue-600"
                />
                <span className="text-gray-700">{opt.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Question 4: Improvements — textarea */}
        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            O que melhoraria no sistema? (opcional)
          </label>
          <textarea
            value={improvements}
            onChange={(e) => setImprovements(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Sugestões de melhoria para o sistema..."
          />
        </div>

        {/* Question 5: Additional comments — textarea */}
        <div>
          <label className="block mb-2 font-medium text-sm text-gray-700">
            Comentários adicionais (opcional)
          </label>
          <textarea
            value={comments}
            onChange={(e) => setComments(e.target.value)}
            rows={3}
            className="w-full p-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            placeholder="Compartilhe suas impressões sobre os resumos, a interface ou qualquer outro aspecto..."
          />
        </div>
      </div>

      {submitMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(submitMutation.error as Error).message}
        </div>
      )}

      <button
        type="button"
        onClick={() => canSubmit && submitMutation.mutate()}
        disabled={!canSubmit || submitMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {submitMutation.isPending ? 'Salvando...' : 'Finalizar Experimento'}
      </button>
    </div>
  );
}
