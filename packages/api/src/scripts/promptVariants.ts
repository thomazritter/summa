/**
 * Prompt variants for the empirical ablation study.
 *
 * Each variant takes (profile, articleStructure, rawText, llmCall) and returns
 * the generated summary content. V0 is the production baseline; the others
 * isolate one design lever each, following the recommendations of recent
 * personalized-summarization literature:
 *
 * - V0  current 3-block prose with explicit numeric depth targets
 *       (retkowski2024lengthcontrol).
 * - V1  V0 minus the profile-derived directives — isolates the contribution
 *       of personalization (vs richardson2024guidedprofile).
 * - V2  V0 reformatted with XML tags around role / profile / article
 *       (he2024doespromptformat; Anthropic XML guidance).
 * - V3  guided-profile chain-of-thought: model first writes a 2-sentence
 *       reader description, then summarizes conditioned on it
 *       (richardson2024guidedprofile).
 * - V4  V0 + cross-lingual grounding scaffold: identify EN claims, then
 *       render in PT, omitting unsupported claims
 *       (ladhak2024factuality, qin2024multilingualpromptsurvey).
 */

import type { Profile, ArticleStructure } from '@summarizer/shared';

export type VariantId = 'V0' | 'V1' | 'V2' | 'V3' | 'V4';

export const VARIANT_LABELS: Record<VariantId, string> = {
  V0: 'baseline (3-block prose with numeric depth)',
  V1: 'no profile (role + grounding only)',
  V2: 'XML-tagged profile',
  V3: 'guided-profile chain-of-thought',
  V4: 'V0 + cross-lingual grounding scaffold',
};

export type LlmCall = (prompt: string, opts: { temperature: number; maxTokens: number; model?: string }) => Promise<string>;

const CONTEXT_TEXT: Record<Profile['context'], string> = {
  quick_review: 'O leitor busca uma visão rápida para decidir se vale a pena ler o artigo completo.',
  learning: 'O leitor está estudando o tema e quer entender o conteúdo de forma didática.',
  research: 'O leitor é um pesquisador avaliando o trabalho para fins de pesquisa ou revisão.',
  teaching: 'O leitor pretende usar o conteúdo para fins de ensino ou apresentação.',
};

const EXPERTISE_TEXT: Record<Profile['expertise'], string> = {
  beginner: 'O leitor é iniciante neste tema. Explique as ideias principais de forma acessível, evitando jargões e definindo termos técnicos quando necessário. Destaque primeiro o problema que o artigo tenta resolver.',
  intermediate: 'O leitor tem conhecimento moderado da área. Apresente um resumo equilibrado cobrindo problema, metodologia, resultados quantitativos e conclusões. Use terminologia técnica moderada sem explicar conceitos básicos.',
  advanced: 'O leitor é experiente na área. Produza um resumo técnico cobrindo a contribuição em relação ao estado da arte, metodologia detalhada com escala e métricas, resultados quantitativos com números específicos, limitações e implicações. Utilize terminologia técnica precisa.',
  expert: 'O leitor é especialista. Produza um resumo técnico denso e crítico focando em contribuições originais, decisões metodológicas e suas justificativas, lacunas no desenho experimental e validade das conclusões. Assuma domínio completo da terminologia.',
};

const FOCUS_TEXT: Record<Profile['focus'], string> = {
  concepts: 'Foco principal: conceitos e ideias centrais. Explique o problema que o artigo aborda e as ideias propostas.',
  methodology: 'Foco principal: metodologia. Descreva em detalhe como o estudo foi conduzido — participantes, procedimentos, ferramentas, métricas, escala.',
  results: 'Foco principal: resultados. Apresente os achados com números específicos, porcentagens e comparações.',
  applications: 'Foco principal: aplicações práticas. Destaque as implicações concretas dos resultados e como podem ser aplicadas.',
  all: 'Cubra de forma equilibrada: problema/conceitos, metodologia, resultados quantitativos e implicações práticas.',
};

// Numeric depth targets per retkowski2024lengthcontrol
const DEPTH_TEXT: Record<Profile['depth'], string> = {
  brief: 'Extensão: breve — 1 a 2 parágrafos curtos, aproximadamente 100 palavras. Apenas os pontos essenciais.',
  moderate: 'Extensão: moderada — 3 a 4 parágrafos, aproximadamente 250 palavras. Pontos principais com alguns detalhes de suporte.',
  detailed: 'Extensão: detalhada — 5 a 7 parágrafos, aproximadamente 500 palavras. Inclua explicações complementares, contexto e detalhes relevantes.',
  comprehensive: 'Extensão: abrangente — 7 a 10 parágrafos, aproximadamente 900 palavras. Cubra todos os aspectos relevantes com profundidade.',
};

const buildContentBlock = (rawText: string): string => `Texto completo do artigo:\n${rawText}`;

const buildProfileBlock = (profile: Profile): string => {
  const parts = [
    EXPERTISE_TEXT[profile.expertise],
    FOCUS_TEXT[profile.focus],
    DEPTH_TEXT[profile.depth],
    'Estruture o resumo com parágrafos bem definidos, começando pela contribuição principal do artigo.',
  ];
  return parts.join('\n\n');
};

const buildSystemBlock = (profile: Profile): string =>
  `Você é um assistente especializado em resumir artigos científicos de forma personalizada para diferentes públicos. Gere o resumo inteiramente em português.\n\nContexto do leitor: ${CONTEXT_TEXT[profile.context]}`;

// ─── V0 — baseline ──────────────────────────────────────────────────

export const buildV0: (p: Profile, _s: ArticleStructure, r: string) => string = (profile, _structure, rawText) => `${buildSystemBlock(profile)}

${buildProfileBlock(profile)}

---
CONTEÚDO DO ARTIGO:
${buildContentBlock(rawText)}
---

Gere o resumo agora:`;

// ─── V1 — no profile (role + grounding only) ────────────────────────

export const buildV1: (p: Profile, _s: ArticleStructure, r: string) => string = (_profile, _structure, rawText) => `Você é um assistente especializado em resumir artigos científicos. Resuma o seguinte artigo em português, baseando-se exclusivamente no conteúdo apresentado e evitando afirmações sem suporte direto no texto. Estruture o resumo com parágrafos bem definidos, começando pela contribuição principal do artigo.

---
CONTEÚDO DO ARTIGO:
${buildContentBlock(rawText)}
---

Gere o resumo agora:`;

// ─── V2 — XML-tagged ────────────────────────────────────────────────

export const buildV2: (p: Profile, _s: ArticleStructure, r: string) => string = (profile, _structure, rawText) => `<role>
${buildSystemBlock(profile)}
</role>

<profile>
<expertise>${profile.expertise}</expertise>
<focus>${profile.focus}</focus>
<depth>${profile.depth}</depth>
<context>${profile.context}</context>
<directives>
${buildProfileBlock(profile)}
</directives>
</profile>

<article>
${rawText}
</article>

<task>
Gere o resumo personalizado conforme as diretivas em <profile>, ancorando todas as afirmações no conteúdo de <article>. Responda apenas com o texto do resumo, sem repetir as tags.
</task>`;

// ─── V3 — guided-profile CoT (2 calls) ──────────────────────────────

export const generateV3 = async (
  profile: Profile,
  _structure: ArticleStructure,
  rawText: string,
  llmCall: LlmCall,
): Promise<string> => {
  const profilePrompt = `Considerando as dimensões abaixo, descreva em duas frases curtas, em português, o leitor ideal para este artigo: o que ele já sabe, o que ele busca, e qual estilo de resumo melhor o atenderia. Responda apenas com a descrição.

- expertise: ${profile.expertise}
- foco: ${profile.focus}
- profundidade: ${profile.depth}
- contexto de leitura: ${profile.context}

DESCRIÇÃO DO LEITOR:`;

  const readerDescription = (await llmCall(profilePrompt, { temperature: 0.3, maxTokens: 200 })).trim();

  const summaryPrompt = `Você é um assistente especializado em resumir artigos científicos de forma personalizada. Gere o resumo inteiramente em português.

DESCRIÇÃO DO LEITOR-ALVO (gerada na etapa anterior — use como referência ao decidir o tom, foco e profundidade):
${readerDescription}

DIRETIVAS DERIVADAS DO PERFIL:
${buildProfileBlock(profile)}

---
CONTEÚDO DO ARTIGO:
${buildContentBlock(rawText)}
---

Gere o resumo personalizado agora, mantendo coerência com a descrição do leitor-alvo:`;

  return llmCall(summaryPrompt, { temperature: 0.3, maxTokens: 8192 });
};

// ─── V4 — V0 + cross-lingual grounding scaffold ─────────────────────

export const buildV4: (p: Profile, _s: ArticleStructure, r: string) => string = (profile, _structure, rawText) => `${buildSystemBlock(profile)}

${buildProfileBlock(profile)}

INSTRUÇÕES DE FIDELIDADE (siga obrigatoriamente):
1. Antes de redigir, identifique mentalmente as principais alegações do artigo no idioma original (inglês), incluindo metodologia, resultados quantitativos e conclusões.
2. Para cada alegação que pretende incluir no resumo em português, confirme que ela está apoiada de forma direta por trechos específicos do artigo.
3. Caso uma alegação não esteja explicitamente suportada pelo texto, omita-a — não introduza afirmações além do que o conteúdo sustenta.
4. Mantenha o estilo e a profundidade pedidos pelas diretivas do perfil acima.

---
CONTEÚDO DO ARTIGO:
${buildContentBlock(rawText)}
---

Gere o resumo agora:`;

// ─── Dispatch helper ────────────────────────────────────────────────

export const generateForVariant = async (
  variant: VariantId,
  profile: Profile,
  structure: ArticleStructure,
  rawText: string,
  llmCall: LlmCall,
): Promise<string> => {
  if (variant === 'V3') {
    return generateV3(profile, structure, rawText, llmCall);
  }
  const builder = { V0: buildV0, V1: buildV1, V2: buildV2, V4: buildV4 }[variant];
  const prompt = builder(profile, structure, rawText);
  return llmCall(prompt, { temperature: 0.3, maxTokens: 8192 });
};
