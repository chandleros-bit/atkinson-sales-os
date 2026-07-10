// Small colored tag identifying which business a row belongs to.
export default function BizBadge({ biz }) {
  const isMpg = biz === 'mpg'
  return (
    <span
      className="rounded px-[5px] py-[1px] text-[9.5px] font-bold tracking-wide"
      style={{
        background: isMpg ? 'var(--mpg-soft)' : 'var(--bay-soft)',
        color: isMpg ? 'var(--mpg)' : 'var(--bay)',
      }}
    >
      {isMpg ? 'MPG' : 'BAYWAY'}
    </span>
  )
}
