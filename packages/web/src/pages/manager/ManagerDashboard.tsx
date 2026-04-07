import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi, experimentApi } from '../../api/client';

interface CodeRow {
  id: number;
  code: string;
  email: string;
  role: string;
  participant_id: number | null;
  used_at: string | null;
  created_at: string;
}

interface SessionRow {
  id: number;
  phase: string;
  articleId: number;
}

export function ManagerDashboard() {
  const navigate = useNavigate();
  const [codes, setCodes] = useState<CodeRow[]>([]);
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [loadingCodes, setLoadingCodes] = useState(true);

  const loadCodes = async () => {
    try {
      const data = await authApi.listCodes();
      setCodes(data);
    } catch {
      // ignore
    } finally {
      setLoadingCodes(false);
    }
  };

  const loadSessions = async () => {
    // Load sessions for all participants by fetching codes with participant_ids
    // then fetching their sessions
    try {
      const allCodes = await authApi.listCodes();
      const participantIds = allCodes
        .filter((c) => c.participant_id !== null)
        .map((c) => c.participant_id!);

      const uniqueIds = [...new Set(participantIds)];
      const allSessions: SessionRow[] = [];

      for (const pid of uniqueIds) {
        try {
          const s = await experimentApi.getParticipantSessions(pid);
          allSessions.push(...s);
        } catch {
          // participant may not have sessions yet
        }
      }
      setSessions(allSessions);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    loadCodes();
    loadSessions();
  }, []);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteResult(null);
    setInviteError(null);

    try {
      const result = await authApi.invite(email.trim());
      setInviteResult(`Codigo ${result.code} enviado para ${result.email}`);
      setEmail('');
      loadCodes();
    } catch (err) {
      setInviteError((err as Error).message || 'Erro ao enviar convite');
    } finally {
      setInviting(false);
    }
  };

  const handleLogout = () => {
    sessionStorage.clear();
    navigate('/');
  };

  // Session stats
  const completedSessions = sessions.filter((s) => s.phase === 'complete').length;
  const totalSessions = sessions.length;
  const participantCodes = codes.filter((c) => c.role === 'participant');
  const usedCodes = participantCodes.filter((c) => c.used_at !== null);

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Painel do Gerente</h1>
          <p className="text-gray-600">Gerencie participantes e acompanhe o experimento.</p>
        </div>
        <button
          onClick={handleLogout}
          className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 transition-colors"
        >
          Sair
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white p-4 rounded-lg border text-center">
          <div className="text-2xl font-bold text-blue-600">{participantCodes.length}</div>
          <div className="text-sm text-gray-600">Codigos gerados</div>
        </div>
        <div className="bg-white p-4 rounded-lg border text-center">
          <div className="text-2xl font-bold text-green-600">{usedCodes.length}</div>
          <div className="text-sm text-gray-600">Participantes ativos</div>
        </div>
        <div className="bg-white p-4 rounded-lg border text-center">
          <div className="text-2xl font-bold text-purple-600">{completedSessions}/{totalSessions}</div>
          <div className="text-sm text-gray-600">Sessoes completas</div>
        </div>
      </div>

      {/* Invite */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">Convidar participante</h2>
        <form onSubmit={handleInvite} className="flex gap-3">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email do participante"
            className="flex-1 border rounded-lg p-2"
            required
          />
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="px-6 py-2 bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {inviting ? 'Enviando...' : 'Enviar convite'}
          </button>
        </form>
        {inviteResult && (
          <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm">{inviteResult}</div>
        )}
        {inviteError && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm">{inviteError}</div>
        )}
      </div>

      {/* Codes table */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">Codigos gerados</h2>
        {loadingCodes ? (
          <p className="text-gray-500">Carregando...</p>
        ) : codes.length === 0 ? (
          <p className="text-gray-500">Nenhum codigo gerado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="pb-2 font-medium">Codigo</th>
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Papel</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {codes.map((c) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 font-mono">{c.code}</td>
                    <td className="py-2">{c.email}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          c.role === 'manager'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {c.role}
                      </span>
                    </td>
                    <td className="py-2">
                      {c.used_at ? (
                        <span className="text-green-600 text-xs font-medium">Usado</span>
                      ) : (
                        <span className="text-gray-400 text-xs">Pendente</span>
                      )}
                    </td>
                    <td className="py-2 text-gray-500">
                      {new Date(c.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Sessions summary */}
      {sessions.length > 0 && (
        <div className="bg-white p-6 rounded-lg border space-y-4">
          <h2 className="text-lg font-semibold">Sessoes do experimento</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="pb-2 font-medium">ID</th>
                  <th className="pb-2 font-medium">Artigo</th>
                  <th className="pb-2 font-medium">Fase</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-b last:border-0">
                    <td className="py-2">#{s.id}</td>
                    <td className="py-2">Artigo {s.articleId}</td>
                    <td className="py-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          s.phase === 'complete'
                            ? 'bg-green-100 text-green-700'
                            : s.phase === 'comparison'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-blue-100 text-blue-700'
                        }`}
                      >
                        {s.phase}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
