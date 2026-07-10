import { createContext, useContext, useEffect, useState } from 'react'

// biz: 'all' | 'mpg' | 'bay'
const BusinessContext = createContext(null)

export const BIZ = {
  all: { key: 'all', label: 'All' },
  mpg: { key: 'mpg', label: 'MPG', color: 'var(--mpg)', soft: 'var(--mpg-soft)' },
  bay: { key: 'bay', label: 'Bayway', color: 'var(--bay)', soft: 'var(--bay-soft)' },
}

export function BusinessProvider({ children }) {
  const [biz, setBiz] = useState(() => localStorage.getItem('biz-filter') || 'all')

  useEffect(() => {
    localStorage.setItem('biz-filter', biz)
    // Drives the --accent CSS variable swap for single-business theming.
    if (biz === 'all') {
      document.documentElement.removeAttribute('data-biz')
    } else {
      document.documentElement.setAttribute('data-biz', biz)
    }
  }, [biz])

  // matches(rowBiz) -> should a row tagged rowBiz be visible under the current filter
  const matches = (rowBiz) => biz === 'all' || rowBiz === biz

  return (
    <BusinessContext.Provider value={{ biz, setBiz, matches }}>
      {children}
    </BusinessContext.Provider>
  )
}

export const useBusiness = () => useContext(BusinessContext)
