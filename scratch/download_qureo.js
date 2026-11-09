const { execSync } = require('child_process');
const fs = require('fs');

async function downloadQureo() {
  for (let i = 1; i <= 14; i++) {
    const url = `https://qureoeg.com/qureo-level${i}/`;
    const file = `scratch/qureo_level_${i}.html`;
    console.log(`Downloading Qureo Level ${i}...`);
    try {
      execSync(`curl.exe -s -L "${url}" -o "${file}"`);
      const size = fs.statSync(file).size;
      console.log(`Qureo Level ${i} saved: ${size} bytes`);
    } catch (e) {
      console.error(`Failed ${i}:`, e.message);
    }
  }
  console.log('Finished downloading Qureo levels 1-14.');
}

downloadQureo();
