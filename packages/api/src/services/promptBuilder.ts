import type { Profile } from '@summarizer/shared';

export interface ParticipantPreferences {
  structurePreference?: 'prose' | 'bullets' | 'mixed';
  domain?: string;
  currentProject?: string;
}

/** Hard ceiling for LLM output; actual length is driven by depth directives in the prompt. */
export const MAX_SUMMARY_OUTPUT_TOKENS = 8192;

const CONTEXT_DESCRIPTIONS: Record<Profile['context'], string> = {
  quick_review: 'O leitor busca uma visão rápida para decidir se vale a pena ler o artigo completo.',
  learning: 'O leitor está estudando o tema e quer entender o conteúdo de forma didática.',
  research: 'O leitor é um pesquisador avaliando o trabalho para fins de pesquisa ou revisão.',
  teaching: 'O leitor pretende usar o conteúdo para fins de ensino ou apresentação.',
};

const EXPERTISE_INSTRUCTIONS: Record<Profile['expertise'], string> = {
  beginner:
    'O leitor é iniciante neste tema. Explique as ideias principais de forma acessível, como se estivesse explicando para alguém que nunca leu sobre o assunto. Evite jargões técnicos — quando usar um termo técnico, defina-o brevemente entre parênteses. Destaque primeiro o problema que o artigo tenta resolver e por que isso importa, antes de apresentar como os autores fizeram e o que encontraram. Use frases curtas e parágrafos bem separados.',
  intermediate:
    'O leitor tem conhecimento moderado da área. Apresente um resumo equilibrado que cubra: (1) o problema investigado, (2) a metodologia usada com detalhes sobre como o estudo foi conduzido, (3) os principais resultados com dados quantitativos quando disponíveis, e (4) as conclusões e implicações. Use terminologia técnica moderada sem explicar conceitos básicos, mas mantenha o texto fluido e organizado.',
  advanced:
    'O leitor é experiente na área. Produza um resumo técnico e analítico cobrindo: (1) a contribuição específica em relação ao estado da arte, (2) a metodologia detalhada incluindo escala do estudo, métricas e procedimentos, (3) resultados quantitativos com números específicos e comparações, (4) limitações e ameaças à validade, e (5) implicações para pesquisa e prática. Utilize terminologia técnica precisa. Inclua nuances e pontos de discussão relevantes.',
  expert:
    'O leitor é especialista. Produza um resumo técnico denso e crítico focando em: contribuições originais em relação a trabalhos anteriores, decisões metodológicas e suas justificativas, lacunas no desenho experimental, validade das conclusões com base nos dados apresentados, e posicionamento no estado da arte. Assuma domínio completo da terminologia.',
};

const FOCUS_INSTRUCTIONS: Record<Profile['focus'], string> = {
  concepts:
    'Foco principal: conceitos e ideias centrais. Explique o problema que o artigo aborda e as ideias propostas. A metodologia e os resultados podem ser mencionados brevemente, mas o centro do resumo deve ser conceitual.',
  methodology:
    'Foco principal: metodologia. Descreva em detalhe como o estudo foi conduzido — participantes, procedimentos, ferramentas, métricas, escala. Os resultados devem ser mencionados, mas o centro do resumo é o "como foi feito".',
  results:
    'Foco principal: resultados. Apresente os achados com números específicos, porcentagens e comparações. A metodologia pode ser mencionada brevemente para contextualizar, mas o centro do resumo são os dados e descobertas.',
  applications:
    'Foco principal: aplicações práticas. Destaque as implicações concretas dos resultados, o que muda na prática, e como as descobertas podem ser aplicadas.',
  all: 'Cubra de forma equilibrada: problema/conceitos, metodologia, resultados quantitativos e implicações práticas. Nenhum aspecto deve dominar o resumo.',
};

const DEPTH_INSTRUCTIONS: Record<Profile['depth'], string> = {
  brief: 'Extensão: breve (1-2 parágrafos curtos). Apenas os pontos essenciais.',
  moderate: 'Extensão: moderada (3-4 parágrafos). Pontos principais com alguns detalhes de suporte.',
  detailed:
    'Extensão: detalhada (5-7 parágrafos). Inclua explicações complementares, contexto e detalhes relevantes. Não encurte — o leitor quer profundidade.',
  comprehensive:
    'Extensão: abrangente (7-10 parágrafos). Cubra todos os aspectos relevantes com profundidade. Inclua detalhes, números, contexto e discussão.',
};

const STRUCTURE_INSTRUCTIONS: Record<NonNullable<ParticipantPreferences['structurePreference']>, string> = {
  prose: 'Formato: escreva em parágrafos corridos e fluidos. Não use bullet points ou listas.',
  bullets:
    'Formato: organize as informações em tópicos e bullet points. Use listas para pontos principais, resultados e conclusões. Minimize parágrafos longos.',
  mixed:
    'Formato: combine parágrafos explicativos com bullet points para dados, resultados e listas de contribuições. Use parágrafos para contexto e listas para pontos objetivos.',
};

const buildDirectives = (profile: Profile, participantPreferences?: ParticipantPreferences): string => {
  const parts = [
    EXPERTISE_INSTRUCTIONS[profile.expertise],
    FOCUS_INSTRUCTIONS[profile.focus],
    DEPTH_INSTRUCTIONS[profile.depth],
  ];

  if (participantPreferences?.structurePreference) {
    parts.push(STRUCTURE_INSTRUCTIONS[participantPreferences.structurePreference]);
  }
  if (participantPreferences?.domain) {
    parts.push(
      `Domínio profissional do leitor: ${participantPreferences.domain}. Quando possível, relacione os conceitos e resultados do artigo com este domínio.`,
    );
  }
  if (participantPreferences?.currentProject) {
    parts.push(
      `O leitor está trabalhando em: ${participantPreferences.currentProject}. Contextualize o resumo destacando aspectos do artigo que possam ser relevantes para este projeto.`,
    );
  }
  if (!participantPreferences?.structurePreference) {
    parts.push('Estruture o resumo com parágrafos bem definidos.');
  }
  parts.push('Comece pela contribuição principal do artigo.');

  return parts.join('\n\n');
};

export const buildSummarizationPrompt = (
  profile: Profile,
  rawText: string,
  participantPreferences?: ParticipantPreferences,
): string => {
  const role = `Você é um assistente especializado em resumir artigos científicos de forma personalizada para diferentes públicos. Gere o resumo inteiramente em português.

Contexto do leitor: ${CONTEXT_DESCRIPTIONS[profile.context]}`;

  const directives = buildDirectives(profile, participantPreferences);

  // XML-tagged layout (variant V2 in the prompt-variant benchmark of the
  // thesis appendix). Identified empirically as the best-performing variant
  // under FineSurE 3-dim: structural delimiters around role, profile, and
  // article reduce the model's tendency to mix personalization instructions
  // with source-text content, leading to higher faithfulness scores while
  // preserving personalization. Adopted as the production prompt after the
  // human experiment of Cap.6, which ran under the prior V0 (3-block prose)
  // configuration.
  return `<role>
${role}
</role>

<profile>
<expertise>${profile.expertise}</expertise>
<focus>${profile.focus}</focus>
<depth>${profile.depth}</depth>
<context>${profile.context}</context>
<directives>
${directives}
</directives>
</profile>

<article>
${rawText}
</article>

<task>
Gere o resumo personalizado conforme as diretivas em <profile>, ancorando todas as afirmações no conteúdo de <article>. Responda apenas com o texto do resumo, sem repetir as tags.
</task>`;
};

/**
 * Generic summarization prompt with no profile parameterization.
 * Used as the control condition in the experiment.
 */
export const buildGenericSummarizationPrompt = (rawText: string): string => {
  return `<role>
Você é um assistente especializado em resumir artigos científicos. Resuma o seguinte artigo em português. Produza um resumo objetivo de 3-4 parágrafos cobrindo o que o artigo faz, como faz e o que encontrou. Não adapte o texto para nenhum público específico.
</role>

<article>
${rawText}
</article>

<task>
Gere o resumo agora, ancorando todas as afirmações no conteúdo de <article>. Responda apenas com o texto do resumo, sem repetir as tags.
</task>`;
};
