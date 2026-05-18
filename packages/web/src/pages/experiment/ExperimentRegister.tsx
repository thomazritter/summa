import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { profileApi } from '../../api/client';
import { PROFILE_DIMENSIONS } from '../../constants/profileDimensions';

interface FormData {
  name: string;
  expertise: string;
  focus: string;
  depth: string;
  context: string;
}

const DIMENSION_HINTS: Record<string, string> = {
  expertise: 'Quanta familiaridade você tem com o tipo de artigo que vai ler?',
  focus: 'Que parte de um artigo te interessa mais?',
  depth: 'Quanto detalhe você quer ver no resumo?',
  context: 'Como você costuma usar a leitura de um artigo?',
};

export function ExperimentRegister() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormData>({
    name: '',
    expertise: '',
    focus: '',
    depth: '',
    context: '',
  });

  const registerMutation = useMutation({
    mutationFn: (data: FormData) => profileApi.registerParticipant(data),
    onSuccess: (participant) => {
      sessionStorage.setItem('experimentParticipantId', String(participant.id));
      sessionStorage.setItem('experimentParticipantName', participant.name);
      navigate('/dashboard');
    },
  });

  const isValid =
    form.name.trim().length > 0 &&
    form.expertise !== '' &&
    form.focus !== '' &&
    form.depth !== '' &&
    form.context !== '';

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
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Configure seu perfil</h1>
          <p className="text-gray-600 mb-8">
            Responda às perguntas abaixo para que os resumos sejam adaptados ao seu perfil de leitura.
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
            </div>

            {/* Profile dimensions: expertise, focus, depth, context */}
            {PROFILE_DIMENSIONS.map((dim) => (
              <div key={dim.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{dim.label}</label>
                {DIMENSION_HINTS[dim.key] && (
                  <p className="text-xs text-gray-500 mb-3">{DIMENSION_HINTS[dim.key]}</p>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {dim.options.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setForm({ ...form, [dim.key]: opt.value })}
                      className={`p-4 border rounded-lg text-left transition-all ${
                        form[dim.key as keyof FormData] === opt.value
                          ? 'bg-blue-50 border-[#2563eb]'
                          : 'border-gray-300 hover:border-gray-400'
                      }`}
                    >
                      <div className="font-medium text-gray-900">{opt.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
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
