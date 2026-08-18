import { useState, useEffect } from 'react'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import Auth from './Auth.jsx'
import Portfolio from './Portfolio.jsx'
import ProjectSetup from './ProjectSetup.jsx'
import ProjectView from './ProjectView.jsx'
import TopOfFunnel from './TopOfFunnel.jsx'
import Sidebar from './Sidebar.jsx'
import CRMSettings from './CRMSettings.jsx'
import { supabase } from './supabase.js'
import { CentralAssumptionsProvider } from './CentralAssumptions.jsx'
import { ThemeProvider, useTheme } from './ThemeContext.jsx'
import { NavProvider, useNav } from './NavContext.jsx'
import EnergyLoader from './EnergyLoader.jsx'

function Root() {
  const { theme } = useTheme()
  const nav = useNav()
  const { section, subView, portfolioView } = nav.location
  const projectId = nav.location.project || null
  const [session, setSession]             = useState(null)
  const [loading, setLoading]             = useState(true)
  const [resolvedProject, setResolvedProject] = useState(null) // deep-link fallback when no payload
  const [showNewProject, setShowNewProject]  = useState(false)
  const [taskBadge, setTaskBadge]         = useState(0)              // pending task count for sidebar badge

  // The open project: the live object passed on navigate, or — on a cold
  // deep-link / refresh — resolved from the DB by id.
  const currentProject =
    (nav.payload && nav.payload.id === projectId) ? nav.payload
    : (resolvedProject && resolvedProject.id === projectId) ? resolvedProject
    : null

  useEffect(() => {
    if (section !== 'portfolio' || portfolioView !== 'model' || !projectId) return
    if (currentProject) return
    let cancelled = false
    supabase.from('projects').select('*').eq('id', projectId).single().then(({ data }) => {
      if (cancelled) return
      if (data) setResolvedProject(data)
      else nav.navigate({ section: 'portfolio', portfolioView: 'portfolio', project: null }, { replace: true })
    })
    return () => { cancelled = true }
    // nav.navigate is stable; excluded to avoid re-fetching on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, portfolioView, projectId, currentProject])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) {
        nav.navigate({ section: 'topOfFunnel', subView: 'privateWire', portfolioView: 'portfolio', project: null, org: null, viewMode: undefined }, { replace: true })
      }
    })
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleNavigate(newSection, newSubView) {
    // A top-level sidebar jump: clear any drill-in state (org / project / inner tab).
    nav.navigate({
      section: newSection,
      subView: newSubView || subView,
      portfolioView: 'portfolio',
      project: null,
      org: null,
      viewMode: undefined,
    })
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: theme.pageBg }}>
      <EnergyLoader />
    </div>
  )

  if (!session) return <Auth />

  return (
    <div style={{ display: 'flex', height: '100vh', background: theme.pageBg, overflow: 'hidden' }}>

      {/* ── Sidebar ── */}
      <Sidebar
        section={section}
        subView={subView}
        onNavigate={handleNavigate}
        session={session}
        taskBadge={taskBadge}
      />

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

        {/* Portfolio */}
        {section === 'portfolio' && portfolioView === 'portfolio' && (
          <Portfolio
            session={session}
            onOpenProject={p => nav.navigate({ section: 'portfolio', portfolioView: 'model', project: p.id }, { payload: p })}
            onNewProject={() => setShowNewProject(true)}
          />
        )}
        {section === 'portfolio' && portfolioView === 'model' && currentProject && (
          <ProjectView
            session={session}
            project={currentProject}
            onBack={() => nav.backOr({ section: 'portfolio', portfolioView: 'portfolio', project: null })}
          />
        )}
        {section === 'portfolio' && portfolioView === 'model' && !currentProject && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
            <EnergyLoader />
          </div>
        )}

        {/* Top of Funnel */}
        {section === 'topOfFunnel' && (
          <TopOfFunnel
            session={session}
            subView={subView}
            setSubView={v => nav.navigate({ section: 'topOfFunnel', subView: v, org: null, viewMode: undefined })}
            onTaskBadgeChange={setTaskBadge}
          />
        )}

        {/* CRM Settings (data exports) */}
        {section === 'settings' && <CRMSettings />}
      </div>

      {/* New Project modal */}
      {showNewProject && (
        <ProjectSetup
          session={session}
          onCreated={p => { setShowNewProject(false); nav.navigate({ section: 'portfolio', portfolioView: 'model', project: p.id }, { payload: p }) }}
          onCancel={() => setShowNewProject(false)}
        />
      )}
    </div>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ThemeProvider>
      <CentralAssumptionsProvider>
        <NavProvider>
          <Root />
        </NavProvider>
      </CentralAssumptionsProvider>
    </ThemeProvider>
  </StrictMode>,
)
