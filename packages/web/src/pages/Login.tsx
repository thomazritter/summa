import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';

export function Login() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await authApi.login(code.trim().toUpperCase());
      sessionStorage.setItem('accessCode', result.code);
      sessionStorage.setItem('accessRole', result.role);
      if (result.participantId) {
        sessionStorage.setItem('experimentParticipantId', String(result.participantId));
      }

      if (result.role === 'manager') {
        navigate('/manager');
      } else {
        if (result.participantId) {
          navigate('/experiment/select-article');
        } else {
          navigate('/experiment');
        }
      }
    } catch {
      setError('Código não encontrado');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 text-center">Acesse o Summa</h1>
        <p className="text-gray-600 text-center">
          Digite o código de acesso que você recebeu por email.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Código de acesso
            </label>
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Digite seu código (ex: SUMMA-XXXX)"
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
              autoFocus
            />
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm text-center">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!code.trim() || loading}
            className="w-full py-3 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Verificando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
