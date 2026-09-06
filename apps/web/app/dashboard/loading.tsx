export default function DashboardLoading() {
  return (
    <div className="flex min-h-[40vh] flex-col gap-4 animate-pulse">
      <div className="h-7 w-48 rounded bg-slate-200 dark:bg-slate-800" />
      <div className="h-4 w-72 max-w-full rounded bg-slate-200/80 dark:bg-slate-800/80" />
      <div className="mt-2 h-40 rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-800 dark:bg-slate-900/60" />
    </div>
  );
}
