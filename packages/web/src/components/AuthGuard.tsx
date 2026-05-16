import { ReactNode, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

interface AuthGuardProps {
  children: ReactNode;
  requiredRole?: 'participant';
}

export function AuthGuard({ children, requiredRole }: AuthGuardProps) {
  const navigate = useNavigate();
  const code = sessionStorage.getItem('accessCode');
  const role = sessionStorage.getItem('accessRole');

  useEffect(() => {
    if (!code) {
      navigate('/', { replace: true });
      return;
    }
    if (requiredRole && role !== requiredRole) {
      navigate('/dashboard', { replace: true });
    }
  }, [code, role, requiredRole, navigate]);

  if (!code) return null;
  if (requiredRole && role !== requiredRole) return null;

  return <>{children}</>;
}
