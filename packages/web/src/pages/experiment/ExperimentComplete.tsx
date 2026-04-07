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
    <div className="max-w-2xl mx-auto space-y-8 text-center">
      <div className="space-y-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900">Obrigado, {participantName}!</h1>
        <p className="text-lg text-gray-600">
          Sua participação no experimento foi concluída com sucesso.
        </p>
      </div>

      <div className="bg-green-50 p-6 rounded-lg border border-green-200 space-y-3">
        <h2 className="text-xl font-semibold text-green-900">Participação concluída</h2>
        <p className="text-green-800">
          Todas as suas avaliações foram registradas com sucesso. Agradecemos muito pela sua contribuição!
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Sobre este estudo</h2>
        <p className="text-gray-700">
          Este experimento faz parte de um Trabalho de Conclusão de Curso (TCC) sobre
          resumos personalizados de artigos científicos usando Modelos de Linguagem (LLMs).
        </p>
        <p className="text-gray-700">
          Os dois resumos que você comparou eram: um gerado com um prompt genérico (controle)
          e outro personalizado com base no seu perfil. A ordem (A/B) foi aleatória.
        </p>
        <p className="text-sm text-gray-500 mt-4">
          Seus dados serão utilizados exclusivamente para fins acadêmicos e tratados de forma anônima.
        </p>
        <p className="text-sm text-gray-500 mt-6">
          Em caso de dúvidas, entre em contato: thomaz.ritter207@gmail.com
        </p>
      </div>

      <button
        type="button"
        onClick={handleExit}
        className="w-full py-3 bg-gray-600 text-white font-semibold rounded-lg hover:bg-gray-700 transition-colors"
      >
        Sair do sistema
      </button>
    </div>
  );
}
