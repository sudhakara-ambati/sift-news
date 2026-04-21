-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Article" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "publishedAt" DATETIME NOT NULL,
    "snippet" TEXT,
    "content" TEXT,
    "summary" TEXT,
    "summaryTerms" TEXT,
    "summaryModel" TEXT,
    "imageUrl" TEXT,
    "clusterId" TEXT,
    "score" REAL NOT NULL DEFAULT 0,
    "isHeadline" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Article" ("clusterId", "content", "createdAt", "id", "imageUrl", "publishedAt", "score", "snippet", "source", "summary", "summaryModel", "summaryTerms", "title", "url") SELECT "clusterId", "content", "createdAt", "id", "imageUrl", "publishedAt", "score", "snippet", "source", "summary", "summaryModel", "summaryTerms", "title", "url" FROM "Article";
DROP TABLE "Article";
ALTER TABLE "new_Article" RENAME TO "Article";
CREATE UNIQUE INDEX "Article_url_key" ON "Article"("url");
CREATE INDEX "Article_publishedAt_idx" ON "Article"("publishedAt");
CREATE INDEX "Article_clusterId_idx" ON "Article"("clusterId");
CREATE INDEX "Article_score_idx" ON "Article"("score");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
