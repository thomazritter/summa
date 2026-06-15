# Teste de Sensibilidade do FineSurE a Injeções Controladas

**Data:** 2026-05-15
**Autor:** Thomaz Justo Ritter
**Apêndice no TCC:** §B.X (`\label{ap:bench_injecao}`) do `main.tex`
**Script reproduzível:** `packages/api/src/scripts/finesure-injection.ts` no repositório [thomazritter/summa](https://github.com/thomazritter/summa)
**Log da execução:** `/tmp/finesure-injection.log`

---

## 1. Motivação

A análise de factualidade reportada em §6.3 do TCC mede a proporção de frases classificadas como factuais pelo FineSurE, mas isso por si só não valida que o método de fato **detecta** erros. Um avaliador que rotule indistintamente tudo como `no_error` produziria o mesmo escore. Este teste exercita o método sob condições controladas: 8 frases factualmente incorretas, redigidas manualmente para cobrir cada uma das 8 categorias da taxonomia de Song et al. (2024), são inseridas num resumo previamente avaliado como inteiramente factual.

## 2. Setup

| Item | Valor |
|---|---|
| Resumo-base | ID 108 no DB de produção (Bornmann × Mestrando) |
| Faithfulness original | 1,000 (12/12 frases supported) |
| Artigo de origem | Bornmann, Haunschild & Mutz (2021) — *Growth rates of modern science* |
| Backbone do avaliador | Llama 3.3 70B via Groq |
| Pipeline | `checkFactuality` em `packages/api/src/services/factualityChecker.ts` (versão em produção) |
| Conteúdo testado | original (12 frases) + 8 injeções = 20 frases |

## 3. As 8 injeções (texto integral)

Cada injeção foi redigida pelo autor com base em conhecimento direto do conteúdo do paper Bornmann (extração manual do abstract). As frases mantêm o estilo de prosa do resumo original para não enviesar a detecção via sinal de superfície.

### 3.1 Entity error (esperado)
**Frase injetada:**
> "A pesquisa utiliza dados das bases PubMed, Scopus, ArXiv e Dimensions para reconstruir o histórico de publicações."

**Por que é erro:** as 4 bases reais usadas no paper são Web of Science, Scopus, Microsoft Academic e Dimensions. PubMed e ArXiv não estão entre elas — duas entidades trocadas.

### 3.2 Predicate error (esperado)
**Frase injetada:**
> "Os autores demonstram que a taxa de crescimento da ciência diminuiu de forma consistente ao longo do século XX."

**Por que é erro:** o paper documenta crescimento da ciência (não diminuição) — verbo invertido.

### 3.3 Circumstantial error (esperado)
**Frase injetada:**
> "O tempo de duplicação da produção científica encontrado pelos autores é de 27,3 anos, correspondendo a uma taxa anual de 2,54%."

**Por que é erro:** números reais são 17,3 anos e 4,10% — circunstanciais (quantidades) errados.

### 3.4 Grammatical error (esperado)
**Frase injetada:**
> "Os modelo de regressão que aplicado pelos autores capturam variações em as taxa de crescimento ao longo de séculos."

**Por que é erro:** concordância grosseira — "Os modelo" (sing/plur), "que aplicado" (regência), "em as taxa" (contração faltando + concordância).

### 3.5 Coreference error (esperado)
**Frase injetada:**
> "Bornmann e Haunschild colaboraram com Mutz no desenvolvimento original das quatro bases de dados; ele é o autor principal do trabalho."

**Por que é erro:** pronome "ele" sem antecedente claro (pode referir Haunschild ou Mutz); também claim falso de que os autores desenvolveram as bases.

### 3.6 Linking error (esperado)
**Frase injetada:**
> "O período pós-guerra apresenta a menor taxa de crescimento dentre os segmentos, em decorrência direta da crise econômica de 2008."

**Por que é erro:** linkagem causal e temporal errada — pós-guerra apresenta a **maior** taxa segundo o paper; e crise de 2008 não é mencionada como causa de nenhum segmento.

### 3.7 Out-of-context error (esperado)
**Frase injetada:**
> "O estudo identifica que a inteligência artificial generativa será responsável por dobrar a produção científica global até 2030."

**Por que é erro:** conteúdo inexistente no artigo — IA generativa e projeções até 2030 não são tópicos do paper.

### 3.8 Other error (esperado)
**Frase injetada:**
> "Com base em suas descobertas, os autores propõem que o financiamento público à ciência deve ser triplicado para sustentar as taxas de crescimento observadas."

**Por que é erro:** o paper é descritivo (mede crescimento), não prescritivo. Não há proposta de política de financiamento no artigo.

## 4. Resultados

### 4.1 Métricas agregadas

| Métrica | Valor original | Valor pós-injeção | Esperado se tudo detectado |
|---|---|---|---|
| Faithfulness | 1,000 | **0,650** | 0,600 (12/20) |
| Completeness | 0,688 | 0,688 | (não afetado, mede vs abstract) |
| Conciseness | 0,583 | 0,400 | (cai pq mais frases não-keyfact) |

**Conclusão:** o escore agregado moveu-se de forma proporcional à fração contaminada (queda de 35 pontos para 40% de injeções), com discrepância de 50 milésimos atribuível à frase não detectada.

### 4.2 Detecção por categoria

| # | Categoria esperada | Detectado? | Categoria atribuída pelo FineSurE | Match exato? |
|---|---|---|---|---|
| 1 | entity | ✓ | entity | ✓ |
| 2 | predicate | ✓ | predicate | ✓ |
| 3 | circumstantial | ✓ | entity | ✗ (colapso) |
| 4 | **grammatical** | **✗** | **no_error** | **✗ (não detectado)** |
| 5 | coreference | ✓ | entity | ✗ (colapso) |
| 6 | linking | ✓ | predicate | ✗ (colapso) |
| 7 | out_of_context | ✓ | out_of_context | ✓ |
| 8 | other | ✓ | out_of_context | ✗ (colapso) |

**Detection rate: 7/8 (87,5%)**
**Category match: 3/8 (37,5%)**

### 4.3 Estabilidade do baseline

**12/12 frases originais** continuaram classificadas como `supported` após a injeção. Não houve efeito colateral da contaminação sobre o restante do texto — o método é estável e localizado.

## 5. Discussão

### 5.1 Colapso categórico

O método discrimina factualidade com confiabilidade (87,5% de recall) mas tende a agrupar erros sutis em três rótulos dominantes: `entity`, `predicate` e `out_of_context`. Os 5 erros sub-categorizados (circumstantial, coreference, linking, other) foram todos redirecionados para um desses três.

Esse padrão é coerente com a discussão de ambiguidade inter-categórica no Apêndice C do paper original de Song et al. (2024). Em termos práticos, o sistema é confiável para sinalizar **que** há erro, mas a etiqueta de **natureza** do erro deve ser lida com reserva.

### 5.2 Ponto cego para sintaxe portuguesa

A injeção gramatical ("Os modelo... em as taxa") foi classificada como `no_error`/supported. Hipótese: Llama 3.3 70B, treinado majoritariamente em corpus em inglês, tolera ruído gramatical em línguas com menor representatividade no treino e não trata má-formação sintática como sinal de problema factual.

Como o Summa gera resumos em português, este viés implica que a camada de verificação **subestima erros formais na própria língua-alvo**. Caveat registrado:
- No próprio §6.3 do TCC (parágrafo conectando ao apêndice)
- No apêndice `ap:bench_injecao` (discussão completa)
- Como direção futura: validação cross-lingual ou troca por modelo com maior cobertura de português

### 5.3 Monotonia do faithfulness

Apesar das limitações categóricas, o faithfulness é **monotônico**: cai proporcional ao número de erros injetados (1,000 → 0,650 com 7 erros detectados sobre 20 frases). Isso sustenta o uso do escore como sinal agregado de "muitos erros vs poucos erros", mesmo se cada categoria individual não bate perfeitamente.

## 6. Reprodutibilidade

**Script:** `packages/api/src/scripts/finesure-injection.ts` (no monorepo Summa)

**Como rodar:**
```bash
cd packages/api
DATABASE_URL='<url postgres>' GROQ_API_KEY='<key>' \
  npx tsx src/scripts/finesure-injection.ts
```

**Não grava no DB** — o script roda `checkFactuality` em modo observação e imprime o resultado. Pode ser re-executado quantas vezes for necessário sem efeitos colaterais.

**Determinismo:** o backbone é LLM, então rodadas podem variar levemente. Em uma re-execução, esperar:
- Detection rate na faixa de 6/8 a 8/8 (87% ± alguns pontos)
- Categorização exata raramente acima de 4/8

## 7. Caveats deste teste em si

1. **N=1 resumo, N=8 injeções:** amostra pequena, intencional pelo desenho exploratório. Não permite IC estatístico.
2. **Injeções são deliberadamente claras:** redigidas para serem detectáveis. Erros sutis (paráfrases enviesadas, omissões qualificadoras) provavelmente teriam recall menor.
3. **Categorização do autor:** o gabarito de "qual categoria esperada" é decisão do autor com base na taxonomia do paper. Algumas injeções poderiam ser argumentadas como pertencendo a múltiplas categorias.
4. **Específico ao backbone:** trocar Llama 3.3 70B por outro modelo (GPT-4o, Claude, etc.) mudaria os resultados — em particular o ponto cego gramatical em português provavelmente desapareceria com modelos com cobertura mais ampla de PT.

## 8. Referência cruzada

- **Apêndice no TCC:** §B.X `ap:bench_injecao` em `main.tex`
- **Parágrafo curto em §6.3:** logo após a caveat sobre G-Eval (`liu2023geval`)
- **Implementação FineSurE em produção:** `packages/api/src/services/factualityChecker.ts`
- **Prompts FineSurE:** `packages/api/src/services/finesure-prompts/{factChecking,keyfactExtraction,keyfactAlignment}.ts`
- **Resumos da grade T12 (incluindo o ID 108 usado aqui):** `/Users/thomazjusto/Documents/TCC/finesure_36_consolidated.csv`
