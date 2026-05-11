import type { Profile, ArticleStructure } from '@summarizer/shared';

export interface ParticipantPreferences {
  structurePreference?: 'prose' | 'bullets' | 'mixed';
  domain?: string;
  currentProject?: string;
}

export const buildSummarizationPrompt = (
  profile: Profile,
  articleContent: ArticleStructure,
  rawText: string,
  participantPreferences?: ParticipantPreferences
): string => {
  const systemContext = buildSystemContext(profile);
  const contentSection = buildContentSection(articleContent, rawText);
  const instructions = buildInstructions(profile, participantPreferences);

  // Three-block prose layout (variant V0 in the prompt-variant benchmark of
  // §6.6 of the thesis): a single continuous instruction without structural
  // markup. Empirically led to the highest factuality score across the
  // tested variants and is the simplest design — no dependency on XML tags,
  // no decomposition into multiple LLM calls.
  return `${systemContext}

Considere as seguintes diretivas derivadas do perfil do leitor:

${instructions}

A seguir, o artigo a ser resumido:

${contentSection}

Gere o resumo personalizado conforme as diretivas acima, ancorando todas as afirmações no conteúdo do artigo. Responda apenas com o texto do resumo.`;
};

const buildSystemContext = (profile: Profile): string => {
  const contextDescriptions: Record<Profile['context'], string> = {
    quick_review: 'O leitor busca uma visão rápida para decidir se vale a pena ler o artigo completo.',
    learning: 'O leitor está estudando o tema e quer entender o conteúdo de forma didática.',
    research: 'O leitor é um pesquisador avaliando o trabalho para fins de pesquisa ou revisão.',
    teaching: 'O leitor pretende usar o conteúdo para fins de ensino ou apresentação.',
  };

  return `Você é um assistente especializado em resumir artigos científicos de forma personalizada para diferentes públicos. Gere o resumo inteiramente em português.

Contexto do leitor: ${contextDescriptions[profile.context]}`;
};

const buildInstructions = (profile: Profile, participantPreferences?: ParticipantPreferences): string => {
  const parts: string[] = [];

  // Expertise instructions (matches thesis examples - main.tex lines 670-690)
  const expertiseInstructions: Record<Profile['expertise'], string> = {
    beginner: 'O leitor é iniciante neste tema. Explique as ideias principais de forma acessível, como se estivesse explicando para alguém que nunca leu sobre o assunto. Evite jargões técnicos — quando usar um termo técnico, defina-o brevemente entre parênteses. Destaque primeiro o problema que o artigo tenta resolver e por que isso importa, antes de apresentar como os autores fizeram e o que encontraram. Use frases curtas e parágrafos bem separados.',
    intermediate: 'O leitor tem conhecimento moderado da área. Apresente um resumo equilibrado que cubra: (1) o problema investigado, (2) a metodologia usada com detalhes sobre como o estudo foi conduzido, (3) os principais resultados com dados quantitativos quando disponíveis, e (4) as conclusões e implicações. Use terminologia técnica moderada sem explicar conceitos básicos, mas mantenha o texto fluido e organizado.',
    advanced: 'O leitor é experiente na área. Produza um resumo técnico e analítico cobrindo: (1) a contribuição específica em relação ao estado da arte, (2) a metodologia detalhada incluindo escala do estudo, métricas e procedimentos, (3) resultados quantitativos com números específicos e comparações, (4) limitações e ameaças à validade, e (5) implicações para pesquisa e prática. Utilize terminologia técnica precisa. Inclua nuances e pontos de discussão relevantes.',
    expert: 'O leitor é especialista. Produza um resumo técnico denso e crítico focando em: contribuições originais em relação a trabalhos anteriores, decisões metodológicas e suas justificativas, lacunas no desenho experimental, validade das conclusões com base nos dados apresentados, e posicionamento no estado da arte. Assuma domínio completo da terminologia.',
  };
  parts.push(expertiseInstructions[profile.expertise]);

  // Focus instructions
  const focusInstructions: Record<Profile['focus'], string> = {
    concepts: 'Foco principal: conceitos e ideias centrais. Explique o problema que o artigo aborda e as ideias propostas. A metodologia e os resultados podem ser mencionados brevemente, mas o centro do resumo deve ser conceitual.',
    methodology: 'Foco principal: metodologia. Descreva em detalhe como o estudo foi conduzido — participantes, procedimentos, ferramentas, métricas, escala. Os resultados devem ser mencionados, mas o centro do resumo é o "como foi feito".',
    results: 'Foco principal: resultados. Apresente os achados com números específicos, porcentagens e comparações. A metodologia pode ser mencionada brevemente para contextualizar, mas o centro do resumo são os dados e descobertas.',
    applications: 'Foco principal: aplicações práticas. Destaque as implicações concretas dos resultados, o que muda na prática, e como as descobertas podem ser aplicadas.',
    all: 'Cubra de forma equilibrada: problema/conceitos, metodologia, resultados quantitativos e implicações práticas. Nenhum aspecto deve dominar o resumo.',
  };
  parts.push(focusInstructions[profile.focus]);

  // Depth instructions — with explicit length guidance
  const depthInstructions: Record<Profile['depth'], string> = {
    brief: 'Extensão: breve (1-2 parágrafos curtos). Apenas os pontos essenciais.',
    moderate: 'Extensão: moderada (3-4 parágrafos). Pontos principais com alguns detalhes de suporte.',
    detailed: 'Extensão: detalhada (5-7 parágrafos). Inclua explicações complementares, contexto e detalhes relevantes. Não encurte — o leitor quer profundidade.',
    comprehensive: 'Extensão: abrangente (7-10 parágrafos). Cubra todos os aspectos relevantes com profundidade. Inclua detalhes, números, contexto e discussão.',
  };
  parts.push(depthInstructions[profile.depth]);

  // Structure preference instructions (from participant, not profile)
  if (participantPreferences?.structurePreference) {
    const structureInstructions: Record<NonNullable<ParticipantPreferences['structurePreference']>, string> = {
      prose: 'Formato: escreva em parágrafos corridos e fluidos. Não use bullet points ou listas.',
      bullets: 'Formato: organize as informações em tópicos e bullet points. Use listas para pontos principais, resultados e conclusões. Minimize parágrafos longos.',
      mixed: 'Formato: combine parágrafos explicativos com bullet points para dados, resultados e listas de contribuições. Use parágrafos para contexto e listas para pontos objetivos.',
    };
    parts.push(structureInstructions[participantPreferences.structurePreference]);
  }

  if (participantPreferences?.domain) {
    parts.push(`Domínio profissional do leitor: ${participantPreferences.domain}. Quando possível, relacione os conceitos e resultados do artigo com este domínio.`);
  }

  if (participantPreferences?.currentProject) {
    parts.push(`O leitor está trabalhando em: ${participantPreferences.currentProject}. Contextualize o resumo destacando aspectos do artigo que possam ser relevantes para este projeto.`);
  }

  parts.push('Estruture o resumo com parágrafos bem definidos. Comece pela contribuição principal do artigo.');

  return parts.join('\n\n');
};

const buildContentSection = (structure: ArticleStructure, rawText: string): string => {
  // Always send the full raw text. Section extraction by LLM/regex is imperfect
  // and historically dropped methodology/results/discussion/conclusion when the
  // structurer caught only abstract+introduction. The 128K context window of
  // current models comfortably fits any scientific article, and the
  // structuredContent is still used elsewhere (ROUGE reference selection, NLI
  // anchor retrieval) — only the summarizer prompt receives the whole document.
  // A short header lists the sections the structurer identified so the model has
  // a navigational hint without us duplicating content.
  const detectedSections = [
    structure.abstract && 'abstract',
    structure.introduction && 'introduction',
    structure.methodology && 'methodology',
    structure.results && 'results',
    structure.discussion && 'discussion',
    structure.conclusion && 'conclusion',
  ].filter(Boolean) as string[];

  if (detectedSections.length === 0) {
    return rawText;
  }

  return `Seções detectadas pelo pré-processamento: ${detectedSections.join(', ')}.

Texto completo do artigo:
${rawText}`;
};

/**
 * Safety ceiling for token output. The actual summary length is controlled
 * by the prompt instructions (e.g. "2-3 parágrafos"). This is just a
 * hard limit to prevent runaway generation — same for all depths.
 */
export const getMaxOutputTokens = (): number => {
  return 8192;
};

/**
 * Build a generic summarization prompt with no profile parameterization.
 * Used as the control condition in the experiment.
 */
export const buildGenericSummarizationPrompt = (
  articleContent: ArticleStructure,
  rawText: string,
): string => {
  const contentSection = buildContentSection(articleContent, rawText);

  return `<role>
Você é um assistente especializado em resumir artigos científicos. Resuma o seguinte artigo em português. Produza um resumo objetivo de 3-4 parágrafos cobrindo o que o artigo faz, como faz e o que encontrou. Não adapte o texto para nenhum público específico.
</role>

<article>
${contentSection}
</article>

<task>
Gere o resumo agora, ancorando todas as afirmações no conteúdo de <article>. Responda apenas com o texto do resumo, sem repetir as tags.
</task>`;
};
