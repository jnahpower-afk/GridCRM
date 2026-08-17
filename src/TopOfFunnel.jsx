import { useState } from 'react'
import { useTheme } from './ThemeContext.jsx'
import PrivateWireLeads from './PrivateWireLeads.jsx'
import GreenfieldsMap from './GreenfieldsMap.jsx'
import GreenfieldLeads from './GreenfieldLeads.jsx'
import GreenfieldProjects from './GreenfieldProjects.jsx'
import InitiativesList from './InitiativesList.jsx'
import NetworkMap from './NetworkMap.jsx'
import TopOfFunnelDashboard from './TopOfFunnelDashboard.jsx'

export default function TopOfFunnel({ session, subView, setSubView, onTaskBadgeChange }) {
  const { theme } = useTheme()
  const [greenfieldSection, setGreenfieldSection] = useState('initiatives') // 'initiatives' | 'networkMap'
  const [selectedInitiative, setSelectedInitiative] = useState(null)
  const [initiativeTab, setInitiativeTab] = useState('map') // 'map' | 'leads'

  return (
    <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif", color: theme.textPrimary }}>

      {subView === 'dashboard'   && <TopOfFunnelDashboard session={session} />}
      {subView === 'privateWire' && <PrivateWireLeads key="pw" campaignScope="PW" onTaskBadgeChange={onTaskBadgeChange} />}
      {subView === 'dataCentres' && <PrivateWireLeads key="dc" campaignScope="DC" />}

      {subView === 'greenfield' && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Greenfield secondary tab bar */}
          {!selectedInitiative && (
            <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${theme.cardBorder}`, background: theme.pageBg, paddingLeft: 20, flexShrink: 0 }}>
              {[['initiatives', 'Initiatives'], ['networkMap', 'Network Map'], ['projects', 'Projects']].map(([key, label]) => (
                <button key={key} onClick={() => setGreenfieldSection(key)} style={{
                  fontSize: 12, fontWeight: greenfieldSection === key ? 700 : 500,
                  color: greenfieldSection === key ? theme.textPrimary : theme.textTertiary,
                  background: 'none', border: 'none',
                  borderBottom: greenfieldSection === key ? `2px solid ${theme.accent}` : '2px solid transparent',
                  padding: '10px 16px 8px', cursor: 'pointer',
                  fontFamily: "'Inter', system-ui, sans-serif",
                  transition: 'all 0.1s',
                }}>{label}</button>
              ))}
            </div>
          )}

          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>

            {!selectedInitiative && greenfieldSection === 'initiatives' && (
              <InitiativesList
                session={session}
                onSelect={initiative => { setSelectedInitiative(initiative); setInitiativeTab('map') }}
              />
            )}

            {!selectedInitiative && greenfieldSection === 'networkMap' && (
              <NetworkMap session={session} />
            )}

            {!selectedInitiative && greenfieldSection === 'projects' && (
              <GreenfieldProjects />
            )}

            {selectedInitiative && (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', borderBottom: `1px solid ${theme.cardBorder}`, background: theme.pageBg, paddingLeft: 14, flexShrink: 0 }}>
                  <button onClick={() => setSelectedInitiative(null)} style={{ fontSize: 11, color: theme.textTertiary, background: 'none', border: 'none', cursor: 'pointer', padding: '10px 10px 10px 4px', display: 'flex', alignItems: 'center', gap: 4, fontFamily: "'Inter', system-ui, sans-serif", flexShrink: 0 }}>
                    ← Greenfield
                  </button>
                  <div style={{ width: 1, height: 16, background: theme.cardBorder, margin: '0 6px' }} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginRight: 12 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: selectedInitiative.color }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: theme.textPrimary }}>{selectedInitiative.name}</span>
                  </div>
                  {[['map', 'Map'], ['leads', 'Leads']].map(([key, label]) => (
                    <button key={key} onClick={() => setInitiativeTab(key)} style={{
                      fontSize: 11, fontWeight: initiativeTab === key ? 700 : 500,
                      color: initiativeTab === key ? theme.textPrimary : theme.textTertiary,
                      background: 'none', border: 'none',
                      borderBottom: initiativeTab === key ? `2px solid ${selectedInitiative.color}` : '2px solid transparent',
                      padding: '10px 14px 8px', cursor: 'pointer',
                      fontFamily: "'Inter', system-ui, sans-serif",
                      transition: 'all 0.1s',
                    }}>{label}</button>
                  ))}
                </div>
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {initiativeTab === 'map'   && <GreenfieldsMap session={session} initiative={selectedInitiative} onBack={() => setSelectedInitiative(null)} />}
                  {initiativeTab === 'leads' && <GreenfieldLeads session={session} initiative={selectedInitiative} />}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
