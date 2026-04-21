import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";

function stripOuterQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normaliseAdminPasswordHash(value: string): string {
  // Local `.env` commonly escapes `$` as `\$` to avoid env expansion. If that
  // value gets copied into hosted env vars, bcrypt comparisons will fail.
  return stripOuterQuotes(value).replace(/\\\$/g, "$");
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "Credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.username || !credentials?.password) return null;

        const adminUsernameRaw = process.env.ADMIN_USERNAME;
        const adminPasswordHashRaw = process.env.ADMIN_PASSWORD_HASH;
        const adminUsername = adminUsernameRaw
          ? stripOuterQuotes(adminUsernameRaw)
          : null;
        const adminPasswordHash = adminPasswordHashRaw
          ? normaliseAdminPasswordHash(adminPasswordHashRaw)
          : null;
        if (!adminUsername || !adminPasswordHash) return null;

        const usernameMatches = credentials.username === adminUsername;
        const passwordMatches = await bcrypt.compare(
          credentials.password,
          adminPasswordHash,
        );

        if (!usernameMatches || !passwordMatches) return null;

        return { id: "admin", name: adminUsername };
      },
    }),
  ],
  session: {
    strategy: "jwt",
    maxAge: 365 * 24 * 60 * 60,
    updateAge: 24 * 60 * 60,
  },
  pages: {
    signIn: "/login",
  },
  secret: process.env.NEXTAUTH_SECRET,
};
