import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';

export function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // If a session already exists, skip the login form entirely.
  useEffect(() => {
    if (sessionStorage.getItem('accessCode')) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await authApi.requestMagicLink(email.trim());
      setEmailSent(true);
    } catch {
      setError('Nao foi possivel enviar o link. Verifique o email e tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 text-center flex items-center justify-center gap-3">
          <img src="/apple-touch-icon.png" alt="" aria-hidden="true" className="w-10 h-10" />
          Acesse o Summa
        </h1>

        {emailSent ? (
          <div className="space-y-4">
            <div
              className="bg-green-50 border border-green-200 rounded-lg p-4 text-green-700 text-center"
              role="status"
            >
              <p className="font-medium">
                Enviamos um link para {email}. Verifique sua caixa de entrada.
              </p>
              <p className="text-sm mt-2">O link expira em 15 minutos.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setEmailSent(false);
                setEmail('');
              }}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors"
            >
              Enviar novamente
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="email-input"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email
              </label>
              <input
                id="email-input"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Digite seu email"
                required
                maxLength={320}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                autoFocus
              />
            </div>

            {error && (
              <div
                className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm text-center"
                role="alert"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!email.trim() || loading}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Enviando...' : 'Enviar link de acesso'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
