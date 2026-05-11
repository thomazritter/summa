import { useState, useEffect } from 'react';
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

  // Guard: if post-test already completed, redirect to complete page
  useEffect(() => {
    if (sessionStorage.getItem('postTestCompleted') === 'true') {
      navigate('/experiment/complete', { replace: true });
    }
  }, [navigate]);

  // Warn before leaving when form has unsaved data
  useEffect(() => {
    const hasData = noticedDifference !== null || wouldUseDaily !== null || improvements.trim() !== '' || comments.trim() !== '';
    if (!hasData) return;

    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [noticedDifference, wouldUseDaily, improvements, comments]);

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
    <div className="min-h-screen bg-[#f9fafb]">
      <ExperimentProgress currentStep={4} />

      <div className="max-w-3xl mx-auto py-12 px-6">
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Questionário Pós-Teste</h1>
          <p className="text-gray-600 mb-2">
            Por favor, responda as perguntas abaixo sobre sua experiência com o sistema.
          </p>
          <p className="text-sm text-gray-500 mb-8">
            Campos com <span className="text-red-500">*</span> são obrigatórios.
          </p>

          <div className="space-y-8">
            {/* Question 1: Noticed difference — radio */}
            <fieldset>
              <legend className="block mb-4 font-medium text-sm text-gray-700">
                Você percebeu diferença entre os resumos A e B? <span className="text-red-500">*</span>
              </legend>
              <div className="space-y-3" role="radiogroup" aria-label="Você percebeu diferença entre os resumos A e B?">
                {DIFFERENCE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                      noticedDifference === opt.value
                        ? 'border-[#2563eb] bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
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
                  rows={4}
                  maxLength={5000}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-vertical"
                  placeholder="Descreva as diferenças que você percebeu..."
                />
                {differenceType.length > 0 && (
                  <div className="flex justify-end mt-1">
                    <span className={`text-xs ${differenceType.length >= 5000 ? 'text-red-600' : differenceType.length > 4500 ? 'text-amber-600' : 'text-gray-400'}`}>
                      {differenceType.length}/5000
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Question 3: Would use daily — radio */}
            <fieldset>
              <legend className="block mb-4 font-medium text-sm text-gray-700">
                Resumos adaptados ao seu perfil seriam úteis na sua rotina de leitura? <span className="text-red-500">*</span>
              </legend>
              <div className="space-y-3" role="radiogroup" aria-label="Resumos adaptados ao seu perfil seriam úteis na sua rotina de leitura?">
                {DAILY_USE_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className={`flex items-center gap-3 p-4 rounded-lg border cursor-pointer transition-all ${
                      wouldUseDaily === opt.value
                        ? 'border-[#2563eb] bg-blue-50'
                        : 'border-gray-300 hover:border-gray-400'
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
                rows={4}
                maxLength={5000}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-vertical"
                placeholder="Sugestões de melhoria para o sistema..."
              />
              {improvements.length > 0 && (
                <div className="flex justify-end mt-1">
                  <span className={`text-xs ${improvements.length >= 5000 ? 'text-red-600' : improvements.length > 4500 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {improvements.length}/5000
                  </span>
                </div>
              )}
            </div>

            {/* Question 5: Additional comments — textarea */}
            <div>
              <label className="block mb-2 font-medium text-sm text-gray-700">
                Comentários adicionais (opcional)
              </label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                rows={4}
                maxLength={5000}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-[#2563eb] resize-vertical"
                placeholder="Compartilhe suas impressões sobre os resumos, a interface ou qualquer outro aspecto..."
              />
              {comments.length > 0 && (
                <div className="flex justify-end mt-1">
                  <span className={`text-xs ${comments.length >= 5000 ? 'text-red-600' : comments.length > 4500 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {comments.length}/5000
                  </span>
                </div>
              )}
            </div>
          </div>

          {submitMutation.error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg mt-8">
              Erro: {(submitMutation.error as Error).message}
            </div>
          )}

          <button
            type="button"
            onClick={() => canSubmit && submitMutation.mutate()}
            disabled={!canSubmit || submitMutation.isPending}
            className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-8"
          >
            {submitMutation.isPending ? 'Salvando...' : 'Finalizar'}
          </button>
        </div>
      </div>
    </div>
  );
}
