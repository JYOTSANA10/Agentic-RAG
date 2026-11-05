// Run this ONCE after db:push to create your first admin user
// Usage: node scripts/create-admin.js

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL || 'admin@company.com';
  const password = process.env.ADMIN_PASSWORD || 'Admin1234!';
  const name = process.env.ADMIN_NAME || 'IT Admin';

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    await prisma.user.update({ where: { email }, data: { role: 'admin' } });
    console.log(`✅ User ${email} promoted to admin`);
  } else {
    await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(password, 12), name, role: 'admin' },
    });
    console.log(`✅ Admin user created: ${email}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

