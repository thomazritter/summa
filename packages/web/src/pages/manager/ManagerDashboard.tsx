import { Fragment, useState } from 'react';
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
  { key: 'overview', label: 'Vis\u00e3o Geral' },
  { key: 'results', label: 'Resultados' },
  { key: 'participants', label: 'Participantes' },
  { key: 'summaries', label: 'Resumos' },
  { key: 'export', label: 'Exportar' },
];

/* ───────────────────────── Component ───────────────────── */

export function ManagerDashboard() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabKey>('overview');

  /* Invite state */
  const [email, setEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const handleLogout = () => {
    sessionStorage.clear();
    navigate('/');
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviting(true);
    setInviteResult(null);
    setInviteError(null);
    try {
      const result = await authApi.invite(email.trim());
      setInviteResult(`C\u00f3digo ${result.code} enviado para ${result.email}`);
      setEmail('');
    } catch (err) {
      setInviteError((err as Error).message || 'Erro ao enviar convite');
    } finally {
      setInviting(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Painel do Pesquisador</h1>
          <p className="text-gray-600">Gerencie participantes e acompanhe o experimento.</p>
        </div>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => setActiveTab('overview')}
            className="px-4 py-2 text-sm bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 transition-colors"
          >
            Convidar
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="px-4 py-2 text-sm text-gray-600 border rounded-lg hover:bg-gray-50 transition-colors"
          >
            Sair
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <div role="tablist" className="flex border-b">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={activeTab === tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-2 text-sm transition-colors -mb-px ${
              activeTab === tab.key
                ? 'border-b-2 border-blue-500 font-semibold text-blue-700'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'overview' && (
        <OverviewTab
          email={email}
          setEmail={setEmail}
          inviting={inviting}
          inviteResult={inviteResult}
          inviteError={inviteError}
          handleInvite={handleInvite}
        />
      )}
      {activeTab === 'results' && <ResultsTab />}
      {activeTab === 'participants' && <ParticipantsTab />}
      {activeTab === 'summaries' && <SummariesTab />}
      {activeTab === 'export' && <ExportTab />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 1: Vis\u00e3o Geral
   ═══════════════════════════════════════════════════════════ */

interface OverviewTabProps {
  email: string;
  setEmail: (v: string) => void;
  inviting: boolean;
  inviteResult: string | null;
  inviteError: string | null;
  handleInvite: (e: React.FormEvent) => void;
}

function OverviewTab({ email, setEmail, inviting, inviteResult, inviteError, handleInvite }: OverviewTabProps) {
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
    <div className="space-y-6">
      {/* Stats cards */}
      {loadingOverview ? (
        <p className="text-gray-500">Carregando...</p>
      ) : overview ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border text-center">
            <div className="text-3xl font-bold text-gray-900">{overview.totalInvited}</div>
            <div className="text-sm text-gray-600 mt-1">Participantes Convidados</div>
          </div>
          <div className="bg-white p-4 rounded-lg border text-center">
            <div className="text-3xl font-bold text-green-600">{overview.totalCompleted}</div>
            <div className="text-sm text-gray-600 mt-1">Conclu\u00edram o Experimento</div>
          </div>
          <div className="bg-white p-4 rounded-lg border text-center">
            <div className="text-3xl font-bold text-blue-600">{overview.completionRate}%</div>
            <div className="text-sm text-gray-600 mt-1">Taxa de Conclus\u00e3o</div>
          </div>
          <div className="bg-white p-4 rounded-lg border">
            <div className="text-sm text-gray-600 mb-2 text-center">Sess\u00f5es por Fase</div>
            <SessionPhaseBar phases={overview.sessionsByPhase} />
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-500 justify-center">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" /> Completas</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Feedback</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Compara\u00e7\u00e3o</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" /> Regenerado</span>
            </div>
          </div>
        </div>
      ) : null}

      {/* Invite section */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h2 className="text-lg font-semibold">Convidar participante</h2>
        <form onSubmit={handleInvite} className="flex gap-3">
          <label htmlFor="invite-email" className="sr-only">Email do participante</label>
          <input
            id="invite-email"
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
            {inviting ? 'Enviando...' : 'Enviar Convite'}
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
        <h2 className="text-lg font-semibold">C\u00f3digos gerados</h2>
        {loadingCodes ? (
          <p className="text-gray-500">Carregando...</p>
        ) : participantCodes.length === 0 ? (
          <p className="text-gray-500">Nenhum c\u00f3digo gerado ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-600">
                  <th className="pb-2 font-medium">C\u00f3digo</th>
                  <th className="pb-2 font-medium">Email</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium">Criado em</th>
                </tr>
              </thead>
              <tbody>
                {participantCodes.map((c: CodeRow) => (
                  <tr key={c.id} className="border-b last:border-0">
                    <td className="py-2 font-mono">{c.code}</td>
                    <td className="py-2">{c.email}</td>
                    <td className="py-2">
                      {c.used_at ? (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">Usado</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">Pendente</span>
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
    </div>
  );
}

function SessionPhaseBar({ phases }: { phases: { complete: number; feedback: number; comparison: number; regenerated: number } }) {
  const total = phases.complete + phases.feedback + phases.comparison + phases.regenerated;
  if (total === 0) return <div className="text-center text-xs text-gray-400">Sem sess\u00f5es</div>;

  const pct = (v: number) => ((v / total) * 100).toFixed(0);

  return (
    <div className="flex h-5 rounded-full overflow-hidden">
      {phases.complete > 0 && <div className="bg-green-500" style={{ width: `${pct(phases.complete)}%` }} title={`Completas: ${phases.complete}`} />}
      {phases.feedback > 0 && <div className="bg-blue-500" style={{ width: `${pct(phases.feedback)}%` }} title={`Feedback: ${phases.feedback}`} />}
      {phases.comparison > 0 && <div className="bg-amber-500" style={{ width: `${pct(phases.comparison)}%` }} title={`Compara\u00e7\u00e3o: ${phases.comparison}`} />}
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
    return <p className="text-gray-500">Dados insuficientes para an\u00e1lise.</p>;
  }

  const profileKeys = Object.keys(results.likertByProfile);
  const PROFILE_LABELS: Record<string, string> = { junior: 'J\u00fanior', pleno: 'Pleno', senior: 'S\u00eanior' };

  return (
    <div className="space-y-6">
      {/* Card 1: Prefer\u00eancia */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h3 className="text-lg font-semibold">Prefer\u00eancia: Personalizado vs. Gen\u00e9rico</h3>
        <PreferenceBar label="Personalizado" pct={results.preferencePersonalized.percentage} count={results.preferencePersonalized.count} total={results.preferencePersonalized.total} color="bg-blue-500" />
        <PreferenceBar label="Gen\u00e9rico" pct={results.preferenceGeneric.percentage} count={results.preferenceGeneric.count} total={results.preferenceGeneric.total} color="bg-gray-400" />
      </div>

      {/* Card 2: M\u00e9dias Likert por Tipo */}
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h3 className="text-lg font-semibold">M\u00e9dias Likert por Tipo de Resumo</h3>
        <LikertComparisonTable generic={results.likertByType.generic} personalized={results.likertByType.personalized} />
      </div>

      {/* Card 3: M\u00e9dias Likert por Perfil */}
      {profileKeys.length > 0 && (
        <div className="bg-white p-6 rounded-lg border space-y-4">
          <h3 className="text-lg font-semibold">M\u00e9dias Likert por Perfil</h3>
          <div className="flex gap-2">
            {profileKeys.map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setProfileTab(key)}
                className={`px-3 py-1 rounded-full text-sm transition-colors ${
                  profileTab === key ? 'bg-blue-100 text-blue-700 font-medium' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
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
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h3 className="text-lg font-semibold">Ciclo de Feedback</h3>
        {results.feedbackCycle.total === 0 ? (
          <p className="text-gray-500">Nenhum dado dispon\u00edvel.</p>
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
      <div className="bg-white p-6 rounded-lg border space-y-4">
        <h3 className="text-lg font-semibold">M\u00e9dias Likert: Resumo Regenerado</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-600">
                <th className="pb-2 font-medium">M\u00e9trica</th>
                <th className="pb-2 font-medium">M\u00e9dia</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b"><td className="py-2">Utilidade</td><td className="py-2">{results.regeneratedLikert.utilidade.toFixed(1)}</td></tr>
              <tr className="border-b"><td className="py-2">Clareza</td><td className="py-2">{results.regeneratedLikert.clareza.toFixed(1)}</td></tr>
              <tr><td className="py-2">Adequa\u00e7\u00e3o</td><td className="py-2">{results.regeneratedLikert.adequacao.toFixed(1)}</td></tr>
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
      <div className="flex justify-between text-sm mb-1">
        <span className="font-medium">{label}</span>
        <span className="text-gray-600">{percentage}% ({count} de {total})</span>
      </div>
      <div className="w-full bg-gray-100 rounded-full h-4">
        <div className={`${color} h-4 rounded-full transition-all`} style={{ width: `${percentage}%` }} />
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
    { label: 'Adequa\u00e7\u00e3o', key: 'adequacao' },
    { label: 'Factualidade', key: 'factualidade' },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-600">
            <th className="pb-2 font-medium">M\u00e9trica</th>
            <th className="pb-2 font-medium">Gen\u00e9rico</th>
            <th className="pb-2 font-medium">Personalizado</th>
            <th className="pb-2 font-medium">Diferen\u00e7a</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const diff = personalized[r.key] - generic[r.key];
            return (
              <tr key={r.key} className="border-b last:border-0">
                <td className="py-2">{r.label}</td>
                <td className="py-2">{generic[r.key].toFixed(1)}</td>
                <td className="py-2">{personalized[r.key].toFixed(1)}</td>
                <td className={`py-2 font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-500'}`}>
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
    <div className="flex h-5 rounded-full overflow-hidden">
      {cycle.improved > 0 && <div className="bg-green-500" style={{ width: `${p(cycle.improved)}%` }} />}
      {cycle.same > 0 && <div className="bg-gray-400" style={{ width: `${p(cycle.same)}%` }} />}
      {cycle.worse > 0 && <div className="bg-red-500" style={{ width: `${p(cycle.worse)}%` }} />}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 3: Participantes
   ═══════════════════════════════════════════════════════════ */

function ParticipantsTab() {
  const queryClient = useQueryClient();
  const { data: participants, isLoading } = useQuery({
    queryKey: ['manager-participants'],
    queryFn: () => managerApi.getParticipants(),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => managerApi.deleteParticipant(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['manager-participants'] });
      queryClient.invalidateQueries({ queryKey: ['manager-overview'] });
      queryClient.invalidateQueries({ queryKey: ['manager-results'] });
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
    return <p className="text-gray-500">Nenhum dado dispon\u00edvel.</p>;
  }

  const LEVEL_BADGE: Record<string, string> = {
    junior: 'bg-green-100 text-green-700',
    pleno: 'bg-blue-100 text-blue-700',
    senior: 'bg-purple-100 text-purple-700',
  };
  const LEVEL_LABELS: Record<string, string> = { junior: 'J\u00fanior', pleno: 'Pleno', senior: 'S\u00eanior' };

  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b text-left text-gray-600 bg-gray-50">
            <th className="p-3 font-medium">Nome</th>
            <th className="p-3 font-medium">N\u00edvel</th>
            <th className="p-3 font-medium">Anos Exp.</th>
            <th className="p-3 font-medium">Status</th>
            <th className="p-3 font-medium">Sess\u00f5es</th>
            <th className="p-3 font-medium w-8" aria-label="Expandir" />
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
  );
}

interface ParticipantData {
  id: number;
  name: string;
  experienceLevel: string;
  yearsExperience: number;
  hasPostTest: boolean;
  postTestResponses: Record<string, string> | null;
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
    improved: { label: 'Melhorou', cls: 'bg-green-100 text-green-700' },
    same: { label: 'Igual', cls: 'bg-gray-100 text-gray-600' },
    worse: { label: 'Piorou', cls: 'bg-red-100 text-red-700' },
  };

  return (
    <>
      <tr
        className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
        onClick={onToggle}
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
        aria-expanded={isOpen}
      >
        <td className="p-3 font-medium">{p.name}</td>
        <td className="p-3">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${levelBadge}`}>{levelLabel}</span>
        </td>
        <td className="p-3">{p.yearsExperience}</td>
        <td className="p-3">
          {p.hasPostTest ? (
            <span className="text-green-600 font-medium text-xs">Completo</span>
          ) : (
            <span className="text-amber-600 font-medium text-xs">Em andamento</span>
          )}
        </td>
        <td className="p-3">{p.sessions.length}</td>
        <td className="p-3 text-gray-400">
          <svg className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </td>
      </tr>
      {isOpen && (
        <tr>
          <td colSpan={6} className="p-4 bg-gray-50 border-b">
            <div className="space-y-4">
              {/* Sessions detail */}
              {p.sessions.map((s) => (
                <div key={s.id} className="bg-white p-4 rounded-lg border space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{s.articleTitle}</span>
                      <span className="ml-2 px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">{s.phase}</span>
                    </div>
                    {s.preferenceDecoded && (
                      <span className="text-sm text-gray-600">
                        Prefer\u00eancia: <span className="font-medium">{s.preferenceDecoded}</span>
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
                        <thead>
                          <tr className="border-b text-left text-gray-500">
                            <th className="pb-1 font-medium">Resumo</th>
                            <th className="pb-1 font-medium">Util.</th>
                            <th className="pb-1 font-medium">Clar.</th>
                            <th className="pb-1 font-medium">Adeq.</th>
                            <th className="pb-1 font-medium">Fact.</th>
                            <th className="pb-1 font-medium">Coment\u00e1rio</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.ratings.map((r, i) => (
                            <tr key={i} className="border-b last:border-0">
                              <td className="py-1 font-medium">{r.label}</td>
                              <td className="py-1">{r.utilidade}</td>
                              <td className="py-1">{r.clareza}</td>
                              <td className="py-1">{r.adequacao}</td>
                              <td className="py-1">{r.factualidade}</td>
                              <td className="py-1 text-gray-500 max-w-xs truncate">{r.comment ?? '\u2014'}</td>
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
                        <span className="text-xs font-medium text-amber-700">Feedback de regenera\u00e7\u00e3o</span>
                        {s.regeneration.improvementRating && IMPROVEMENT_BADGE[s.regeneration.improvementRating] && (
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${IMPROVEMENT_BADGE[s.regeneration.improvementRating].cls}`}>
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
              {p.postTestResponses && Object.keys(p.postTestResponses).length > 0 && (
                <div className="bg-white p-4 rounded-lg border space-y-2">
                  <h4 className="text-sm font-semibold text-gray-700">Respostas do p\u00f3s-teste</h4>
                  <dl className="grid grid-cols-1 gap-2 text-sm">
                    {Object.entries(p.postTestResponses).map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-gray-500 text-xs">{key}</dt>
                        <dd className="text-gray-900">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}

              {/* Delete participant */}
              <div className="pt-2 border-t flex justify-end">
                <button
                  type="button"
                  className="px-3 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
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
   Tab 4: Resumos e M\u00e9tricas
   ═══════════════════════════════════════════════════════════ */

function SummariesTab() {
  const { data: summaries, isLoading } = useQuery({
    queryKey: ['manager-summaries'],
    queryFn: () => managerApi.getSummaries(),
  });

  const [articleFilter, setArticleFilter] = useState<string>('all');
  const [profileFilter, setProfileFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  if (isLoading) return <p className="text-gray-500">Carregando...</p>;
  if (!summaries || summaries.length === 0) {
    return <p className="text-gray-500">Nenhum dado dispon\u00edvel.</p>;
  }

  const articles = [...new Set(summaries.map((s) => s.articleTitle))];
  const profiles = [...new Set(summaries.map((s) => s.profileLevel))];

  const LEVEL_BADGE: Record<string, string> = {
    junior: 'bg-green-100 text-green-700',
    pleno: 'bg-blue-100 text-blue-700',
    senior: 'bg-purple-100 text-purple-700',
  };
  const LEVEL_LABELS: Record<string, string> = { junior: 'J\u00fanior', pleno: 'Pleno', senior: 'S\u00eanior' };

  const filtered = summaries.filter((s) => {
    if (articleFilter !== 'all' && s.articleTitle !== articleFilter) return false;
    if (profileFilter !== 'all' && s.profileLevel !== profileFilter) return false;
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
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex gap-4">
        <div>
          <label htmlFor="article-filter" className="text-sm text-gray-600 mr-2">Artigo:</label>
          <select
            id="article-filter"
            value={articleFilter}
            onChange={(e) => setArticleFilter(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm"
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
            className="border rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="all">Todos</option>
            {profiles.map((p) => (
              <option key={p} value={p}>{LEVEL_LABELS[p] ?? p}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-lg border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-600 bg-gray-50">
                <th className="p-3 font-medium">Artigo</th>
                <th className="p-3 font-medium">Perfil</th>
                <th className="p-3 font-medium">Pr\u00e9via</th>
                <th className="p-3 font-medium">ROUGE-1</th>
                <th className="p-3 font-medium">ROUGE-2</th>
                <th className="p-3 font-medium">ROUGE-L</th>
                <th className="p-3 font-medium">BERT</th>
                <th className="p-3 font-medium">Factualidade</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => (
                <Fragment key={s.id}>
                  <tr
                    className="border-b last:border-0 hover:bg-gray-50 cursor-pointer"
                    onClick={() => setExpandedId(expandedId === s.id ? null : s.id)}
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === s.id ? null : s.id); } }}
                    aria-expanded={expandedId === s.id}
                  >
                    <td className="p-3 max-w-[200px] truncate" title={s.articleTitle}>{s.articleTitle}</td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${LEVEL_BADGE[s.profileLevel] ?? 'bg-gray-100 text-gray-700'}`}>
                        {LEVEL_LABELS[s.profileLevel] ?? s.profileLevel}
                      </span>
                    </td>
                    <td className="p-3 max-w-[150px] truncate text-gray-500">{s.content.slice(0, 60)}...</td>
                    <td className="p-3 font-mono text-sm">{formatMetric(s.rouge1)}</td>
                    <td className="p-3 font-mono text-sm">{formatMetric(s.rouge2)}</td>
                    <td className="p-3 font-mono text-sm">{formatMetric(s.rougeL)}</td>
                    <td className="p-3 font-mono text-sm">{formatMetric(s.bertScore)}</td>
                    <td className={`p-3 font-mono text-sm font-medium ${factualityColor(s.factuality)}`}>{formatMetric(s.factuality)}</td>
                  </tr>
                  {expandedId === s.id && (
                    <tr>
                      <td colSpan={8} className="p-4 bg-gray-50 border-b">
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
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   Tab 5: Exportar Dados
   ═══════════════════════════════════════════════════════════ */

function ExportTab() {
  const [downloading, setDownloading] = useState<string | null>(null);

  const handleExport = async (type: string) => {
    setDownloading(type);
    try {
      const response = await managerApi.exportCsv(type);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // Download failed silently
    } finally {
      setDownloading(null);
    }
  };

  const EXPORTS = [
    { type: 'participants', title: 'Participantes', description: 'Dados demogr\u00e1ficos e pr\u00e9-teste', label: 'Exportar Participantes' },
    { type: 'ratings', title: 'Avalia\u00e7\u00f5es', description: 'Ratings Likert, prefer\u00eancias e coment\u00e1rios', label: 'Exportar Avalia\u00e7\u00f5es' },
    { type: 'feedbacks', title: 'Feedbacks', description: 'Texto de feedback e avalia\u00e7\u00f5es do regenerado', label: 'Exportar Feedbacks' },
    { type: 'post-test', title: 'P\u00f3s-teste', description: 'Respostas do question\u00e1rio p\u00f3s-teste', label: 'Exportar P\u00f3s-teste' },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {EXPORTS.map((exp) => (
          <div key={exp.type} className="bg-white p-6 rounded-lg border space-y-3">
            <h3 className="text-lg font-semibold">{exp.title}</h3>
            <p className="text-sm text-gray-600">{exp.description}</p>
            <button
              type="button"
              onClick={() => handleExport(exp.type)}
              disabled={downloading !== null}
              className="px-4 py-2 text-sm bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {downloading === exp.type ? 'Baixando...' : exp.label}
            </button>
          </div>
        ))}
      </div>

      {/* Export all */}
      <div className="bg-blue-50 p-6 rounded-lg border border-blue-200 space-y-3">
        <h3 className="text-lg font-semibold text-blue-900">Exportar Tudo</h3>
        <p className="text-sm text-blue-700">Baixar todos os dados do experimento em um \u00fanico arquivo.</p>
        <button
          type="button"
          onClick={() => handleExport('all')}
          disabled={downloading !== null}
          className="px-4 py-2 text-sm bg-blue-600 text-white font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {downloading === 'all' ? 'Baixando...' : 'Exportar Tudo'}
        </button>
      </div>
    </div>
  );
}
