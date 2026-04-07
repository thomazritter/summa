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
    <div className="max-w-md mx-auto mt-16 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-gray-900">Acesse o Summa</h1>
        <p className="text-gray-600">
          Digite o código de acesso que você recebeu por email.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="bg-white p-6 rounded-lg border space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Código de acesso
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Digite seu código (ex: SUMMA-XXXX)"
            className="w-full border rounded-lg p-3 text-center text-lg font-mono tracking-wider uppercase"
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
          className="w-full py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {loading ? 'Verificando...' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
