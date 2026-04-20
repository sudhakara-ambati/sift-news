import LoginForm from "@/components/LoginForm";

export const metadata = {
  title: "Sign in — Sift",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Sift</h1>
          <p className="text-sm text-white/60">Sign in to continue.</p>
        </div>
        <LoginForm />
      </div>
    </div>
  );
}
