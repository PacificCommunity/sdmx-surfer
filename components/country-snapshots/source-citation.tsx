export function SourceCitation({
  dataflow,
  visUrl,
}: {
  dataflow: string;
  visUrl?: string;
}) {
  return (
    <p className="mt-2 text-xs text-neutral-500">
      Source: SPC <code className="font-mono">{dataflow}</code> via .Stat
      {visUrl ? (
        <>
          {" "}
          (
          <a
            href={visUrl}
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            view dataset
          </a>
          )
        </>
      ) : null}
    </p>
  );
}
