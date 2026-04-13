import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { authApi, managerApi } from '../../api/client';

/* ───────────────────────── Types ───────────────────────── */

interface CodeRow {
  id: number;
  code: string;
  email: string;
  role: string;
  participant_id: number | null;
  used_at: string | null;
  created_at: string;
}

type TabKey = 'overview' | 'results' | 'participants' | 'summaries' | 'export';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'overview', label: 'Visão Geral' },
  { key: 'results', label: 'Resultados' },
  { key: 'participants', label: 'Participantes' },
  { key: 'summaries', label: 'Resumos' },
  { key: 'export', label: 'Exportar' },
];

/* ───────────────────────── Component ───────────────────── */

export function ManagerDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  /* Invite modal state */
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [emailValidationError, setEmailValidationError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleLogout = () => {
    sessionStorage.clear();
    navigate('/');
  };

  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailValidationError(null);

    if (!EMAIL_REGEX.test(email.trim())) {
      setEmailValidationError('Email inválido');
      return;
    }

    setInviting(true);
    setInviteResult(null);
    setInviteError(null);
    try {
      const result = await authApi.invite(email.trim());
      setInviteResult(`Código ${result.code} enviado para ${result.email}`);
      setEmail('');
      queryClient.invalidateQueries({ queryKey: ['manager-codes'] });
    } catch (err) {
      setInviteError((err as Error).message || 'Erro ao enviar convite');
    } finally {
      setInviting(false);
    }
  };

  const openInviteModal = () => {
    setEmail('');
    setEmailValidationError(null);
    setInviteResult(null);
    setInviteError(null);
    setInviteModalOpen(true);
  };

  const closeInviteModal = useCallback(() => {
    setInviteModalOpen(false);
  }, []);

  /* Auto-dismiss invite messages */
  useEffect(() => {
    if (inviteResult) {
      const timer = setTimeout(() => {
        setInviteResult(null);
        closeInviteModal();
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [inviteResult, closeInviteModal]);

  useEffect(() => {
    if (inviteError) {
      const timer = setTimeout(() => {
        setInviteError(null);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [inviteError]);

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-gray-900">Painel do Pesquisador</h1>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={openInviteModal}
              aria-label="Convidar participante"
              className="px-4 py-2 text-sm bg-[#2563eb] text-white font-medium rounded-lg hover:bg-[#1d4ed8] transition-all"
            >
              Convidar
            </button>
            <button
              type="button"
              onClick={handleLogout}
              aria-label="Sair do painel"
              className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-all"
            >
              Sair
            </button>
          </div>
        </div>

        {/* Tab bar */}
        <div className="max-w-7xl mx-auto px-6">
          <div role="tablist" className="flex gap-6 border-b border-gray-200">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                role="tab"
                type="button"
                aria-selected={activeTab === tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-3 text-sm border-b-2 transition-all -mb-px ${
                  activeTab === tab.key
                    ? 'border-[#2563eb] text-[#2563eb] font-semibold'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {inviteModalOpen && (
        <InviteModal
          email={email}
          setEmail={setEmail}
          emailValidationError={emailValidationError}
          setEmailValidationError={setEmailValidationError}
          inviting={inviting}
          inviteResult={inviteResult}
          inviteError={inviteError}
          handleInvite={handleInvite}
          onClose={closeInviteModal}
        />
      )}

      {/* Tab content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'results' && <ResultsTab />}
        {activeTab === 'participants' && <ParticipantsTab />}
        {activeTab === 'summaries' && <SummariesTab />}
        {activeTab === 'export' && <ExportTab />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Invite Modal
   ═══════════════════════════════════════════════════════════ */

interface InviteModalProps {
  email: string;
  setEmail: (v: string) => void;
  emailValidationError: string | null;
  setEmailValidationError: (v: string | null) => void;
  inviting: boolean;
  inviteResult: string | null;
  inviteError: string | null;
  handleInvite: (e: React.FormEvent) => void;
  onClose: () => void;
}

function InviteModal({
  email,
  setEmail,
  emailValidationError,
  setEmailValidationError,
  inviting,
  inviteResult,
  inviteError,
  handleInvite,
  onClose,
}: InviteModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  /* Focus the close button on mount */
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  /* Close on Escape */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  /* Close on overlay click */
  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) {
      onClose();
    }
  };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="invite-modal-title"
    >
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4 p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 id="invite-modal-title" className="text-xl font-semibold text-gray-900">Convidar participante</h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Fechar modal de convite"
            className="p-1.5 text-gray-400 hover:text-gray-600 transition-all rounded-lg hover:bg-gray-100"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleInvite} className="space-y-4">
          <div>
            <label htmlFor="invite-email" className="sr-only">Email do participante</label>
            <input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (emailValidationError) setEmailValidationError(null);
              }}
              placeholder="Email do participante"
              className={`w-full border border-gray-200 rounded-lg px-4 py-2.5 text-sm transition-all focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb] outline-none ${emailValidationError ? 'border-red-400' : ''}`}
              required
              aria-describedby={emailValidationError ? 'email-validation-error' : undefined}
              aria-invalid={emailValidationError ? 'true' : undefined}
            />
            {emailValidationError && (
              <p id="email-validation-error" className="text-red-600 text-sm mt-1">{emailValidationError}</p>
            )}
          </div>
          <button
            type="submit"
            disabled={inviting || !email.trim()}
            className="w-full px-6 py-2.5 bg-[#2563eb] text-white font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-all"
          >
            {inviting ? 'Enviando...' : 'Enviar Convite'}
          </button>
        </form>

        {inviteResult && (
          <div className="bg-green-50 text-green-700 p-3 rounded-lg text-sm" role="status">{inviteResult}</div>
        )}
        {inviteError && (
          <div className="bg-red-50 text-red-700 p-3 rounded-lg text-sm" role="alert">{inviteError}</div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 1: Visão Geral
   ═══════════════════════════════════════════════════════════ */

function OverviewTab() {
  const { data: overview, isLoading: loadingOverview } = useQuery({
    queryKey: ['manager-overview'],
    queryFn: () => managerApi.getOverview(),
  });

  const { data: codes, isLoading: loadingCodes } = useQuery({
    queryKey: ['manager-codes'],
    queryFn: () => authApi.listCodes(),
  });

  const participantCodes = (codes ?? []).filter((c: CodeRow) => c.role === 'participant');

  return (
    <div className="space-y-8">
      {/* Stats cards */}
      {loadingOverview ? (
        <p className="text-gray-500">Carregando...</p>
      ) : overview ? (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="text-sm text-gray-600 mb-2">Participantes Convidados</div>
            <div className="text-3xl font-bold text-gray-900">{overview.totalInvited}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="text-sm text-gray-600 mb-2">Concluíram o Experimento</div>
            <div className="text-3xl font-bold text-[#16a34a]">{overview.totalCompleted}</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="text-sm text-gray-600 mb-2">Taxa de Conclusão</div>
            <div className="text-3xl font-bold text-[#2563eb]">{overview.completionRate}%</div>
          </div>
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="text-sm text-gray-600 mb-2">Sessões por Fase</div>
            <SessionPhaseBar phases={overview.sessionsByPhase} />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-xs text-gray-600">
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-green-500 inline-block" /> Completas</span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-blue-500 inline-block" /> Feedback</span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-amber-500 inline-block" /> Comparação</span>
              <span className="flex items-center gap-2"><span className="w-3 h-3 rounded bg-indigo-500 inline-block" /> Regenerado</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Codes table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">Códigos de Acesso</h2>
        </div>
        {loadingCodes ? (
          <div className="p-6">
            <p className="text-gray-500">Carregando...</p>
          </div>
        ) : participantCodes.length === 0 ? (
          <div className="p-6">
            <p className="text-gray-500">Nenhum código gerado ainda.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Código</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Email</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Criado em</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {participantCodes.map((c: CodeRow) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-all">
                    <td className="px-6 py-4 font-mono text-sm">{c.code}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{c.email}</td>
                    <td className="px-6 py-4">
                      {c.used_at ? (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-[#16a34a]">Usado</span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">Pendente</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(c.created_at).toLocaleDateString('pt-BR')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SessionPhaseBar({ phases }: { phases: { complete: number; feedback: number; comparison: number; regenerated: number } }) {
  const total = phases.complete + phases.feedback + phases.comparison + phases.regenerated;
  if (total === 0) return <div className="text-center text-xs text-gray-400">Sem sessões</div>;

  const pct = (v: number) => ((v / total) * 100).toFixed(0);

  return (
    <div className="flex h-8 rounded overflow-hidden mt-4">
      {phases.complete > 0 && <div className="bg-green-500" style={{ width: `${pct(phases.complete)}%` }} title={`Completas: ${phases.complete}`} />}
      {phases.feedback > 0 && <div className="bg-blue-500" style={{ width: `${pct(phases.feedback)}%` }} title={`Feedback: ${phases.feedback}`} />}
      {phases.comparison > 0 && <div className="bg-amber-500" style={{ width: `${pct(phases.comparison)}%` }} title={`Comparação: ${phases.comparison}`} />}
      {phases.regenerated > 0 && <div className="bg-indigo-500" style={{ width: `${pct(phases.regenerated)}%` }} title={`Regenerado: ${phases.regenerated}`} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 2: Resultados Agregados
   ═══════════════════════════════════════════════════════════ */

function ResultsTab() {
  const { data: results, isLoading } = useQuery({
    queryKey: ['manager-results'],
    queryFn: () => managerApi.getResults(),
  });

  const [profileTab, setProfileTab] = useState<string>('junior');

  if (isLoading) return <p className="text-gray-500">Carregando...</p>;
  if (!results || !results.hasData) {
    return <p className="text-gray-500">Dados insuficientes para análise.</p>;
  }

  const profileKeys = Object.keys(results.likertByProfile);
  const PROFILE_LABELS: Record<string, string> = { junior: 'Júnior', pleno: 'Pleno', senior: 'Sênior' };

  return (
    <div className="space-y-8">
      {/* Card 1: Preferência */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 space-y-4">
        <h3 className="text-lg font-semibold">Preferência de Resumos</h3>
        <PreferenceBar label="Personalizado" pct={results.preferencePersonalized.percentage} count={results.preferencePersonalized.count} total={results.preferencePersonalized.total} color="bg-blue-500" />
        <PreferenceBar label="Genérico" pct={results.preferenceGeneric.percentage} count={results.preferenceGeneric.count} total={results.preferenceGeneric.total} color="bg-gray-400" />
      </div>

      {/* Card 2: Médias Likert por Tipo */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 space-y-4">
        <h3 className="text-lg font-semibold">Comparação de Avaliações (Média)</h3>
        <LikertComparisonTable generic={results.likertByType.generic} personalized={results.likertByType.personalized} />
      </div>

      {/* Card 3: Médias Likert por Perfil */}
      {profileKeys.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8 space-y-6">
          <h3 className="text-lg font-semibold">Análise por Perfil</h3>
          <div className="flex gap-2">
            {profileKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setProfileTab(key)}
                className={`px-4 py-2 rounded-full text-sm transition-all ${
                  profileTab === key ? 'bg-[#2563eb] text-white font-medium' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {PROFILE_LABELS[key] ?? key}
              </button>
            ))}
          </div>
          {results.likertByProfile[profileTab] && (
            <LikertComparisonTable
              generic={results.likertByProfile[profileTab].generic}
              personalized={results.likertByProfile[profileTab].personalized}
            />
          )}
        </div>
      )}

      {/* Card 4: Ciclo de Feedback */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 space-y-4">
        <h3 className="text-lg font-semibold">Ciclo de Feedback</h3>
        {results.feedbackCycle.total === 0 ? (
          <p className="text-gray-500">Nenhum dado disponível.</p>
        ) : (
          <>
            <FeedbackCycleBar cycle={results.feedbackCycle} />
            <div className="flex gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Melhorou: {results.feedbackCycle.improved} ({pct(results.feedbackCycle.improved, results.feedbackCycle.total)}%)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" /> Igual: {results.feedbackCycle.same} ({pct(results.feedbackCycle.same, results.feedbackCycle.total)}%)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Piorou: {results.feedbackCycle.worse} ({pct(results.feedbackCycle.worse, results.feedbackCycle.total)}%)</span>
            </div>
          </>
        )}
      </div>

      {/* Card 5: Likert Regenerado */}
      <div className="bg-white border border-gray-200 rounded-lg p-8 space-y-4">
        <h3 className="text-lg font-semibold">Médias Likert: Resumo Regenerado</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Métrica</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Média</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              <tr><td className="px-4 py-4 text-sm text-gray-700">Utilidade</td><td className="px-4 py-4 text-sm">{results.regeneratedLikert.utilidade.toFixed(1)}</td></tr>
              <tr><td className="px-4 py-4 text-sm text-gray-700">Clareza</td><td className="px-4 py-4 text-sm">{results.regeneratedLikert.clareza.toFixed(1)}</td></tr>
              <tr><td className="px-4 py-4 text-sm text-gray-700">Adequação</td><td className="px-4 py-4 text-sm">{results.regeneratedLikert.adequacao.toFixed(1)}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function pct(value: number, total: number): string {
  if (total === 0) return '0';
  return ((value / total) * 100).toFixed(0);
}

function PreferenceBar({ label, pct: percentage, count, total, color }: { label: string; pct: number; count: number; total: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm text-gray-700">{label}</span>
        <span className="text-sm text-gray-900">{percentage}% ({count} de {total})</span>
      </div>
      <div className="h-8 bg-gray-100 rounded overflow-hidden">
        <div className={`${color} h-full transition-all`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}

function LikertComparisonTable({ generic, personalized }: {
  generic: { utilidade: number; clareza: number; adequacao: number; factualidade: number };
  personalized: { utilidade: number; clareza: number; adequacao: number; factualidade: number };
}) {
  const rows: { label: string; key: keyof typeof generic }[] = [
    { label: 'Utilidade', key: 'utilidade' },
    { label: 'Clareza', key: 'clareza' },
    { label: 'Adequação', key: 'adequacao' },
    { label: 'Factualidade', key: 'factualidade' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead className="border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Métrica</th>
            <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Genérico</th>
            <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Personalizado</th>
            <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Diferença</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((r) => {
            const diff = personalized[r.key] - generic[r.key];
            return (
              <tr key={r.key}>
                <td className="px-4 py-4 text-sm text-gray-700">{r.label}</td>
                <td className="px-4 py-4 text-center text-sm">{generic[r.key].toFixed(1)}</td>
                <td className="px-4 py-4 text-center text-sm">{personalized[r.key].toFixed(1)}</td>
                <td className={`px-4 py-4 text-center text-sm font-medium ${diff > 0 ? 'text-[#16a34a]' : diff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
                  {diff > 0 ? '+' : ''}{diff.toFixed(1)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FeedbackCycleBar({ cycle }: { cycle: { improved: number; same: number; worse: number; total: number } }) {
  const p = (v: number) => ((v / cycle.total) * 100).toFixed(0);
  return (
    <div className="flex h-12 rounded overflow-hidden">
      {cycle.improved > 0 && (
        <div className="bg-[#16a34a] flex items-center justify-center text-white text-sm" style={{ width: `${p(cycle.improved)}%` }}>
          Melhorou {p(cycle.improved)}%
        </div>
      )}
      {cycle.same > 0 && (
        <div className="bg-gray-300 flex items-center justify-center text-gray-700 text-sm" style={{ width: `${p(cycle.same)}%` }}>
          Igual {p(cycle.same)}%
        </div>
      )}
      {cycle.worse > 0 && (
        <div className="bg-red-500 flex items-center justify-center text-white text-sm" style={{ width: `${p(cycle.worse)}%` }}>
          Piorou {p(cycle.worse)}%
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 3: Participantes
   ═══════════════════════════════════════════════════════════ */

function ParticipantsTab() {
  const queryClient = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data: participants, isLoading } = useQuery({
    queryKey: ['manager-participants'],
    queryFn: () => managerApi.getParticipants(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => managerApi.deleteParticipant(id),
    onSuccess: () => {
      setDeleteError(null);
      queryClient.invalidateQueries({ queryKey: ['manager-participants'] });
      queryClient.invalidateQueries({ queryKey: ['manager-overview'] });
      queryClient.invalidateQueries({ queryKey: ['manager-results'] });
    },
    onError: (err: Error) => {
      setDeleteError(err.message || 'Erro ao remover participante. Tente novamente.');
    },
  });

  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (isLoading) return <p className="text-gray-500">Carregando...</p>;
  if (!participants || participants.length === 0) {
    return <p className="text-gray-500">Nenhum dado disponível.</p>;
  }

  const LEVEL_BADGE: Record<string, string> = {
    junior: 'bg-green-100 text-[#16a34a]',
    pleno: 'bg-blue-100 text-[#2563eb]',
    senior: 'bg-purple-100 text-purple-700',
  };
  const LEVEL_LABELS: Record<string, string> = { junior: 'Júnior', pleno: 'Pleno', senior: 'Sênior' };

  return (
    <div className="space-y-4">
      {deleteError && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm flex items-center justify-between" role="alert">
          <span>{deleteError}</span>
          <button
            type="button"
            onClick={() => setDeleteError(null)}
            aria-label="Fechar mensagem de erro"
            className="text-red-500 hover:text-red-700 ml-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Nome</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Nível</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Anos Exp.</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Status</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Sessões</th>
              <th className="px-6 py-3 w-8" aria-label="Expandir" />
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => {
              const isOpen = expanded.has(p.id);
              return (
                <ParticipantRow
                  key={p.id}
                  participant={p}
                  isOpen={isOpen}
                  onToggle={() => toggle(p.id)}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  levelBadge={LEVEL_BADGE[p.experienceLevel] ?? 'bg-gray-100 text-gray-700'}
                  levelLabel={LEVEL_LABELS[p.experienceLevel] ?? p.experienceLevel}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface ParticipantData {
  id: number;
  name: string;
  experienceLevel: string;
  yearsExperience: number;
  postTest: Record<string, string> | null;
  sessions: Array<{
    id: number;
    articleTitle: string;
    phase: string;
    preference: string | null;
    preferenceDecoded: string | null;
    preferenceReason: string | null;
    ratings: Array<{
      label: string;
      utilidade: number;
      clareza: number;
      adequacao: number;
      factualidade: number;
      comment: string | null;
    }>;
    regeneration: {
      feedbackText: string;
      improvementRating: string | null;
      ratings: { utilidade: number; clareza: number; adequacao: number } | null;
    } | null;
  }>;
}

function ParticipantRow({ participant: p, isOpen, onToggle, onDelete, levelBadge, levelLabel }: {
  participant: ParticipantData;
  isOpen: boolean;
  onToggle: () => void;
  onDelete: (id: number) => void;
  levelBadge: string;
  levelLabel: string;
}) {
  const IMPROVEMENT_BADGE: Record<string, { label: string; cls: string }> = {
    improved: { label: 'Melhorou', cls: 'bg-green-100 text-[#16a34a]' },
    same: { label: 'Igual', cls: 'bg-gray-100 text-gray-600' },
    worse: { label: 'Piorou', cls: 'bg-red-100 text-red-700' },
  };

  return (
    <>
      <tr
        role="row"
        className="border-b last:border-0 hover:bg-gray-50 cursor-pointer transition-all"
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        aria-expanded={isOpen}
        aria-label={`Participante ${p.name}, clique para ${isOpen ? 'recolher' : 'expandir'} detalhes`}
      >
        <td className="px-6 py-4 text-sm font-medium text-gray-900">{p.name}</td>
        <td className="px-6 py-4">
          <span className={`px-3 py-1 rounded-full text-xs font-medium ${levelBadge}`}>{levelLabel}</span>
        </td>
        <td className="px-6 py-4 text-sm">{p.yearsExperience}</td>
        <td className="px-6 py-4">
          {p.postTest ? (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-[#16a34a]">Concluído</span>
          ) : (
            <span className="px-3 py-1 rounded-full text-xs font-medium bg-amber-100 text-[#d97706]">Em andamento</span>
          )}
        </td>
        <td className="px-6 py-4 text-sm">{p.sessions.length}</td>
        <td className="px-6 py-4 text-gray-400">
          <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} className="px-6 py-5 bg-gray-50 border-b">
            <div className="space-y-4">
              {/* Sessions detail */}
              {p.sessions.map((s) => (
                <div key={s.id} className="bg-white p-5 rounded-lg border border-gray-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium text-gray-900">{s.articleTitle}</span>
                      <span className="ml-2 px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-700">{s.phase}</span>
                    </div>
                    {s.preferenceDecoded && (
                      <span className="text-sm text-gray-600">
                        Preferência: <span className="font-medium">{s.preferenceDecoded}</span>
                      </span>
                    )}
                  </div>
                  {s.preferenceReason && (
                    <p className="text-sm text-gray-600">Motivo: {s.preferenceReason}</p>
                  )}

                  {/* Ratings mini-table */}
                  {s.ratings.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Resumo</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Util.</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Clar.</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Adeq.</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Fact.</th>
                            <th className="px-3 py-2 text-left font-medium text-gray-600">Comentário</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {s.ratings.map((r, i) => (
                            <tr key={i} className="hover:bg-gray-50 transition-all">
                              <td className="px-3 py-2 font-medium">{r.label}</td>
                              <td className="px-3 py-2">{r.utilidade}</td>
                              <td className="px-3 py-2">{r.clareza}</td>
                              <td className="px-3 py-2">{r.adequacao}</td>
                              <td className="px-3 py-2">{r.factualidade}</td>
                              <td className="px-3 py-2 text-gray-500 max-w-xs truncate">{r.comment ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Regeneration info */}
                  {s.regeneration && (
                    <div className="bg-amber-50 p-3 rounded-lg space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-amber-700">Feedback de regeneração</span>
                        {s.regeneration.improvementRating && IMPROVEMENT_BADGE[s.regeneration.improvementRating] && (
                          <span className={`px-3 py-1 rounded-full text-xs font-medium ${IMPROVEMENT_BADGE[s.regeneration.improvementRating].cls}`}>
                            {IMPROVEMENT_BADGE[s.regeneration.improvementRating].label}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-700">{s.regeneration.feedbackText}</p>
                      {s.regeneration.ratings && (
                        <div className="flex gap-4 text-xs text-gray-600">
                          <span>Util.: {s.regeneration.ratings.utilidade}</span>
                          <span>Clar.: {s.regeneration.ratings.clareza}</span>
                          <span>Adeq.: {s.regeneration.ratings.adequacao}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}

              {/* Post-test responses */}
              {p.postTest && Object.keys(p.postTest).length > 0 && (
                <div className="bg-white p-5 rounded-lg border border-gray-200 space-y-3">
                  <h4 className="text-sm font-semibold text-gray-700">Respostas do pós-teste</h4>
                  <dl className="grid grid-cols-1 gap-2 text-sm">
                    {Object.entries(p.postTest).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-gray-500 text-xs">{key}</dt>
                        <dd className="text-gray-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* Delete participant */}
              <div className="pt-3 border-t border-gray-200 flex justify-end">
                <button
                  type="button"
                  className="px-4 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-all"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Tem certeza que deseja remover ${p.name || 'este participante'} e todos os seus dados? Esta ação não pode ser desfeita.`)) {
                      onDelete(p.id);
                    }
                  }}
                >
                  Remover participante e todos os dados
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 4: Resumos e Métricas
   ═══════════════════════════════════════════════════════════ */

/** Inline info icon that explains ROUGE reference differences per profile type. */
function RougeTooltip() {
  return (
    <span
      className="ml-1 inline-block text-gray-400 cursor-help"
      title="Genérico: ROUGE vs abstract do artigo. Personalizado: ROUGE vs resumo genérico (divergência)."
    >
      <svg className="w-3.5 h-3.5 inline" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" />
      </svg>
    </span>
  );
}

function SummariesTab() {
  const { data, isLoading } = useQuery({
    queryKey: ['manager-summaries'],
    queryFn: () => managerApi.getSummaries(),
  });

  const [articleFilter, setArticleFilter] = useState<string>('all');
  const [profileFilter, setProfileFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) return <p className="text-gray-500">Carregando...</p>;
  const summaries = data?.summaries ?? [];
  const pAccuracy = data?.pAccuracy ?? [];
  if (summaries.length === 0) {
    return <p className="text-gray-500">Nenhum dado disponível.</p>;
  }

  const articles = [...new Set(summaries.map((s) => s.articleTitle))];
  const profiles = [...new Set(summaries.map((s) => s.profileLabel))];

  const filtered = summaries.filter((s) => {
    if (articleFilter !== 'all' && s.articleTitle !== articleFilter) return false;
    if (profileFilter !== 'all' && s.profileLabel !== profileFilter) return false;
    return true;
  });

  const formatMetric = (v: number | null) => (v !== null ? v.toFixed(3) : 'N/D');

  const factualityColor = (v: number | null) => {
    if (v === null) return 'text-gray-400';
    if (v >= 0.8) return 'text-green-600';
    if (v >= 0.6) return 'text-amber-600';
    return 'text-red-600';
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex gap-4">
        <div>
          <label htmlFor="article-filter" className="text-sm text-gray-600 mr-2">Artigo:</label>
          <select
            id="article-filter"
            value={articleFilter}
            onChange={(e) => setArticleFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm transition-all focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb] outline-none"
          >
            <option value="all">Todos</option>
            {articles.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="profile-filter" className="text-sm text-gray-600 mr-2">Perfil:</label>
          <select
            id="profile-filter"
            value={profileFilter}
            onChange={(e) => setProfileFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm transition-all focus:ring-2 focus:ring-[#2563eb]/20 focus:border-[#2563eb] outline-none"
          >
            <option value="all">Todos</option>
            {profiles.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Artigo</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Perfil</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Prévia</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">
                  <span>ROUGE-1</span>
                  <RougeTooltip />
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">
                  <span>ROUGE-2</span>
                  <RougeTooltip />
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">
                  <span>ROUGE-L</span>
                  <RougeTooltip />
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">BERT</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-600">Factualidade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {filtered.map((s) => (
                <Fragment key={s.id}>
                  <tr
                    role="row"
                    className="hover:bg-gray-50 cursor-pointer transition-all"
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === s.id ? null : s.id); } }}
                    aria-expanded={expandedId === s.id}
                  >
                    <td className="px-6 py-4 max-w-[200px] truncate text-sm" title={s.articleTitle}>{s.articleTitle}</td>
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                        {s.profileLabel}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-[150px] truncate text-sm text-gray-500">{s.content.slice(0, 60)}...</td>
                    <td className="px-6 py-4 font-mono text-sm">{formatMetric(s.rouge1)}</td>
                    <td className="px-6 py-4 font-mono text-sm">{formatMetric(s.rouge2)}</td>
                    <td className="px-6 py-4 font-mono text-sm">{formatMetric(s.rougeL)}</td>
                    <td className="px-6 py-4 font-mono text-sm">{formatMetric(s.bertScore)}</td>
                    <td className={`px-6 py-4 font-mono text-sm font-medium ${factualityColor(s.factualityScore)}`}>{formatMetric(s.factualityScore)}</td>
                  </tr>
                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={8} className="px-6 py-5 bg-gray-50 border-b">
                        <div className="prose prose-sm max-w-none">
                          <ReactMarkdown>{s.content}</ReactMarkdown>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* P-Accuracy */}
      {pAccuracy.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-lg p-8">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">P-Accuracy (Sensibilidade de Personalização)</h3>
          <p className="text-sm text-gray-600 mb-6">
            Mede o quanto os resumos diferem entre perfis. Valores mais altos indicam maior personalização.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {pAccuracy.map((pa) => (
              <div key={pa.articleId} className="border border-gray-200 rounded-lg p-5">
                <p className="font-medium text-sm text-gray-900 mb-2">{pa.articleTitle}</p>
                <div className="flex items-center gap-4">
                  <div>
                    <span className="text-2xl font-bold text-blue-600">{(pa.pAccuracyRouge * 100).toFixed(1)}%</span>
                    <p className="text-xs text-gray-500">P-Accuracy</p>
                  </div>
                  <div>
                    <span className="text-lg font-semibold text-gray-700">{pa.avgPairwiseRougeL.toFixed(3)}</span>
                    <p className="text-xs text-gray-500">Similaridade média entre perfis</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 5: Exportar Dados
   ═══════════════════════════════════════════════════════════ */

function ExportTab() {
  const [downloading, setDownloading] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);

  const handleExport = async (type: string) => {
    setDownloading(type);
    setExportError(null);
    try {
      const response = await managerApi.exportCsv(type);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(`Falha ao exportar "${type}". ${(err as Error).message || 'Tente novamente.'}`);
    } finally {
      setDownloading(null);
    }
  };

  const EXPORTS = [
    { type: 'participants', title: 'Participantes', description: 'Dados demográficos e pré-teste', label: 'Exportar Participantes' },
    { type: 'ratings', title: 'Avaliações', description: 'Preferências A/B, notas e comentários por sessão', label: 'Exportar Avaliações' },
    { type: 'feedbacks', title: 'Feedbacks', description: 'Texto de feedback e avaliações do regenerado (disponível apenas se o ciclo de feedback foi utilizado)', label: 'Exportar Feedbacks' },
    { type: 'post-test', title: 'Pós-teste', description: 'Respostas do questionário pós-teste', label: 'Exportar Pós-teste' },
  ];

  return (
    <div className="space-y-6">
      {exportError && (
        <div className="bg-red-50 text-red-700 p-4 rounded-lg text-sm flex items-center justify-between" role="alert">
          <span>{exportError}</span>
          <button
            type="button"
            onClick={() => setExportError(null)}
            aria-label="Fechar mensagem de erro"
            className="text-red-500 hover:text-red-700 ml-2 transition-all"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {EXPORTS.map((exp) => (
          <div key={exp.type} className="bg-white border border-gray-200 rounded-lg p-8 space-y-4">
            <h3 className="text-lg font-semibold text-gray-900">{exp.title}</h3>
            <p className="text-sm text-gray-600">{exp.description}</p>
            <button
              type="button"
              onClick={() => handleExport(exp.type)}
              disabled={downloading !== null}
              className="w-full py-2.5 text-sm bg-[#2563eb] text-white font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-all"
            >
              {downloading === exp.type ? 'Baixando...' : exp.label}
            </button>
          </div>
        ))}
      </div>

      {/* Export all */}
      <div className="bg-blue-50 border border-[#2563eb] rounded-lg p-8">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Exportar Tudo</h3>
            <p className="text-sm text-gray-700">Baixar todos os dados do experimento em um único arquivo</p>
          </div>
          <button
            type="button"
            onClick={() => handleExport('all')}
            disabled={downloading !== null}
            className="px-6 py-3 text-sm bg-[#2563eb] text-white font-medium rounded-lg hover:bg-[#1d4ed8] disabled:opacity-50 transition-all"
          >
            {downloading === 'all' ? 'Baixando...' : 'Exportar Tudo'}
          </button>
        </div>
      </div>
    </div>
  );
}
