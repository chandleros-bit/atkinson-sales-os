// "26–50 of 661" with Prev / Next, under a paged list (lib/paging.js).
// Hidden when everything fits on one page.
export default function Pager({ slice, total, onPage, label = 'Pages', className = '' }) {
  if (slice.pageCount <= 1) return null
  const btn = 'min-h-[32px] rounded-[9px] border border-line2 bg-panel px-3 text-[13px] font-semibold text-[#344054] disabled:opacity-40'
  return (
    <nav aria-label={label} data-pager className={`flex items-center justify-end gap-2 text-[13px] text-muted ${className}`}>
      <span className="num mr-1">
        {slice.from}–{slice.to} of {total}
      </span>
      <button type="button" className={btn} disabled={slice.page <= 1} onClick={() => onPage(slice.page - 1)}>
        Prev
      </button>
      <span className="num">
        Page {slice.page} / {slice.pageCount}
      </span>
      <button type="button" className={btn} disabled={slice.page >= slice.pageCount} onClick={() => onPage(slice.page + 1)}>
        Next
      </button>
    </nav>
  )
}
