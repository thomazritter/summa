import { useState } from 'react';
import type { FactualitySentence } from './FactualityHighlightedMarkdown';

interface Props {
  factualityScore: number | null;
  factualityDetails: FactualitySentence[] | null;
}

function fmt(value: number | null, digits = 2): string {
  if (value === null || Number.isNaN(value)) return '—';
  return value.toFixed(digits);
}

function factualityBreakdown(details: FactualitySentence[] | null) {
  if (!details || details.length === 0) return null;
  const total = details.length;
  const supported = details.filter((d) => d.label === 'supported').length;
  const neutral = details.filter((d) => d.label === 'neutral').length;
  const contradicted = details.filter((d) => d.label === 'contradicted').length;
  return { total, supported, neutral, contradicted };
}

export function MetricsPanel({ factualityScore, factualityDetails }: Props) {
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
          Detalhes da factualidade
        </span>
        <span className="text-xs text-gray-500">
          {factualityScore !== null ? `Factualidade ${(factualityScore * 100).toFixed(0)}%` : ''}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-2 border-t border-gray-200 space-y-3 text-sm">
          <div>
            <div className="font-medium text-gray-700 mb-1">Escore agregado</div>
            <div className="text-gray-600">
              <span className="font-mono">{fmt(factualityScore)}</span>
              {factualityScore === null && (
                <span className="text-gray-500"> (verificação ainda em andamento ou sem frases verificáveis)</span>
              )}
            </div>
          </div>

          {breakdown && (
            <div>
              <div className="font-medium text-gray-700 mb-1">Distribuição por frase</div>
              <div className="text-gray-600">
                {breakdown.total} frase(s) verificada(s):{' '}
                <span className="text-green-700">{breakdown.supported} suportada(s)</span>,{' '}
                <span className="text-amber-700">{breakdown.neutral} neutra(s)</span>,{' '}
                <span className="text-red-700">{breakdown.contradicted} contraditada(s)</span>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-500 italic pt-2 border-t border-gray-200">
            O escore agregado pondera cada frase verificada: 1,0 quando suportada, 0,5 quando neutra,
            0,0 quando contraditada, e tira a média aritmética. Frases muito curtas ou meta-discursivas
            são descartadas antes da verificação.
          </p>
        </div>
      )}
    </div>
  );
}
