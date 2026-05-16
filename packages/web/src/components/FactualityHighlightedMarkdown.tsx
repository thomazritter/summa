import React from 'react';
import ReactMarkdown from 'react-markdown';

export interface FactualitySentence {
  sentence: string;
  label: 'supported' | 'neutral' | 'contradicted';
  confidence: number;
  // Legacy NLI+LLM-judge records carry the matched article snippet.
  sourceSentence?: string;
  // FineSurE 3-dim records carry category + rationale instead.
  category?: string;
  rationale?: string;
  judgedBy?: 'finesure' | 'nli' | 'llm' | 'cap_exhausted';
}

interface Props {
  content: string;
  factualityDetails: FactualitySentence[] | null;
}

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;
const NORM_KEY_LEN = 60;

// Mirror the backend list so frontend splitting matches the index keys
// produced when factualityDetails were computed.
const SENTENCE_ABBREVS = [
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'eng', 'gen', 'cel',
  'fig', 'figs', 'tab', 'tabs', 'eq', 'eqs', 'ref', 'refs', 'cap', 'caps',
  'pg', 'pgs', 'p', 'pp', 'vol', 'no', 'etc', 'ed', 'eds', 'art', 'arts',
  'ex', 'i.e', 'e.g', 'cf', 'vs', 'ca',
];
const ABBREV_REGEX = new RegExp(`\\b(${SENTENCE_ABBREVS.join('|')})\\.`, 'gi');

const DOT_PLACEHOLDER = '\u0003';

function maskAbbreviations(text: string): string {
  return text.replace(ABBREV_REGEX, (m) => m.replace('.', DOT_PLACEHOLDER));
}

function unmaskAbbreviations(text: string): string {
  return text.replace(new RegExp(DOT_PLACEHOLDER, 'g'), '.');
}

function normalizeKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[*_`#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NORM_KEY_LEN);
}

function buildIndex(details: FactualitySentence[] | null): Map<string, FactualitySentence> {
  const index = new Map<string, FactualitySentence>();
  if (!details) return index;
  for (const d of details) {
    const key = normalizeKey(d.sentence);
    if (key) index.set(key, d);
  }
  return index;
}

function highlightString(text: string, index: Map<string, FactualitySentence>, prefix: string): React.ReactNode[] {
  const sentences = maskAbbreviations(text)
    .split(SENTENCE_SPLIT_REGEX)
    .map(unmaskAbbreviations);
  const nodes: React.ReactNode[] = [];

  sentences.forEach((sentence, i) => {
    const detail = index.get(normalizeKey(sentence));
    const isLast = i === sentences.length - 1;
    const trailingSpace = isLast ? '' : ' ';

    if (!detail) {
      nodes.push(
        <React.Fragment key={`${prefix}-${i}`}>
          {sentence}
          {trailingSpace}
        </React.Fragment>,
      );
      return;
    }

    let className: string;
    const labelText =
      detail.label === 'contradicted'
        ? 'Contraditada pelo artigo'
        : detail.label === 'supported'
          ? 'Suportada pelo artigo'
          : 'Sem confirmação direta no artigo';

    if (detail.label === 'contradicted') {
      className = 'bg-red-50 border-b-2 border-red-300';
    } else if (detail.label === 'supported') {
      className = 'bg-emerald-50 border-b-2 border-emerald-300';
    } else {
      className = 'bg-amber-50 border-b-2 border-amber-300';
    }

    const tooltipLines: string[] = [labelText];
    if (detail.category && detail.category !== 'no error') {
      tooltipLines.push(`Categoria: ${detail.category}`);
    }
    if (detail.rationale) {
      tooltipLines.push(`Justificativa: ${detail.rationale}`);
    } else if (detail.sourceSentence) {
      tooltipLines.push(`Trecho: "${detail.sourceSentence.slice(0, 200)}"`);
    }
    const tooltip = tooltipLines.join('\n');

    nodes.push(
      <span
        key={`${prefix}-${i}`}
        className={`${className} px-0.5 rounded-sm cursor-help`}
        title={tooltip}
      >
        {sentence}
      </span>,
    );
    if (trailingSpace) nodes.push(' ');
  });

  return nodes;
}

function highlightChildren(
  children: React.ReactNode,
  index: Map<string, FactualitySentence>,
  pathPrefix: string,
): React.ReactNode {
  const childArray = React.Children.toArray(children);
  return childArray.map((child, idx) => {
    if (typeof child === 'string') {
      return (
        <React.Fragment key={`${pathPrefix}-s-${idx}`}>
          {highlightString(child, index, `${pathPrefix}-s-${idx}`)}
        </React.Fragment>
      );
    }
    return child;
  });
}

export function FactualityHighlightedMarkdown({ content, factualityDetails }: Props) {
  const index = React.useMemo(() => buildIndex(factualityDetails), [factualityDetails]);
  const hasHighlights = index.size > 0;

  return (
    <>
      {hasHighlights && (
        <div className="mb-4 flex flex-wrap items-center gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-50 border border-emerald-300"></span>
            suportada pelo artigo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-amber-50 border border-amber-300"></span>
            sem confirmação direta no artigo
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-red-50 border border-red-300"></span>
            contraditada pelo artigo
          </span>
        </div>
      )}
      <div className="prose prose-gray max-w-none">
        <ReactMarkdown
          components={{
            p: ({ children }) => <p>{highlightChildren(children, index, 'p')}</p>,
            li: ({ children }) => <li>{highlightChildren(children, index, 'li')}</li>,
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </>
  );
}
