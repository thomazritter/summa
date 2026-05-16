import React from 'react';
import ReactMarkdown from 'react-markdown';

export interface FactualitySentence {
  sentence: string;
  label: 'supported' | 'neutral' | 'contradicted';
  confidence: number;
  category: string;
  rationale: string;
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

const DOT_PLACEHOLDER = String.fromCharCode(3);

function maskAbbreviations(text: string): string {
  return text.replace(ABBREV_REGEX, (m) => m.replace('.', DOT_PLACEHOLDER));
}

function unmaskAbbreviations(text: string): string {
  return text.split(DOT_PLACEHOLDER).join('.');
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

const LABEL_TEXT: Record<FactualitySentence['label'], string> = {
  supported: 'Suportada pelo artigo',
  contradicted: 'Contraditada pelo artigo',
  neutral: 'Sem confirmação direta no artigo',
};

const SPAN_CLASS: Record<FactualitySentence['label'], string> = {
  supported: 'bg-emerald-50 border-b-2 border-emerald-300',
  contradicted: 'bg-red-50 border-b-2 border-red-300',
  neutral: 'bg-amber-50 border-b-2 border-amber-300',
};

const POPOVER_HEADER_CLASS: Record<FactualitySentence['label'], string> = {
  supported: 'text-emerald-700',
  contradicted: 'text-red-700',
  neutral: 'text-amber-700',
};

function HighlightedSentence({ detail, sentence }: { detail: FactualitySentence; sentence: string }) {
  const showCategory = detail.category && detail.category !== 'no error';
  return (
    <span className={`relative inline group ${SPAN_CLASS[detail.label]} px-0.5 rounded-sm cursor-help`}>
      {sentence}
      <span
        role="tooltip"
        className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-72 max-w-[90vw] bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs text-gray-700 leading-snug whitespace-normal text-left"
      >
        <span className={`block font-semibold mb-1 ${POPOVER_HEADER_CLASS[detail.label]}`}>
          {LABEL_TEXT[detail.label]}
        </span>
        {showCategory && (
          <span className="block mb-1">
            <span className="font-medium text-gray-900">Categoria FineSurE: </span>
            {detail.category}
          </span>
        )}
        {detail.rationale && (
          <span className="block">
            <span className="font-medium text-gray-900">Justificativa: </span>
            {detail.rationale}
          </span>
        )}
      </span>
    </span>
  );
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

    nodes.push(
      <HighlightedSentence key={`${prefix}-${i}`} detail={detail} sentence={sentence} />,
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
          <span className="text-gray-400">· passe o cursor sobre uma frase destacada para ver a justificativa</span>
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
