import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';

interface FormData {
  name: string;
  experienceLevel: string;
  yearsExperience: number;
  readingFrequency: string;
  topicFamiliarity: string;
  structurePreference: string;
  readingGoal: string;
  preferredLength: string;
  englishComfort: string;
}

export function ExperimentRegister() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>({
    name: '',
    experienceLevel: '',
    yearsExperience: 0,
    readingFrequency: '',
    topicFamiliarity: '',
    structurePreference: '',
    readingGoal: '',
    preferredLength: '',
    englishComfort: '',
  });

  const registerMutation = useMutation({
    mutationFn: (data: FormData) => experimentApi.registerParticipant(data),
    onSuccess: (participant) => {
      sessionStorage.setItem('experimentParticipantId', String(participant.id));
      sessionStorage.setItem('experimentParticipantName', participant.name);
      navigate('/dashboard');
    },
  });

  const isValid =
    form.name.trim().length > 0 &&
    form.experienceLevel !== '' &&
    form.readingFrequency !== '' &&
    form.topicFamiliarity !== '' &&
    form.structurePreference !== '' &&
    form.readingGoal !== '' &&
    form.preferredLength !== '' &&
    form.englishComfort !== '';

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      <div className="max-w-3xl mx-auto py-12 px-6">
        <div className="mb-6">
          <Link
            to="/dashboard"
            className="text-[#2563eb] hover:text-[#1d4ed8] text-sm font-medium transition-colors"
          >
            &larr; Voltar ao dashboard
          </Link>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Pré-teste: Dados do Participante</h1>
          <p className="text-gray-600 mb-8">
            Preencha as informações abaixo para que possamos adequar o experimento ao seu perfil.
          </p>

          <div className="space-y-8">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Nome</label>
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Seu nome (pode ser anônimo)"
                maxLength={255}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              />
              {form.name.length > 200 && (
                <div className="flex justify-end mt-1">
                  <span className={`text-xs ${form.name.length > 229 ? 'text-amber-600' : 'text-gray-400'}`}>
                    {form.name.length}/255
                  </span>
                </div>
              )}
            </div>

            {/* Experience Level */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Nível de experiência como desenvolvedor
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { value: 'junior', label: 'Júnior', desc: 'Até 2 anos de experiência' },
                  { value: 'pleno', label: 'Pleno', desc: '2-5 anos de experiência' },
                  { value: 'senior', label: 'Sênior', desc: '5+ anos de experiência' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, experienceLevel: opt.value })}
                    className={`p-4 border rounded-lg text-left transition-all ${
                      form.experienceLevel === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <div className="font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-600 mt-1">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* Reading Frequency */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Frequência de leitura de artigos científicos
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { value: 'never', label: 'Nunca' },
                  { value: 'rarely', label: 'Raramente' },
                  { value: 'sometimes', label: 'Às vezes' },
                  { value: 'frequently', label: 'Frequentemente' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, readingFrequency: opt.value })}
                    className={`p-4 border rounded-lg text-center transition-all ${
                      form.readingFrequency === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Topic Familiarity */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Familiaridade com leitura de artigos científicos em computação
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { value: 'none', label: 'Nenhuma' },
                  { value: 'little', label: 'Pouca' },
                  { value: 'moderate', label: 'Moderada' },
                  { value: 'high', label: 'Alta' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, topicFamiliarity: opt.value })}
                    className={`p-4 border rounded-lg text-center transition-all ${
                      form.topicFamiliarity === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Structure Preference */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Como você prefere consumir resumos?
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { value: 'prose', label: 'Prosa corrida' },
                  { value: 'bullets', label: 'Tópicos e bullet points' },
                  { value: 'mixed', label: 'Misto' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, structurePreference: opt.value })}
                    className={`p-4 border rounded-lg text-center transition-all ${
                      form.structurePreference === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Reading Goal */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Qual seu principal objetivo ao ler artigos científicos?
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { value: 'overview', label: 'Visão geral rápida' },
                  { value: 'methodology', label: 'Entender a metodologia' },
                  { value: 'results', label: 'Ver os resultados' },
                  { value: 'practical', label: 'Aplicar na prática' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, readingGoal: opt.value })}
                    className={`p-4 border rounded-lg text-center transition-all ${
                      form.readingGoal === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Preferred Length */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Quanto detalhe você prefere nos resumos?
              </label>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { value: 'brief', label: 'Breve', desc: '2-3 parágrafos' },
                  { value: 'moderate', label: 'Moderado', desc: '4-5 parágrafos' },
                  { value: 'detailed', label: 'Detalhado', desc: '6+ parágrafos' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, preferredLength: opt.value })}
                    className={`p-4 border rounded-lg text-left transition-all ${
                      form.preferredLength === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    <div className="font-medium text-gray-900">{opt.label}</div>
                    <div className="text-xs text-gray-600 mt-1">{opt.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* English Comfort */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Como prefere os termos técnicos em inglês?
              </label>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {[
                  { value: 'keep_english', label: 'Manter em inglês' },
                  { value: 'translate', label: 'Traduzir para português' },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, englishComfort: opt.value })}
                    className={`p-4 border rounded-lg text-center transition-all ${
                      form.englishComfort === opt.value
                        ? 'bg-blue-50 border-[#2563eb]'
                        : 'border-gray-300 hover:border-gray-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {registerMutation.error && (
            <div className="bg-red-50 text-red-700 p-4 rounded-lg mt-8">
              Erro: {(registerMutation.error as Error).message}
            </div>
          )}

          <button
            type="button"
            onClick={() => isValid && registerMutation.mutate(form)}
            disabled={!isValid || registerMutation.isPending}
            className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors mt-8"
          >
            {registerMutation.isPending ? 'Registrando...' : 'Continuar'}
          </button>
        </div>
      </div>
    </div>
  );
}
