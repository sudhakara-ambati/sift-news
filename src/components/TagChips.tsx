import Link from "next/link";

type Tag = { id: string; name: string };

type Props = {
  tags: Tag[];
  activeTagId: string | null;
};

export default function TagChips({ tags, activeTagId }: Props) {
  const chipClass = (active: boolean) =>
    active
      ? "rounded-full border border-white/30 bg-white/15 px-3 py-1 text-sm text-white"
      : "rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-sm text-white/70 hover:border-white/20 hover:text-white";

  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/" className={chipClass(activeTagId === null)}>
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
