type Props = {
  variant?: "inline" | "full";
};

export default function SearchBar({ variant = "inline" }: Props) {
  const inputWidth =
    variant === "full"
      ? "w-full"
      : "w-60 lg:w-72";
  return (
    <form action="/search" method="get" role="search" className="flex w-full">
      <input
        type="search"
        name="q"
        placeholder="OpenAI, Sam Altman, ChatGPT"
        aria-label="Search news by comma-separated keywords"
        autoComplete="off"
        inputMode="search"
        enterKeyHint="search"
        className={`${inputWidth} rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-white/90 placeholder:text-white/35 focus:border-white/35 focus:outline-none focus:ring-0 sm:text-xs`}
      />
    </form>
  );
}
