export default function SearchBar() {
  return (
    <form
      action="/search"
      method="get"
      className="hidden items-center sm:flex"
      role="search"
    >
      <input
        type="search"
        name="q"
        placeholder="OpenAI, Sam Altman, ChatGPT"
        aria-label="Search news by comma-separated keywords"
        className="w-60 rounded-md border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/90 placeholder:text-white/35 focus:border-white/35 focus:outline-none focus:ring-0 lg:w-72"
        autoComplete="off"
      />
    </form>
  );
}
