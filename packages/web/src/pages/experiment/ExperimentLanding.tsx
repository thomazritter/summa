import { useNavigate } from 'react-router-dom';

export function ExperimentLanding() {
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">
          Experimento: Resumos Personalizados de Artigos Cientificos
        </h1>
        <p className="text-lg text-gray-600">
          Trabalho de Conclusao de Curso — UNISINOS
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-xl font-semibold">Sobre o Experimento</h2>
        <p className="text-gray-700">
          Voce participara de um estudo que avalia a qualidade de resumos automaticos de artigos cientificos.
          O experimento tem duas fases para cada artigo:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-gray-700">
          <li>
            <strong>Fase 1 — Comparacao:</strong> Voce lera dois resumos (A e B) do mesmo artigo e indicara qual prefere.
          </li>
          <li>
            <strong>Fase 2 — Feedback:</strong> Voce dara feedback sobre um dos resumos, o sistema gerara uma versao melhorada,
            e voce avaliara se houve melhoria.
          </li>
        </ol>
        <p className="text-gray-700">
          <strong>Tempo estimado:</strong> 30-40 minutos no total.
        </p>
      </div>

      <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 space-y-3">
        <h2 className="text-xl font-semibold text-blue-900">Antes de comecar</h2>
        <ul className="list-disc list-inside text-blue-800 space-y-1">
          <li>Voce preenchera um breve formulario sobre seu perfil profissional</li>
          <li>Nao ha respostas certas ou erradas</li>
          <li>Seus dados serao usados apenas para fins academicos</li>
          <li>Voce pode interromper a qualquer momento</li>
        </ul>
      </div>

      <button
        onClick={() => navigate('/experiment/register')}
        className="w-full py-4 bg-blue-600 text-white text-lg font-semibold rounded-lg hover:bg-blue-700 transition-colors"
      >
        Iniciar Experimento
      </button>
    </div>
  );
}
