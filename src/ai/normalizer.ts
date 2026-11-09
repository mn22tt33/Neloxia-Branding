import crypto from 'crypto';

export class QuestionNormalizer {
  // Common Arabic diacritics / tashkeel range
  private static readonly TASHKEEL_REGEX = /[\u064B-\u0652\u0670]/g;
  private static readonly TATWEEL_REGEX = /\u0640/g;
  
  // Option prefixes like A., B:, 1-, أ), etc.
  private static readonly OPTION_PREFIX_REGEX = /^([A-D]|[أ-د]|[1-9])(\s*[-:.)]\s*|\s+)/i;

  // Critical words where a single addition or removal inverts or drastically alters meaning
  public static readonly CRITICAL_WORDS = new Set([
    'ليس', 'لا', 'غير', 'لم', 'لن', 'بدون', 'عدا', 'إلا', 'ما عدا', 'حظر', 'منع',
    'not', 'no', 'never', 'except', 'without', 'none',
    'اكثر', 'اقل', 'اكبر', 'اصغر', 'افضل', 'اسوا', 'اهم', 'ادنى', 'اقصى',
    'اول', 'ثاني', 'ثالث', 'رابع', 'خامس',
    '1', '2', '3', '4', '5', '6', '7', '8', '9', '0'
  ]);

  /**
   * Normalizes Arabic and general text:
   * - Strips tashkeel and tatweel
   * - Unifies Alef, Yaa, Taa Marbuta variants
   * - Normalizes punctuation, quotes, and whitespace
   */
  public static normalizeArabicText(text: string): string {
    if (!text) return '';

    let clean = text
      // Remove diacritics / tashkeel
      .replace(this.TASHKEEL_REGEX, '')
      // Remove tatweel / kashida
      .replace(this.TATWEEL_REGEX, '')
      // Normalize Alef variants: [إأآا] -> ا
      .replace(/[إأآا]/g, 'ا')
      // Normalize Taa Marbuta & Haa: ة -> ه
      .replace(/ة/g, 'ه')
      // Normalize Yaa / Alef Maksura: ى -> ي
      .replace(/[ىي]/g, 'ي')
      // Normalize Persian/Urdu variants if present
      .replace(/ك/g, 'ك')
      // Replace non-alphanumeric punctuation with spaces (preserving numbers and arabic/latin letters)
      .replace(/[،,؛;:؟?!.ـ\-—_'"«»()\[\]{}/*\\|~^`#@$%+=<>]/g, ' ')
      // Convert latin characters to lowercase
      .toLowerCase()
      // Collapse multiple spaces
      .replace(/\s+/g, ' ')
      .trim();

    return clean;
  }

  /**
   * Normalizes a single multiple-choice option (removes prefixes like 'A.', 'B:', etc.)
   */
  public static normalizeOption(option: string): string {
    if (!option) return '';
    let stripped = option.trim().replace(this.OPTION_PREFIX_REGEX, '');
    return this.normalizeArabicText(stripped);
  }

  /**
   * Normalizes an array of options
   */
  public static normalizeOptions(options: string[]): string[] {
    return (options || []).map(opt => this.normalizeOption(opt)).filter(o => o.length > 0);
  }

  /**
   * Computes a deterministic SHA-256 fingerprint for a question:
   * Normalizes question text + sorts normalized options to ensure that
   * option order permutations yield the IDENTICAL hash.
   */
  public static computeQuestionHash(questionText: string, options?: string[]): string {
    const normQuestion = this.normalizeArabicText(questionText);
    const normOptions = this.normalizeOptions(options || []);
    
    // Sort options alphabetically so order variations (A->B->C vs C->A->B) have identical fingerprint
    const sortedOptions = [...normOptions].sort();
    
    const combined = `${normQuestion}::${sortedOptions.join('||')}`;
    return crypto.createHash('sha256').update(combined).digest('hex');
  }

  /**
   * Extracts critical modifier words (negations, comparatives, numbers)
   */
  public static extractCriticalWords(text: string): Set<string> {
    const normalized = this.normalizeArabicText(text);
    const words = normalized.split(/\s+/);
    const critical = new Set<string>();
    for (const w of words) {
      if (this.CRITICAL_WORDS.has(w)) {
        critical.add(w);
      }
    }
    return critical;
  }

  /**
   * Checks whether two texts differ in any critical word (negation, quantifier, or number).
   * If true, fuzzy matching MUST be prohibited to avoid inverting answers.
   */
  public static hasCriticalDifference(textA: string, textB: string): boolean {
    const critA = this.extractCriticalWords(textA);
    const critB = this.extractCriticalWords(textB);

    if (critA.size !== critB.size) return true;
    for (const w of critA) {
      if (!critB.has(w)) return true;
    }
    return false;
  }

  /**
   * Token-based Jaccard similarity between two texts (0.0 to 1.0)
   */
  public static calculateSimilarity(textA: string, textB: string): number {
    const normA = this.normalizeArabicText(textA);
    const normB = this.normalizeArabicText(textB);

    if (normA === normB) return 1.0;
    if (!normA || !normB) return 0.0;

    const setA = new Set(normA.split(/\s+/).filter(w => w.length > 1));
    const setB = new Set(normB.split(/\s+/).filter(w => w.length > 1));

    if (setA.size === 0 || setB.size === 0) return 0.0;

    let intersection = 0;
    for (const w of setA) {
      if (setB.has(w)) intersection++;
    }

    const union = new Set([...setA, ...setB]).size;
    return intersection / union;
  }

  /**
   * Checks if options of Question A match Question B (independent of order),
   * and provides a mapping from B's options to A's options.
   */
  public static matchOptionsBijection(
    incomingOptions: string[],
    storedOptions: string[]
  ): { isMatch: boolean; incomingToStoredMap: Map<number, number>; storedToIncomingMap: Map<number, number> } {
    const incomingNorm = this.normalizeOptions(incomingOptions);
    const storedNorm = this.normalizeOptions(storedOptions);

    const incomingToStoredMap = new Map<number, number>();
    const storedToIncomingMap = new Map<number, number>();

    if (incomingNorm.length !== storedNorm.length) {
      return { isMatch: false, incomingToStoredMap, storedToIncomingMap };
    }

    if (incomingNorm.length === 0 && storedNorm.length === 0) {
      return { isMatch: true, incomingToStoredMap, storedToIncomingMap };
    }

    const usedStoredIndices = new Set<number>();

    for (let i = 0; i < incomingNorm.length; i++) {
      const incOpt = incomingNorm[i];
      let bestMatchIdx = -1;
      let highestSim = 0.0;

      for (let s = 0; s < storedNorm.length; s++) {
        if (usedStoredIndices.has(s)) continue;
        const sim = this.calculateSimilarity(incOpt, storedNorm[s]);
        if (sim > highestSim && sim >= 0.85) {
          highestSim = sim;
          bestMatchIdx = s;
        }
      }

      if (bestMatchIdx === -1) {
        return { isMatch: false, incomingToStoredMap, storedToIncomingMap };
      }

      usedStoredIndices.add(bestMatchIdx);
      incomingToStoredMap.set(i, bestMatchIdx);
      storedToIncomingMap.set(bestMatchIdx, i);
    }

    return { isMatch: true, incomingToStoredMap, storedToIncomingMap };
  }
}
