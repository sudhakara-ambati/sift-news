import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SEED_TAGS = [
  {
    name: "AI",
    queryTerms:
      '"artificial intelligence" OR "generative AI" OR "large language model" OR OpenAI OR Anthropic OR DeepMind OR "Hugging Face" OR ChatGPT OR "GPT-4" OR "GPT-5"',
  },
  {
    name: "UK politics",
    queryTerms:
      '"UK politics" OR "British politics" OR Westminster OR Starmer OR "Downing Street" OR "House of Commons" OR "Labour Party" OR "Conservative Party"',
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
