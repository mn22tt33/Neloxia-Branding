const fs = require('fs');

function extract(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const titleRegex = /<h5 class="mhc_toggle_title">([\s\S]*?)<\/h5>[\s\S]*?<div class="mhc_toggle_content mh-the-content clearfix">([\s\S]*?)<\/div>/g;

  let qa = [];
  let m;
  while ((m = titleRegex.exec(content)) !== null) {
    const q = m[1].replace(/<[^>]+>/g, '').trim();
    const a = m[2].replace(/<[^>]+>/g, '').trim().replace(/^الإجابة الصحيحة\s*:\s*/, '');
    qa.push({ q, a });
  }

  return qa;
}

const level1 = extract('scratch/level_1.html');
console.log(`Level 1 extracted: ${level1.length} questions`);
level1.forEach((item, idx) => {
  console.log(`\n[${idx + 1}] السؤال: ${item.q}\nالإجابة: ${item.a}`);
});
