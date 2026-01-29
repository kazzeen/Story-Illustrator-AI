import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const versionPath = path.join(__dirname, 'public', 'version.json');

// Read package.json to get the version
const packageJsonPath = path.join(__dirname, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));

const versionData = {
  version: `v${packageJson.version}`,
  buildTime: new Date().toISOString(),
  timestamp: Date.now(),
  env: process.env.NODE_ENV || 'production'
};

fs.writeFileSync(versionPath, JSON.stringify(versionData, null, 2));

console.log(`Updated public/version.json to ${versionData.version} (${versionData.buildTime})`);
