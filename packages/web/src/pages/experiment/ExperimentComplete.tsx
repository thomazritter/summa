import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export function ExperimentComplete() {
  const navigate = useNavigate();
  const participantName = sessionStorage.getItem('experimentParticipantName') || 'Participante';
  const postTestCompleted = sessionStorage.getItem('postTestCompleted');

  // Guard: redirect if post-test was not completed
  useEffect(() => {
    if (!postTestCompleted) {
      const participantId = sessionStorage.getItem('experimentParticipantId');
      if (participantId) {
        navigate('/experiment/post-test');
      } else {
        navigate('/experiment');
      }
    }
  }, [postTestCompleted, navigate]);

  if (!postTestCompleted) {
    return null;
  }

  const handleExit = () => {
    sessionStorage.clear();
    navigate('/');
  };

  return (
    <div className="min-h-screen bg-[#f9fafb] py-12 px-6">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Obrigado, {participantName}!</h1>
        </div>

        <div className="bg-green-50 border border-[#16a34a] rounded-lg p-6 mb-6">
          <p className="text-[#16a34a] text-center font-semibold">
            Sua participação foi registrada com sucesso
          </p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-8 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Sobre este estudo</h2>
          <div className="space-y-4 text-gray-700">
            <p>
              Este experimento faz parte de um Trabalho de Conclusão de Curso (TCC) sobre
              resumos personalizados de artigos científicos usando Modelos de Linguagem (LLMs).
            </p>
            <p>
              Os dois resumos que você comparou eram: um gerado com um prompt genérico (controle)
              e outro personalizado com base no seu perfil. A ordem (A/B) foi aleatória.
            </p>
            <p>
              Seus dados serão utilizados exclusivamente para fins acadêmicos e tratados de forma anônima.
            </p>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-6 mb-6">
          <h3 className="text-gray-900 font-semibold mb-2">Dúvidas ou comentários?</h3>
          <p className="text-gray-700">
            Entre em contato: <a href="mailto:thomaz.ritter207@gmail.com" className="text-[#2563eb] hover:underline">thomaz.ritter207@gmail.com</a>
          </p>
        </div>

        <button
          type="button"
          onClick={handleExit}
          className="w-full bg-gray-500 text-white py-3 font-semibold rounded-lg hover:bg-gray-600 transition-colors"
        >
          Sair do sistema
        </button>
      </div>
    </div>
  );
}
