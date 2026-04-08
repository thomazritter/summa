import type { Profile, ArticleStructure } from '@summarizer/shared';

export interface ParticipantPreferences {
  structurePreference?: 'prose' | 'bullets' | 'mixed';
  readingGoal?: 'overview' | 'methodology' | 'results' | 'practical';
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

  return `${systemContext}

${instructions}

---
CONTEÚDO DO ARTIGO:
${contentSection}
---

Gere o resumo agora:`;
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

  // Reading goal instructions (from participant, not profile)
  if (participantPreferences?.readingGoal) {
    const goalInstructions: Record<NonNullable<ParticipantPreferences['readingGoal']>, string> = {
      overview: 'Objetivo do leitor: obter uma visão geral rápida. Priorize a contribuição principal e as conclusões. Seja conciso e direto.',
      methodology: 'Objetivo do leitor: entender como o estudo foi conduzido. Detalhe os métodos, procedimentos, ferramentas e métricas. Os resultados podem ser mencionados brevemente.',
      results: 'Objetivo do leitor: conhecer os achados do estudo. Apresente resultados com números, porcentagens e comparações. A metodologia pode ser resumida brevemente.',
      practical: 'Objetivo do leitor: aplicar as descobertas na prática. Destaque implicações concretas, recomendações e como os resultados podem ser usados no dia a dia.',
    };
    parts.push(goalInstructions[participantPreferences.readingGoal]);
  }

  parts.push('Estruture o resumo com parágrafos bem definidos. Comece pela contribuição principal do artigo.');

  return parts.join('\n\n');
};

const buildContentSection = (structure: ArticleStructure, rawText: string): string => {
  const parts: string[] = [];

  // Prioritize structured content if available
  if (structure.abstract) {
    parts.push(`ABSTRACT:\n${structure.abstract}`);
  }
  if (structure.introduction) {
    parts.push(`INTRODUCTION:\n${truncateText(structure.introduction, 2000)}`);
  }
  if (structure.methodology) {
    parts.push(`METHODOLOGY:\n${truncateText(structure.methodology, 2000)}`);
  }
  if (structure.results) {
    parts.push(`RESULTS:\n${truncateText(structure.results, 2000)}`);
  }
  if (structure.discussion) {
    parts.push(`DISCUSSION:\n${truncateText(structure.discussion, 1500)}`);
  }
  if (structure.conclusion) {
    parts.push(`CONCLUSION:\n${truncateText(structure.conclusion, 1000)}`);
  }

  // If no structured content, use raw text
  if (parts.length === 0) {
    parts.push(truncateText(rawText, 8000));
  }

  return parts.join('\n\n');
};

const truncateText = (text: string, maxLength: number): string => {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '... [truncated]';
};

/**
 * Get the recommended max tokens for the given depth level
 */
export const getMaxTokensForDepth = (depth: Profile['depth']): number => {
  const tokenLimits: Record<Profile['depth'], number> = {
    brief: 400,
    moderate: 800,
    detailed: 1500,
    comprehensive: 2500,
  };
  return tokenLimits[depth];
};

/**
 * Build a generic summarization prompt with no profile parameterization.
 * Used as the control condition in the experiment.
 */
export const buildGenericSummarizationPrompt = (
  articleContent: ArticleStructure,
  rawText: string
): string => {
  const contentSection = buildContentSection(articleContent, rawText);

  return `Resuma o seguinte artigo científico em português. Produza um resumo objetivo de 3-4 parágrafos cobrindo o que o artigo faz, como faz e o que encontrou. Não adapte o texto para nenhum público específico.

---
CONTEÚDO DO ARTIGO:
${contentSection}
---

Gere o resumo agora:`;
};
