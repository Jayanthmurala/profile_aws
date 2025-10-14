#!/usr/bin/env node

/**
 * Fix ESM import extensions for production build
 * Adds .js extensions to relative imports in compiled JavaScript files
 * Required for Node.js ESM compatibility in production
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DIST_DIR = path.join(__dirname, '..', 'dist');

function fixImportsInFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Fix relative imports without extensions
  // Matches: import ... from "./something" or import ... from "../something"
  content = content.replace(
    /from\s+['"](\.\/?[^'"]*?)['"](?!\.[jt]s)/g,
    (match, importPath) => {
      // Skip if already has extension
      if (importPath.endsWith('.js') || importPath.endsWith('.ts')) {
        return match;
      }
      
      // Add .js extension
      modified = true;
      return match.replace(importPath, importPath + '.js');
    }
  );

  // Fix dynamic imports
  content = content.replace(
    /import\s*\(\s*['"](\.\/?[^'"]*?)['"](?!\.[jt]s)\s*\)/g,
    (match, importPath) => {
      if (importPath.endsWith('.js') || importPath.endsWith('.ts')) {
        return match;
      }
      
      modified = true;
      return match.replace(importPath, importPath + '.js');
    }
  );

  if (modified) {
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`Fixed imports in: ${path.relative(DIST_DIR, filePath)}`);
  }
}

function walkDirectory(dir) {
  if (!fs.existsSync(dir)) {
    console.log(`Directory ${dir} does not exist, skipping import fixes`);
    return;
  }

  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      walkDirectory(filePath);
    } else if (file.endsWith('.js')) {
      fixImportsInFile(filePath);
    }
  }
}

console.log('Fixing ESM import extensions in dist/ directory...');
walkDirectory(DIST_DIR);
console.log('Import fix complete!');
