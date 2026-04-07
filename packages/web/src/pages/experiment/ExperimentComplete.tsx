export function ExperimentComplete() {
  const participantName = sessionStorage.getItem('experimentParticipantName') || 'Participante';

  return (
    <div className="max-w-2xl mx-auto space-y-8 text-center">
      <div className="space-y-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900">Obrigado, {participantName}!</h1>
        <p className="text-lg text-gray-600">
          Sua participacao no experimento foi concluida com sucesso.
        </p>
      </div>

      <div className="bg-green-50 p-6 rounded-lg border border-green-200 space-y-3">
        <h2 className="text-xl font-semibold text-green-900">Participacao concluida</h2>
        <p className="text-green-800">
          Todas as suas avaliacoes foram registradas com sucesso. Agradecemos muito pela sua contribuicao!
        </p>
      </div>

      <div className="bg-white p-6 rounded-lg border space-y-3">
        <h2 className="text-lg font-semibold text-gray-900">Sobre este estudo</h2>
        <p className="text-gray-700">
          Este experimento faz parte de um Trabalho de Conclusao de Curso (TCC) sobre
          resumos personalizados de artigos cientificos usando Modelos de Linguagem (LLMs).
        </p>
        <p className="text-gray-700">
          Os dois resumos que voce comparou eram: um gerado com um prompt generico (controle)
          e outro personalizado com base no seu perfil. A ordem (A/B) foi aleatoria.
        </p>
        <p className="text-sm text-gray-500 mt-4">
          Seus dados serao utilizados exclusivamente para fins academicos e tratados de forma anonima.
        </p>
      </div>
    </div>
  );
}
