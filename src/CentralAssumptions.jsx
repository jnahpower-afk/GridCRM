import { createContext, useContext, useState, useEffect } from 'react'
import { fetchCentralAssumptions, fetchBessAssumptions } from './googleSheets'

const CentralAssumptionsContext = createContext(null)

export function useCentralAssumptions() {
  return useContext(CentralAssumptionsContext)
}

export function CentralAssumptionsProvider({ children }) {
  const [assumptions, setAssumptions] = useState(null)
  const [bessAssumptions, setBessAssumptions] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      const [solarData, bessData] = await Promise.all([
        fetchCentralAssumptions(),
        fetchBessAssumptions(),
      ])
      if (solarData) {
        setAssumptions(solarData)
      } else {
        setError('Could not load central assumptions — using defaults')
      }
      if (bessData) {
        setBessAssumptions(bessData)
      }
      setLoading(false)
    }
    load()
  }, [])

  return (
    <CentralAssumptionsContext.Provider value={{ assumptions, bessAssumptions, loading, error }}>
      {children}
    </CentralAssumptionsContext.Provider>
  )
}
