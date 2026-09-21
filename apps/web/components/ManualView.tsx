"use client";

import { Printer } from "lucide-react";
import { publicAsset } from "@/lib/api";
import { MANUAL_CHAPTERS, type ManualBlock, type ManualChapter } from "@/lib/manual";

function BlockView({ block }: { block: ManualBlock }) {
  if (block.type === "p") {
    return <p className="text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">{block.text}</p>;
  }
  if (block.type === "note") {
    return (
      <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[14px] text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
        {block.text}
      </p>
    );
  }
  if (block.type === "ul") {
    return (
      <ul className="list-disc space-y-1 pl-5 text-[15px] leading-relaxed text-slate-700 dark:text-slate-300">
        {block.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    );
  }
  if (block.type === "table") {
    return (
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full min-w-[480px] text-left text-[13px]">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            <tr>
              {block.headers.map((h) => (
                <th key={h} className="px-3 py-2">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, i) => (
              <tr key={i} className="border-t border-slate-200 dark:border-slate-700">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2 align-top text-slate-800 dark:text-slate-200">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <figure className="manual-figure overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={publicAsset(block.src)} alt={block.alt} className="w-full bg-white" />
      {block.caption ? (
        <figcaption className="px-3 py-2 text-[12px] text-slate-600 dark:text-slate-400">{block.caption}</figcaption>
      ) : null}
    </figure>
  );
}

function ChapterView({ chapter, first }: { chapter: ManualChapter; first: boolean }) {
  return (
    <article
      id={chapter.id}
      className={`manual-chapter scroll-mt-6 ${first ? "" : "mt-14 border-t border-slate-200 pt-10 dark:border-slate-700"}`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        Actualizado {chapter.updated}
      </p>
      <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{chapter.title}</h2>
      <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{chapter.summary}</p>
      {chapter.sections.map((section) => (
        <section key={section.id} id={`${chapter.id}-${section.id}`} className="mt-8 scroll-mt-6">
          <h3 className="mb-3 text-lg font-semibold text-slate-900 dark:text-white">{section.title}</h3>
          <div className="space-y-4">
            {section.blocks.map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </div>
        </section>
      ))}
    </article>
  );
}

export function ManualView() {
  return (
    <div className="mx-auto max-w-4xl">
      <div className="manual-toolbar mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Manual de prueba</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Archivo vivo: cada test documentado se agrega acá. Imprimí o guardá como PDF desde el navegador.
          </p>
        </div>
        <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={() => window.print()}>
          <Printer className="h-4 w-4" />
          Imprimir / PDF
        </button>
      </div>

      <nav className="manual-toc mb-8 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Índice</p>
        <ol className="mt-2 space-y-1 text-sm">
          {MANUAL_CHAPTERS.map((ch, i) => (
            <li key={ch.id}>
              <a className="text-sky-700 hover:underline dark:text-sky-300" href={`#${ch.id}`}>
                {i + 1}. {ch.title}
              </a>
              <span className="ml-2 text-[11px] text-slate-400">{ch.updated}</span>
            </li>
          ))}
        </ol>
      </nav>

      {MANUAL_CHAPTERS.map((chapter, i) => (
        <ChapterView key={chapter.id} chapter={chapter} first={i === 0} />
      ))}
    </div>
  );
}
