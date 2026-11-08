// Small outlined tag identifying which business a row belongs to.
// fixed: one width for both books, so the columns after it line up in lists.
export default function BizBadge({ biz, fixed = false }) {
  const isMpg = biz === 'mpg'
  return (
    <span
      className={`rounded-md border px-[6px] py-[1px] text-micro font-bold tracking-wide ${fixed ? 'inline-block w-[62px] flex-none text-center' : ''}`}
      style={{
        background: isMpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
        borderColor: isMpg ? 'var(--mpg-line)' : 'var(--bay-line)',
        // Ink variants: the bright brand hues fail contrast at this size on white.
        color: isMpg ? 'var(--mpg-ink)' : 'var(--bay-ink)',
      }}
    >
      {isMpg ? 'MPG' : 'BAYWAY'}
    </span>
  )
}
