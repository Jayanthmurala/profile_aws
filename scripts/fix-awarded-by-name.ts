import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';

config();

const prisma = new PrismaClient();

async function fixAwardedByNameColumn() {
  try {
    console.log('🔍 Checking if awardedByName column exists...');
    
    // Try to query the column to see if it exists
    try {
      await prisma.$queryRaw`SELECT "awardedByName" FROM "student_badge" LIMIT 1`;
      console.log('✅ awardedByName column already exists');
      return;
    } catch (error) {
      console.log('❌ awardedByName column does not exist, adding it...');
    }

    // Add the missing column
    await prisma.$executeRaw`ALTER TABLE "student_badge" ADD COLUMN "awardedByName" TEXT`;
    console.log('✅ Successfully added awardedByName column to student_badge table');

    // Verify the column was added
    const result = await prisma.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_name = 'student_badge' AND column_name = 'awardedByName'`;
    console.log('✅ Column verification:', result);

  } catch (error) {
    console.error('❌ Error fixing awardedByName column:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Check if this script is being run directly (ES module equivalent of require.main === module)
const isMainModule = import.meta.url === `file://${process.argv[1]}`;

if (isMainModule) {
  fixAwardedByNameColumn()
    .then(() => {
      console.log('🎉 Migration completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Migration failed:', error);
      process.exit(1);
    });
}

export { fixAwardedByNameColumn };
