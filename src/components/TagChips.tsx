import Link from "next/link";

type Tag = { id: string; name: string };

type Props = {
  tags: Tag[];
  activeTagId: string | null;
  activeView: "general" | "all" | "tag";
};

export default function TagChips({ tags, activeTagId, activeView }: Props) {
  const chipClass = (active: boolean) =>
    active
      ? "shrink-0 rounded-full border border-white/30 bg-white px-3 py-1 text-xs font-medium text-black"
      : "shrink-0 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-xs text-white/70 hover:border-white/25 hover:text-white";

  return (
    <div className="flex gap-1.5 whitespace-nowrap sm:flex-wrap">
      <Link href="/" className={chipClass(activeView === "general")}>
        General
      </Link>
      <Link href="/?view=all" className={chipClass(activeView === "all")}>
        All
      </Link>
      {tags.map((tag) => (
        <Link
          key={tag.id}
          href={`/?tag=${tag.id}`}
          className={chipClass(activeTagId === tag.id)}
        >
          {tag.name}
        </Link>
      ))}
    </div>
  );
}
