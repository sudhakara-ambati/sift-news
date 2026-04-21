import withAuthMiddleware from "next-auth/middleware";

export default withAuthMiddleware;

export const config = {
  matcher: [
    "/((?!login|api/auth|api/cron|_next/static|_next/image|favicon.ico|manifest.json|icon|apple-icon|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)).*)",
  ],
};
