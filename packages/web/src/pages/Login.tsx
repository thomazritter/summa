import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/client';

type TabMode = 'email' | 'code';

export function Login() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabMode>('email');

  // Email tab state
  const [email, setEmail] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState('');

  // Code tab state
  const [code, setCode] = useState('');
  const [codeLoading, setCodeLoading] = useState(false);
  const [codeError, setCodeError] = useState('');

  const handleTabChange = (tab: TabMode) => {
    setActiveTab(tab);
    setEmailError('');
    setCodeError('');
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError('');
    setEmailLoading(true);

    try {
      await authApi.requestMagicLink(email.trim());
      setEmailSent(true);
    } catch {
      setEmailError('Nao foi possivel enviar o link. Verifique o email e tente novamente.');
    } finally {
      setEmailLoading(false);
    }
  };

  const handleCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCodeError('');
    setCodeLoading(true);

    try {
      const result = await authApi.login(code.trim().toUpperCase());
      sessionStorage.setItem('accessCode', result.code);
      sessionStorage.setItem('accessRole', result.role);
      if (result.email) {
        sessionStorage.setItem('userEmail', result.email);
      }
      if (result.participantId) {
        sessionStorage.setItem('experimentParticipantId', String(result.participantId));
      }

      if (result.role === 'manager') {
        navigate('/manager');
      } else {
        navigate('/dashboard');
      }
    } catch {
      setCodeError('Codigo nao encontrado.');
    } finally {
      setCodeLoading(false);
    }
  };

  const tabButtonClass = (tab: TabMode) =>
    tab === activeTab
      ? 'border-b-2 border-[#2563eb] text-[#2563eb] font-semibold pb-2'
      : 'text-gray-500 pb-2 hover:text-gray-700';

  return (
    <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-md space-y-6">
        <h1 className="text-3xl font-bold text-gray-900 text-center">Acesse o Summa</h1>

        {/* Tabs */}
        <nav className="flex gap-6 justify-center" role="tablist" aria-label="Metodo de acesso">
          <button
            type="button"
            role="tab"
            id="tab-email"
            aria-selected={activeTab === 'email'}
            aria-controls="panel-email"
            className={tabButtonClass('email')}
            onClick={() => handleTabChange('email')}
          >
            Acesso por email
          </button>
          <button
            type="button"
            role="tab"
            id="tab-code"
            aria-selected={activeTab === 'code'}
            aria-controls="panel-code"
            className={tabButtonClass('code')}
            onClick={() => handleTabChange('code')}
          >
            Tenho um codigo
          </button>
        </nav>

        {/* Email Tab Panel */}
        {activeTab === 'email' && (
          <div role="tabpanel" id="panel-email" aria-labelledby="tab-email">
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
              <form onSubmit={handleEmailSubmit} className="space-y-6">
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

                {emailError && (
                  <div
                    className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm text-center"
                    role="alert"
                  >
                    {emailError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={!email.trim() || emailLoading}
                  className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {emailLoading ? 'Enviando...' : 'Enviar link de acesso'}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Code Tab Panel */}
        {activeTab === 'code' && (
          <div role="tabpanel" id="panel-code" aria-labelledby="tab-code">
            <form onSubmit={handleCodeSubmit} className="space-y-6">
              <div>
                <label
                  htmlFor="code-input"
                  className="block text-sm font-medium text-gray-700 mb-1"
                >
                  Codigo de acesso
                </label>
                <input
                  id="code-input"
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="Digite seu codigo (ex: SUMMA-XXXX)"
                  maxLength={20}
                  className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg font-mono tracking-wider uppercase focus:outline-none focus:ring-2 focus:ring-[#2563eb]"
                  autoFocus
                />
              </div>

              {codeError && (
                <div
                  className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm text-center"
                  role="alert"
                >
                  {codeError}
                </div>
              )}

              <button
                type="submit"
                disabled={!code.trim() || codeLoading}
                className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {codeLoading ? 'Verificando...' : 'Entrar'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
