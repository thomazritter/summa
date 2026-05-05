import { buildSummarizationPrompt, buildGenericSummarizationPrompt, getMaxOutputTokens } from '../services/promptBuilder.js';
import { generateCompletion } from '../services/groqClient.js';
import { query, queryOne, queryAll, closeDb } from '../db/connection.js';

const PROFILES = [
  { id: 99, name: 'Genérico', expertise: 'intermediate' as const, focus: 'all' as const, depth: 'moderate' as const, context: 'learning' as const },
  { id: 100, name: 'Júnior', expertise: 'beginner' as const, focus: 'concepts' as const, depth: 'moderate' as const, context: 'learning' as const },
  { id: 101, name: 'Pleno', expertise: 'intermediate' as const, focus: 'methodology' as const, depth: 'detailed' as const, context: 'research' as const },
  { id: 102, name: 'Sênior', expertise: 'advanced' as const, focus: 'results' as const, depth: 'comprehensive' as const, context: 'research' as const },
];

async function main() {
  const articles = await queryAll('SELECT id, title, raw_text, structured_content FROM articles ORDER BY id');
  
  for (const article of articles as any[]) {
    const sc = JSON.parse(article.structured_content);
    console.log('\n=== Article', article.id, ':', article.title, '===');
    
    for (const profile of PROFILES) {
      let prompt: string;
      if (profile.id === 99) {
        prompt = buildGenericSummarizationPrompt(sc, article.raw_text);
      } else {
        prompt = buildSummarizationPrompt(profile as any, sc, article.raw_text);
      }
      
      const maxTokens = getMaxOutputTokens();
      
      console.log('  Generating for', profile.name, '(maxTokens:', maxTokens, ')...');

      // Wait between calls to respect Groq rate limits (6K TPM on free tier)
      await new Promise(r => setTimeout(r, 30000));

      let content = '';
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          content = await generateCompletion({ prompt, temperature: 0.3, maxTokens });
          break;
        } catch (e: any) {
          if (e.statusCode === 429 && attempt < 2) {
            console.log('    Rate limited, waiting 60s...');
            await new Promise(r => setTimeout(r, 60000));
          } else {
            throw e;
          }
        }
      }
      if (!content) throw new Error('Failed to generate after 3 attempts');
      
      const existing = await queryOne('SELECT id FROM summaries WHERE article_id = $1 AND profile_id = $2 ORDER BY id LIMIT 1', [article.id, profile.id]);
      if (existing) {
        await query('UPDATE summaries SET content = $1 WHERE id = $2', [content, (existing as any).id]);
        console.log('    Updated id', (existing as any).id, '— length:', content.length);
      } else {
        const row = await queryOne('INSERT INTO summaries (article_id, profile_id, content) VALUES ($1, $2, $3) RETURNING id', [article.id, profile.id, content]);
        console.log('    Created id', (row as any).id, '— length:', content.length);
      }
    }
  }
  
  await closeDb();
  console.log('\nDone!');
}

main().catch(e => { console.error(e); process.exit(1); });
