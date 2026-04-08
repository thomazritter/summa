import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { experimentApi } from '../../api/client';
import { ExperimentProgress } from '../../components/ExperimentProgress';

interface FormData {
  name: string;
  experienceLevel: string;
  yearsExperience: number;
  readingFrequency: string;
  topicFamiliarity: string;
}

export function ExperimentRegister() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>({
    name: '',
    experienceLevel: '',
    yearsExperience: 0,
    readingFrequency: '',
    topicFamiliarity: '',
  });

  const registerMutation = useMutation({
    mutationFn: (data: FormData) => experimentApi.registerParticipant(data),
    onSuccess: (participant) => {
      sessionStorage.setItem('experimentParticipantId', String(participant.id));
      sessionStorage.setItem('experimentParticipantName', participant.name);
      navigate('/experiment/select-article');
    },
  });

  const isValid =
    form.name.trim().length > 0 &&
    form.experienceLevel !== '' &&
    form.readingFrequency !== '' &&
    form.topicFamiliarity !== '';

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <ExperimentProgress currentStep={1} />

      <div>
        <h1 className="text-2xl font-bold text-gray-900">Pré-teste: Dados do Participante</h1>
        <p className="text-gray-600 mt-2">
          Preencha as informações abaixo para que possamos adequar o experimento ao seu perfil.
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nome</label>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Seu nome (pode ser anônimo)"
            className="w-full border rounded-lg p-2"
          />
        </div>

        {/* Experience Level */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Nível de experiência como desenvolvedor
          </label>
          <div className="grid grid-cols-3 gap-3">
            {[
              { value: 'junior', label: 'Júnior', desc: 'Até 2 anos de experiência' },
              { value: 'pleno', label: 'Pleno', desc: '2-5 anos de experiência' },
              { value: 'senior', label: 'Sênior', desc: '5+ anos de experiência' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setForm({ ...form, experienceLevel: opt.value })}
                className={`p-3 border rounded-lg text-left transition-colors ${
                  form.experienceLevel === opt.value
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                <div className="font-medium">{opt.label}</div>
                <div className="text-xs text-gray-500 mt-1">{opt.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Reading Frequency */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Frequência de leitura de artigos científicos
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'never', label: 'Nunca' },
              { value: 'rarely', label: 'Raramente' },
              { value: 'sometimes', label: 'Às vezes' },
              { value: 'frequently', label: 'Frequentemente' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setForm({ ...form, readingFrequency: opt.value })}
                className={`p-3 border rounded-lg text-center transition-colors ${
                  form.readingFrequency === opt.value
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Topic Familiarity */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Familiaridade com leitura de artigos científicos em computação
          </label>
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: 'none', label: 'Nenhuma' },
              { value: 'little', label: 'Pouca' },
              { value: 'moderate', label: 'Moderada' },
              { value: 'high', label: 'Alta' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => setForm({ ...form, topicFamiliarity: opt.value })}
                className={`p-3 border rounded-lg text-center transition-colors ${
                  form.topicFamiliarity === opt.value
                    ? 'border-blue-500 bg-blue-50 text-blue-900'
                    : 'border-gray-200 hover:border-blue-300'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {registerMutation.error && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">
          Erro: {(registerMutation.error as Error).message}
        </div>
      )}

      <button
        onClick={() => isValid && registerMutation.mutate(form)}
        disabled={!isValid || registerMutation.isPending}
        className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {registerMutation.isPending ? 'Registrando...' : 'Continuar'}
      </button>
    </div>
  );
}
