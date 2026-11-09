const fs = require('fs');
const content = fs.readFileSync('scratch/qureo_solutions.html', 'utf8');
const regex = /<h2><a href="([^"]+)">([^<]+)<\/a><\/h2>/g;
let m;
while ((m = regex.exec(content)) !== null) {
  console.log(`${m[2].trim()} -> ${m[1]}`);
}
