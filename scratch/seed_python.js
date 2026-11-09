const fs = require('fs');
const crypto = require('crypto');

const pythonQuestions = [
  {
    q: 'ما هي الدالة المستخدمة لطباعة النصوص في بايثون؟',
    options: ['print()', 'console.log()', 'echo', 'printf'],
    answer: 'print()',
    exp: 'دالة الطباعة الأساسية في بايثون هي print()'
  },
  {
    q: 'أي مما يلي يُستخدم لكتابة تعليق من سطر واحد في لغة بايثون؟',
    options: ['#', '//', '/*', '<!--'],
    answer: '#',
    exp: 'علامة التعليق في بايثون هي #'
  },
  {
    q: 'أي من الكلمات التالية غير مسموح باستخدامها كاسم متغير في بايثون؟',
    options: ['if', 'my_var', 'score_1', 'total'],
    answer: 'if',
    exp: 'الكلمات المحجوزة مثل if لا يجوز تسمية المتغيرات بها'
  },
  {
    q: 'كيف يتم الإعلان عن متغير وتعيين قيمة رقمية له في بايثون؟',
    options: ['x = 5', 'int x = 5;', 'var x = 5;', 'let x = 5;'],
    answer: 'x = 5',
    exp: 'بايثون لغة ديناميكية تُنشئ المتغير بمجرد تعيين القيمة مثل x = 5'
  },
  {
    q: 'ما هو نوع البيانات للناتج من التعبير 10 / 2 في بايثون؟',
    options: ['float', 'int', 'double', 'str'],
    answer: 'float',
    exp: 'عملية القسمة / في بايثون ينتج عنها دائماً قيمة عشرية float'
  },
  {
    q: 'أي من الرموز التالية يمثل معامل المقارنة يساوي في بايثون؟',
    options: ['==', '=', '===', 'equal'],
    answer: '==',
    exp: 'يستخدم == لمقارنة القيم بينما = للإسناد'
  },
  {
    q: 'كيف نتحقق من صحة شرطين معاً في جملة if بلغة بايثون؟',
    options: ['and', '&&', '&', 'also'],
    answer: 'and',
    exp: 'في بايثون نستخدم المعامل المنطقي and'
  },
  {
    q: 'ما هي الطريقة الصحيحة لكتابة جملة شرطية if في بايثون؟',
    options: ['if x > 5:', 'if (x > 5) {', 'if x > 5 then', 'if [x > 5]:'],
    answer: 'if x > 5:',
    exp: 'تنتهي جمل الشرط في بايثون بنقطتين رأسيتين :'
  },
  {
    q: 'ما هي الدالة المستخدمة لاستقبال مدخلات من المستخدم في بايثون؟',
    options: ['input()', 'get()', 'scan()', 'read()'],
    answer: 'input()',
    exp: 'تستخدم input() لقراءة مدخلات المستخدم كنص'
  },
  {
    q: 'كيف نقوم بتحويل نص يحتوي على أرقام إلى عدد صحيح؟',
    options: ['int()', 'str()', 'float()', 'toInt()'],
    answer: 'int()',
    exp: 'دالة int() تحول القيمة إلى عدد صحيح'
  },
  {
    q: 'أي من الدوال التالية تُرجع عدد عناصر القائمة (List)؟',
    options: ['len()', 'size()', 'count()', 'length()'],
    answer: 'len()',
    exp: 'دالة len() تُرجع طول القائمة أو السلسلة النصية'
  },
  {
    q: 'كيف نحدد حلقة تكرارية تبدأ من 0 وتنتهي قبل 5 في بايثون؟',
    options: ['for i in range(5):', 'for (i=0; i<5; i++)', 'loop 5 times:', 'repeat 5:'],
    answer: 'for i in range(5):',
    exp: 'دالة range(5) تولد أرقاماً من 0 إلى 4'
  },
  {
    q: 'أي رمز يُستخدم لتعريف كتلة برمجية (Code Block) تابعة لدالة أو شرط في بايثون؟',
    options: ['المسافات البادئة (Indentation)', 'الأقواس المعقوفة {}', 'begin/end', 'العلامة <>'],
    answer: 'المسافات البادئة (Indentation)',
    exp: 'تعتمد لغة بايثون على المسافات البادئة لتحديد النطاق'
  },
  {
    q: 'كيف نعرّف دالة جديدة في لغة بايثون؟',
    options: ['def my_function():', 'function my_function()', 'fn my_function()', 'define my_function():'],
    answer: 'def my_function():',
    exp: 'يتم تعريف الدوال باستخدام الكلمة المفتاحية def'
  },
  {
    q: 'ما هو فهرس (Index) أول عنصر في قائمة بايثون؟',
    options: ['0', '1', '-1', 'first'],
    answer: '0',
    exp: 'يبدأ الفهرس دائماً من الصفر 0'
  },
  {
    q: 'كيف نضيف عنصراً جديداً إلى نهاية القائمة في بايثون؟',
    options: ['append()', 'add()', 'push()', 'insert_end()'],
    answer: 'append()',
    exp: 'دالة append() تضيف عنصراً في نهاية القائمة'
  },
  {
    q: 'ما ناتج تنفيذ العملية 2 ** 3 في بايثون؟',
    options: ['8', '6', '5', '9'],
    answer: '8',
    exp: 'المعامل ** يمثل الأس، 2 أس 3 = 8'
  },
  {
    q: 'ما هي الكلمة المفتاحية المستخدمة لإيقاف حلقة تكرارية والخروج منها فوراً؟',
    options: ['break', 'stop', 'exit', 'continue'],
    answer: 'break',
    exp: 'أمر break ينهي التكرار ويخرج من الحلقة فوراً'
  },
  {
    q: 'ما هي الكلمة المفتاحية المستخدمة للانتقال إلى التكرار التالي وتخطي الكود المتبقي في الحلقة؟',
    options: ['continue', 'pass', 'skip', 'next'],
    answer: 'continue',
    exp: 'أمر continue يتخطى الدورة الحالية وينتقل للتالية'
  },
  {
    q: 'أي من أنواع البيانات التالية يمثل قيمة منطقية إما صواب أو خطأ؟',
    options: ['bool', 'binary', 'logic', 'flag'],
    answer: 'bool',
    exp: 'النوع المنطقي في بايثون هو bool وله قيمتان True و False'
  }
];

function norm(s) {
  return s
    .replace(/[ًٌٍَُِّْـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/[ة]/g, 'ه')
    .replace(/[ى]/g, 'ي')
    .replace(/["'«»“”؟?!.,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

const pyRecords = pythonQuestions.map((item, idx) => {
  const hash = crypto.createHash('md5').update(norm(item.q)).digest('hex').substring(0, 16);
  return {
    id: 'seed_qureo_py_lvl1_' + String(idx + 1).padStart(2, '0'),
    questionHash: hash,
    questionText: item.q,
    normalizedText: norm(item.q),
    options: item.options,
    normalizedOptions: item.options.map(norm),
    suggestedAnswer: item.answer,
    verifiedAnswer: item.answer,
    confidenceScore: 1.0,
    explanation: item.exp,
    isVerified: true,
    source: 'PLATFORM_VERIFIED',
    verificationStatus: 'VERIFIED',
    retrievalCount: 0,
    occurrenceCount: 1,
    platform: 'QUREO',
    subject: 'PYTHON',
    platformArabic: 'كيريو',
    subjectArabic: 'بايثون',
    tags: ['QUREO_PYTHON', 'level_1'],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
});

fs.writeFileSync('data/qureo_python_questions.json', JSON.stringify(pyRecords, null, 2), 'utf8');
console.log('Saved ' + pyRecords.length + ' QUREO Python questions.');
