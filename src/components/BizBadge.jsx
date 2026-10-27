// Small outlined tag identifying which business a row belongs to.
export default function BizBadge({ biz }) {
  const isMpg = biz === 'mpg'
  return (
    <span
      className="rounded-md border px-[6px] py-[1px] text-[10.5px] font-bold tracking-wide"
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
