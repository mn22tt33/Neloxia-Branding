import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { QuestionNormalizer } from '../src/ai/normalizer';
import { QuestionKnowledgeRecord } from '../src/types';

interface RawQA {
  question: string;
  answer: string;
  unit?: string;
  level?: number;
  category: 'FINANCIAL_LITERACY' | 'QUREO_JS';
}

function cleanText(txt: string): string {
  return txt
    .replace(/&#8220;/g, '"')
    .replace(/&#8221;/g, '"')
    .replace(/&#8211;/g, '-')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFromHtml(filePath: string, category: 'FINANCIAL_LITERACY' | 'QUREO_JS', level: number): RawQA[] {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  const results: RawQA[] = [];

  // Toggle accordion regex
  const toggleRegex = /<h5 class="mhc_toggle_title">([\s\S]*?)<\/h5>[\s\S]*?<div class="mhc_toggle_content mh-the-content clearfix">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = toggleRegex.exec(content)) !== null) {
    const rawQ = m[1].replace(/<[^>]+>/g, '').trim();
    const rawA = m[2].replace(/<[^>]+>/g, '').trim();

    const cleanQ = cleanText(rawQ.replace(/^(السؤال\s*(الاول|الثانى|الثاني|الثالث|الرابع|الخامس|السادس|السابع|الثامن|التاسع|العاشر|\d+)|\d+[-.)])\s*:\s*/i, ''));
    const cleanA = cleanText(rawA.replace(/^(الاجابة الصحيحة|الإجابة الصحيحة|كود الحل|الكود الصحيح)\s*:\s*/i, ''));

    if (cleanQ.length > 5 && cleanA.length > 0) {
      results.push({
        question: cleanQ,
        answer: cleanA,
        level,
        category
      });
    }
  }

  // Also check standard paragraph Q&A if toggle regex didn't catch them
  if (results.length === 0) {
    const pRegex = /<p><strong>(.*?)<\/strong><\/p>[\s\S]*?<p>(.*?)<\/p>/g;
    while ((m = pRegex.exec(content)) !== null) {
      const q = cleanText(m[1].replace(/<[^>]+>/g, ''));
      const a = cleanText(m[2].replace(/<[^>]+>/g, ''));
      if (q.includes('السؤال') || q.includes('سؤال')) {
        results.push({
          question: q.replace(/^.*?:\s*/, ''),
          answer: a.replace(/^.*?:\s*/, ''),
          level,
          category
        });
      }
    }
  }

  return results;
}

async function main() {
  const allQA: RawQA[] = [];

  // 1. Financial Literacy Levels 1-9
  for (let i = 1; i <= 9; i++) {
    const file = `scratch/level_${i}.html`;
    const qa = extractFromHtml(file, 'FINANCIAL_LITERACY', i);
    console.log(`Financial Literacy Level ${i}: Extracted ${qa.length} questions`);
    allQA.push(...qa);
  }

  // 2. Qureo Levels 1-14
  for (let i = 1; i <= 14; i++) {
    const file = `scratch/qureo_level_${i}.html`;
    const qa = extractFromHtml(file, 'QUREO_JS', i);
    console.log(`Qureo Level ${i}: Extracted ${qa.length} questions`);
    allQA.push(...qa);
  }

  console.log(`\n========================================`);
  console.log(`Total Extracted Knowledge Records: ${allQA.length}`);
  console.log(`========================================\n`);

  // Transform into QuestionKnowledgeRecord
  const records: QuestionKnowledgeRecord[] = [];
  const seenHashes = new Set<string>();

  for (const item of allQA) {
    const normalizedQ = QuestionNormalizer.normalizeArabicText(item.question);
    const normalizedA = QuestionNormalizer.normalizeArabicText(item.answer);

    // Compute deterministic hash
    const hash = crypto
      .createHash('sha256')
      .update(normalizedQ)
      .digest('hex')
      .substring(0, 16);

    if (seenHashes.has(hash)) continue;
    seenHashes.add(hash);

    const record: QuestionKnowledgeRecord = {
      id: `seed_${item.category.toLowerCase()}_lvl${item.level}_${hash.substring(0, 8)}`,
      questionHash: hash,
      questionText: item.question,
      normalizedText: normalizedQ,
      options: [item.answer],
      normalizedOptions: [normalizedA],
      suggestedAnswer: item.answer,
      verifiedAnswer: item.answer,
      confidenceScore: 1.0,
      explanation: `إجابة نموذجية معتمدة وموثقة لمنهج ${item.category === 'FINANCIAL_LITERACY' ? 'الثقافة المالية (سبريكس)' : 'كيريو جافاسكريبت'} - المستوى ${item.level}`,
      isVerified: true,
      source: 'PLATFORM_VERIFIED' as any,
      verificationStatus: 'VERIFIED',
      retrievalCount: 0,
      occurrenceCount: 1,
      tags: [item.category, `level_${item.level}`],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      verifiedAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };

    records.push(record);
  }

  console.log(`Deduplicated verified records: ${records.length}`);

  // Write to data/question_knowledge_store.json
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  const storePath = path.join(dataDir, 'question_knowledge_store.json');
  fs.writeFileSync(storePath, JSON.stringify(records, null, 2), 'utf8');
  console.log(`Successfully saved ${records.length} verified Q&A records to ${storePath}!`);
}

main().catch(console.error);
