import SignOutButton from "@/components/SignOutButton";

export default function Header() {
  return (
    <header className="border-b border-white/10">
      <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Sift</h1>
        <SignOutButton />
      </div>
    </header>
  );
}
