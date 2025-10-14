#!/usr/bin/env tsx
/**
 * Apply critical production indexes for 10M+ users
 * Run this script before deploying to production
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const prisma = new PrismaClient();

async function applyProductionIndexes() {
  console.log('🚀 Applying critical production indexes for 10M+ users...');
  
  try {
    // Read the SQL file
    const sqlPath = join(__dirname, 'add-production-indexes.sql');
    const sql = readFileSync(sqlPath, 'utf-8');
    
    // Split by semicolons and filter out empty statements
    const statements = sql
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      console.log(`\n⏳ Executing statement ${i + 1}/${statements.length}:`);
      console.log(`   ${statement.substring(0, 100)}...`);
      
      const startTime = Date.now();
      
      try {
        await prisma.$executeRawUnsafe(statement);
        const duration = Date.now() - startTime;
        console.log(`   ✅ Completed in ${duration}ms`);
      } catch (error) {
        const duration = Date.now() - startTime;
        console.log(`   ⚠️  Failed after ${duration}ms:`, (error as Error).message);
        
        // Continue with other statements even if one fails
        // (indexes might already exist)
        if ((error as Error).message.includes('already exists')) {
          console.log('   ℹ️  Index already exists, continuing...');
        } else {
          console.error('   ❌ Unexpected error:', error);
        }
      }
    }
    
    console.log('\n🎉 Production indexes application completed!');
    console.log('\n📊 Verifying index creation...');
    
    // Verify critical indexes exist
    const indexCheck = await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes 
      WHERE schemaname = 'public' 
        AND (
          indexname LIKE 'idx_profile_%' OR
          indexname LIKE 'idx_studentbadge_%' OR
          indexname LIKE 'idx_experience_%' OR
          indexname LIKE 'idx_personalproject_%'
        )
      ORDER BY tablename, indexname;
    `;
    
    console.log(`\n✅ Found ${(indexCheck as any[]).length} production indexes:`);
    (indexCheck as any[]).forEach((index: any) => {
      console.log(`   - ${index.tablename}.${index.indexname}`);
    });
    
    // Check table statistics
    console.log('\n📈 Table statistics:');
    const stats = await prisma.$queryRaw`
      SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_rows,
        n_dead_tup as dead_rows,
        last_analyze,
        last_autoanalyze
      FROM pg_stat_user_tables 
      WHERE schemaname = 'public'
      ORDER BY n_live_tup DESC;
    `;
    
    (stats as any[]).forEach((stat: any) => {
      console.log(`   - ${stat.tablename}: ${stat.live_rows} rows`);
    });
    
  } catch (error) {
    console.error('❌ Failed to apply production indexes:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  applyProductionIndexes()
    .then(() => {
      console.log('\n🎯 Production indexes ready for 10M+ users!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

export { applyProductionIndexes };
