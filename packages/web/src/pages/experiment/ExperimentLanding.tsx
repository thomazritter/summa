import { useNavigate } from 'react-router-dom';

export function ExperimentLanding() {
  const navigate = useNavigate();

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold text-gray-900">
          Experimento: Resumos Personalizados de Artigos Científicos
        </h1>
        <p className="text-lg text-gray-600">
          Trabalho de Conclusão de Curso — UNISINOS
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-xl font-semibold">Sobre o Experimento</h2>
        <p className="text-gray-700">
          Você participará de um estudo que avalia a qualidade de resumos personalizados de artigos científicos.
          Para cada artigo, o experimento funciona assim:
        </p>
        <ol className="list-decimal list-inside space-y-2 text-gray-700">
          <li>
            <strong>Comparação:</strong> Você lerá dois resumos (A e B) do mesmo artigo e avaliará cada um.
          </li>
          <li>
            <strong>Feedback:</strong> Você dará sugestões de melhoria sobre um dos resumos e avaliará a versão refinada.
          </li>
        </ol>
        <p className="text-gray-700">
          <strong>Tempo estimado:</strong> 25-35 minutos no total.
        </p>
      </div>

      <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 space-y-3">
        <h2 className="text-xl font-semibold text-blue-900">Antes de começar</h2>
        <ul className="list-disc list-inside text-blue-800 space-y-1">
          <li>Você preencherá um breve formulário sobre seu perfil profissional</li>
          <li>Não há respostas certas ou erradas</li>
          <li>Seus dados serão usados apenas para fins acadêmicos</li>
          <li>Você pode interromper a qualquer momento</li>
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
