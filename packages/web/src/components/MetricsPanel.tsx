import { useState } from 'react';
import type { FactualitySentence } from './FactualityHighlightedMarkdown';

interface Props {
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
  rouge1: number | null;
  rouge2: number | null;
  rougeL: number | null;
  bertScore: number | null;
  pAccuracy: {
    pAccuracyRouge: number | null;
    avgPairwiseRougeL: number | null;
  } | null;
}

function fmt(value: number | null, digits = 3): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function factualityBreakdown(details: FactualitySentence[] | null) {
  if (!details || details.length === 0) return null;
  const total = details.length;
  const supported = details.filter((d) => d.label === 'supported').length;
  const neutral = details.filter((d) => d.label === 'neutral').length;
  const contradicted = details.filter((d) => d.label === 'contradicted').length;
  return {
    total,
    supported,
    neutral,
    contradicted,
    supportedPct: (supported / total) * 100,
    neutralPct: (neutral / total) * 100,
    contradictedPct: (contradicted / total) * 100,
  };
}

export function MetricsPanel({
  factualityScore,
  factualityDetails,
  rouge1,
  rouge2,
  rougeL,
  bertScore,
  pAccuracy,
}: Props) {
  const [open, setOpen] = useState(false);
  const breakdown = factualityBreakdown(factualityDetails);

  return (
    <div className="mt-4 border border-gray-200 rounded-lg bg-gray-50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          <span className="text-xs">{open ? '▼' : '▶'}</span>
          Métricas técnicas (avançado)
        </span>
        <span className="text-xs text-gray-500">
          {factualityScore !== null ? `Factualidade ${(factualityScore * 100).toFixed(0)}%` : ''}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 space-y-3 text-sm">
          {/* Factuality */}
          <div>
            <div className="font-medium text-gray-700 mb-1">Factualidade</div>
            <div className="text-gray-600">
              Escore agregado: <span className="font-mono">{fmt(factualityScore, 2)}</span>
            </div>
            {breakdown && (
              <div className="text-gray-600 mt-1">
                {breakdown.total} frase(s) verificada(s):{' '}
                <span className="text-green-700">{breakdown.supported} suportada(s)</span>,{' '}
                <span className="text-amber-700">{breakdown.neutral} neutra(s)</span>,{' '}
                <span className="text-red-700">{breakdown.contradicted} contraditada(s)</span>
              </div>
            )}
          </div>

          {/* ROUGE */}
          <div>
            <div className="font-medium text-gray-700 mb-1">ROUGE</div>
            <div className="grid grid-cols-3 gap-2 text-gray-600 font-mono text-xs">
              <div>R-1: {fmt(rouge1)}</div>
              <div>R-2: {fmt(rouge2)}</div>
              <div>R-L: {fmt(rougeL)}</div>
            </div>
          </div>

          {/* BERTScore */}
          <div>
            <div className="font-medium text-gray-700 mb-1">BERTScore F1</div>
            <div className="text-gray-600 font-mono text-xs">{fmt(bertScore)}</div>
          </div>

          {/* P-Accuracy */}
          <div>
            <div className="font-medium text-gray-700 mb-1">P-Accuracy do artigo</div>
            <div className="text-gray-600 font-mono text-xs">
              {pAccuracy?.pAccuracyRouge != null
                ? `${fmt(pAccuracy.pAccuracyRouge)} (similaridade média par-a-par ROUGE-L: ${fmt(pAccuracy.avgPairwiseRougeL)})`
                : '— (necessários ao menos dois perfis distintos para o mesmo artigo)'}
            </div>
          </div>

          <p className="text-xs text-gray-500 italic pt-2 border-t border-gray-200">
            ROUGE e BERTScore comparam o resumo (em português) ao texto de referência (genérico ou abstract). No
            cenário translíngue artigo-em-inglês × resumo-em-português adotado neste protótipo, esses valores não são
            diretamente comparáveis a benchmarks monolíngues.
          </p>
        </div>
      )}
    </div>
  );
}
