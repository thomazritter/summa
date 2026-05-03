import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/client';

type VerifyState = 'loading' | 'error';

export function AuthVerify() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<VerifyState>('loading');
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    const code = searchParams.get('code');

    if (!code) {
      navigate('/', { replace: true });
      return;
    }

    let cancelled = false;

    async function verify(accessCode: string) {
      try {
        const result = await authApi.login(accessCode.trim().toUpperCase());

        if (cancelled) return;

        sessionStorage.setItem('accessCode', result.code);
        sessionStorage.setItem('accessRole', result.role);
        if (result.participantId) {
          sessionStorage.setItem('experimentParticipantId', String(result.participantId));
        }

        if (result.role === 'manager') {
          navigate('/manager', { replace: true });
        } else {
          if (result.participantId) {
            navigate('/experiment/select-article', { replace: true });
          } else {
            navigate('/experiment', { replace: true });
          }
        }
      } catch {
        if (cancelled) return;
        setErrorMessage('Link invalido ou expirado.');
        setState('error');
      }
    }

    verify(code);

    return () => {
      cancelled = true;
    };
  }, [searchParams, navigate]);

  return (
    <div className="min-h-screen bg-[#f9fafb] flex items-center justify-center p-6">
      <div className="bg-white border border-gray-200 rounded-lg p-8 w-full max-w-md space-y-6">
        {state === 'loading' && (
          <div className="text-center space-y-4">
            <div
              className="mx-auto h-10 w-10 border-4 border-gray-200 border-t-[#2563eb] rounded-full animate-spin"
              role="status"
              aria-label="Verificando acesso"
            />
            <p className="text-lg text-gray-700 font-medium">Verificando acesso...</p>
          </div>
        )}

        {state === 'error' && (
          <div className="space-y-6">
            <h1 className="text-3xl font-bold text-gray-900 text-center">Acesse o Summa</h1>
            <div
              className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-center"
              role="alert"
            >
              {errorMessage}
            </div>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="w-full py-4 bg-[#2563eb] text-white font-semibold rounded-lg hover:bg-[#1d4ed8] transition-colors"
            >
              Voltar para login
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
