import { generateGenericSummary } from '../services/summarizationService.js';
import { queryAll, closeDb } from '../db/connection.js';

async function main() {
  const articles = await queryAll('SELECT id, title FROM articles ORDER BY id');

  for (const article of articles as any[]) {
    console.log(`Generating generic summary for "${article.title}"...`);
    const summary = await generateGenericSummary(article.id);
    console.log(`  Done — id: ${summary.id}, length: ${summary.content.length}`);

    // Rate limit
    if (articles.indexOf(article) < articles.length - 1) {
      console.log('  Waiting 30s for rate limit...');
      await new Promise(r => setTimeout(r, 30000));
    }
  }

  await closeDb();
  console.log('Done!');
}

main().catch(e => { console.error(e); process.exit(1); });
