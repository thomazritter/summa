/**
 * Run quality metrics and P-Accuracy on all pre-generated summaries.
 *
 * Prerequisites:
 * - Metrics service running on port 5052 (python metrics-service.py)
 * - Summaries pre-generated in the database
 *
 * Usage:
 *   npx tsx packages/api/src/scripts/run-metrics.ts
 */

import { queryAll, closeDb } from '../db/connection.js';

const METRICS_SERVICE_URL = process.env.METRICS_SERVICE_URL || 'http://127.0.0.1:5052';

const PROFILE_NAMES: Record<number, string> = {
  99: 'generic',
  100: 'junior',
  101: 'pleno',
  102: 'senior',
};

interface SummaryRow {
  id: number;
  article_id: number;
  profile_id: number;
  content: string;
}

interface ArticleRow {
  id: number;
  title: string;
  structured_content: string;
}

async function runMetrics() {
  // Check metrics service
  try {
    const health = await fetch(`${METRICS_SERVICE_URL}/health`);
    if (!health.ok) throw new Error('not ok');
    console.log('Metrics service: OK\n');
  } catch {
    console.error('ERRO: Metrics service nao esta rodando em', METRICS_SERVICE_URL);
    console.error('Inicie com: cd packages/api/python-services && python metrics-service.py');
    process.exit(1);
  }

  const articles = await queryAll<ArticleRow>('SELECT id, title, structured_content FROM articles');
  const summaries = await queryAll<SummaryRow>(
    'SELECT id, article_id, profile_id, content FROM summaries WHERE profile_id IN (99, 100, 101, 102) ORDER BY article_id, profile_id'
  );

  if (summaries.length === 0) {
    console.error('Nenhum resumo encontrado. Execute pregenerate.ts primeiro.');
    process.exit(1);
  }

  console.log(`Encontrados ${summaries.length} resumos para ${articles.length} artigo(s).\n`);

  // ─── 1. Quality metrics (ROUGE + BERTScore) per summary ──────────

  console.log('═══ METRICAS DE QUALIDADE (ROUGE + BERTScore) ═══\n');

  for (const article of articles) {
    const sc = JSON.parse(article.structured_content);
    const reference = sc.abstract || '';

    if (!reference) {
      console.log(`Artigo ${article.id}: sem abstract para referencia, pulando ROUGE/BERTScore.\n`);
      continue;
    }

    console.log(`─── Artigo ${article.id}: ${article.title} ───\n`);

    const articleSummaries = summaries.filter(s => s.article_id === article.id);

    // Batch request
    const items = articleSummaries.map(s => ({
      id: s.id,
      summary: s.content,
      reference,
    }));

    try {
      const response = await fetch(`${METRICS_SERVICE_URL}/quality/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, compute_bert_score: true }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as {
        results: Array<{
          id: number;
          rouge: Record<string, { precision: number; recall: number; f1: number }>;
          bert_score?: { precision: number; recall: number; f1: number };
        }>;
      };

      // Print results table
      console.log('Perfil        | ROUGE-1 F1 | ROUGE-2 F1 | ROUGE-L F1 | BERTScore F1');
      console.log('─────────────────────────────────────────────────────────────────────');

      for (const result of data.results) {
        const summary = articleSummaries.find(s => s.id === result.id);
        const profileName = summary ? (PROFILE_NAMES[summary.profile_id] || `id:${summary.profile_id}`) : '?';
        const r1 = result.rouge.rouge1.f1.toFixed(4);
        const r2 = result.rouge.rouge2.f1.toFixed(4);
        const rL = result.rouge.rougeL.f1.toFixed(4);
        const bs = result.bert_score ? result.bert_score.f1.toFixed(4) : 'N/A';
        console.log(`${profileName.padEnd(14)}| ${r1}     | ${r2}     | ${rL}     | ${bs}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Erro ao computar metricas para artigo ${article.id}:`, error);
    }
  }

  // ─── 2. P-Accuracy per article ───────────────────────────────────

  console.log('═══ P-ACCURACY (SENSIBILIDADE A PERSONALIZACAO) ═══\n');

  for (const article of articles) {
    console.log(`─── Artigo ${article.id}: ${article.title} ───\n`);

    const articleSummaries = summaries.filter(s => s.article_id === article.id);

    const summariesPayload = articleSummaries.map(s => ({
      profile: PROFILE_NAMES[s.profile_id] || `id:${s.profile_id}`,
      content: s.content,
    }));

    try {
      const response = await fetch(`${METRICS_SERVICE_URL}/p-accuracy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article_id: article.id, summaries: summariesPayload }),
      });

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json() as {
        p_accuracy_rouge: number;
        p_accuracy_bert: number | null;
        avg_pairwise_rouge_l: number;
        avg_pairwise_bert_f1: number | null;
        pairwise_rouge: Array<{ pair: string[]; rouge_l_f1: number }>;
        pairwise_bert: Array<{ pair: string[]; bert_f1: number }>;
        interpretation: string;
      };

      console.log(`P-Accuracy (ROUGE): ${data.p_accuracy_rouge}`);
      if (data.p_accuracy_bert !== null) {
        console.log(`P-Accuracy (BERT):  ${data.p_accuracy_bert}`);
      }
      console.log(`Interpretacao: ${data.interpretation}`);
      console.log('');

      console.log('Pares               | ROUGE-L F1 | BERTScore F1');
      console.log('────────────────────────────────────────────────');
      for (let i = 0; i < data.pairwise_rouge.length; i++) {
        const pair = data.pairwise_rouge[i];
        const bert = data.pairwise_bert[i];
        const pairName = `${pair.pair[0]} vs ${pair.pair[1]}`;
        const bertVal = bert ? bert.bert_f1.toFixed(4) : 'N/A';
        console.log(`${pairName.padEnd(20)}| ${pair.rouge_l_f1.toFixed(4)}     | ${bertVal}`);
      }
      console.log('');
    } catch (error) {
      console.error(`Erro ao computar P-Accuracy para artigo ${article.id}:`, error);
    }
  }

  console.log('Metricas concluidas!');
  await closeDb();
  process.exit(0);
}

runMetrics().catch(async (err) => {
  console.error('Erro:', err);
  await closeDb();
  process.exit(1);
});
