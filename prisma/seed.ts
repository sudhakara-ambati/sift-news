import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_TAGS = [
  { name: "AI", queryTerms: "AI OR artificial intelligence" },
  {
    name: "UK politics",
    queryTerms: "UK politics OR Westminster OR Starmer",
  },
];

async function main() {
  for (const tag of SEED_TAGS) {
    const result = await prisma.tag.upsert({
      where: { name: tag.name },
      create: tag,
      update: { queryTerms: tag.queryTerms },
    });
    console.log(`  ${result.name} (${result.id})`);
  }
  console.log(`Seeded ${SEED_TAGS.length} tags.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
