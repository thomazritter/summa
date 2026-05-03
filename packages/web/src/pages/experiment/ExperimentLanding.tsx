import { useNavigate, Link } from 'react-router-dom';

export function ExperimentLanding() {
  const navigate = useNavigate();
  const participantId = sessionStorage.getItem('experimentParticipantId');

  return (
    <div className="min-h-screen bg-[#f9fafb] py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-6">
            Experimento: Resumos Personalizados de Artigos Científicos
          </h1>
          <p className="mb-6 text-gray-700">
            Você participará de um estudo que avalia a qualidade de resumos personalizados de artigos científicos.
          </p>

          <div className="mb-6">
            <h2 className="text-lg font-semibold mb-4">Como funciona:</h2>
            <ol className="space-y-3">
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-[#2563eb] text-white rounded-full flex items-center justify-center text-sm">
                  1
                </span>
                <span className="text-gray-700">Responda algumas perguntas sobre seu perfil</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-[#2563eb] text-white rounded-full flex items-center justify-center text-sm">
                  2
                </span>
                <span className="text-gray-700">Leia dois resumos (A e B) do mesmo artigo</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-[#2563eb] text-white rounded-full flex items-center justify-center text-sm">
                  3
                </span>
                <span className="text-gray-700">Escolha qual prefere e dê uma nota</span>
              </li>
              <li className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-[#2563eb] text-white rounded-full flex items-center justify-center text-sm">
                  4
                </span>
                <span className="text-gray-700">Compartilhe sua experiência em um questionário final</span>
              </li>
            </ol>
          </div>

          <div className="bg-blue-50 border border-[#2563eb] rounded-lg p-4 mb-6">
            <h3 className="text-lg font-semibold mb-3 text-[#2563eb]">Informações importantes:</h3>
            <ul className="space-y-2 text-gray-700">
              <li className="flex gap-2">
                <span className="text-[#2563eb]">•</span>
                <span>Tempo estimado: 10-15 minutos</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2563eb]">•</span>
                <span>Seus dados serão usados apenas para fins acadêmicos</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2563eb]">•</span>
                <span>Você pode interromper a qualquer momento</span>
              </li>
              <li className="flex gap-2">
                <span className="text-[#2563eb]">•</span>
                <span>Não há respostas certas ou erradas</span>
              </li>
            </ul>
          </div>

          <button
            type="button"
            onClick={() => navigate('/experiment/register')}
            className="w-full bg-[#2563eb] text-white py-4 rounded-lg hover:bg-[#1d4ed8] transition-colors text-lg font-semibold"
          >
            Iniciar Experimento
          </button>
        </div>

        {participantId && (
          <div className="text-center mb-4">
            <Link
              to="/experiment/profile"
              className="text-[#2563eb] hover:text-[#1d4ed8] text-sm font-medium transition-colors"
            >
              Ver seu perfil
            </Link>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          Trabalho de Conclusão de Curso — UNISINOS
        </p>
      </div>
    </div>
  );
}
