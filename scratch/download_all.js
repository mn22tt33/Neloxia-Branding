const { execSync } = require('child_process');
const fs = require('fs');

async function downloadAll() {
  for (let i = 2; i <= 9; i++) {
    const url = `https://qureoeg.com/financial-literacy-level-${i}/`;
    const file = `scratch/level_${i}.html`;
    console.log(`Downloading Level ${i}...`);
    try {
      execSync(`curl.exe -s -L "${url}" -o "${file}"`);
      const size = fs.statSync(file).size;
      console.log(`Level ${i} saved: ${size} bytes`);
    } catch (e) {
      console.error(`Failed ${i}:`, e.message);
    }
  }
  console.log('Finished downloading levels 2-9.');
}

downloadAll();
