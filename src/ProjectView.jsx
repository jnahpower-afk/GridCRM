import { useState, useCallback, useEffect } from "react";
import App from "./App.jsx";
import BessApp from "./BessApp.jsx";
import FinModelUpload, { UploadedModelPanel } from "./FinModelUpload.jsx";
import { supabase } from "./supabase.js";
import ProjectOverview from "./ProjectOverview.jsx";
import AcquisitionProcess from "./AcquisitionProcess.jsx";
import { FM_VERSION_LABELS } from "./AcquisitionProcess.jsx";
import FuseLogo from "./FuseLogo.jsx";
import { useTheme } from "./ThemeContext.jsx";
import ICMemoButton from "./ICMemoGenerator.jsx";
import ModelWorkings from "./ModelWorkings.jsx";
import InputChangeLog from "./InputChangeLog.jsx";
import VersionComparison from "./VersionComparison.jsx";

const MAIN_TABS = [
  ["overview", "Project Overview"],
  ["acquisition", "Acquisition Process"],
  ["financial", "Financial Model"],
];

const FM_TABS = [
  ["financial", "Financial Model"],
  ["workings", "Model Workings"],
  ["compare", "Version Compare"],
  ["changelog", "Change Log"],
];

const FM_GROUP = new Set(["financial", "workings", "compare", "changelog"]);

const FM_VERSIONS = [1, 2, 3]; // NBO, FABO, FID

export default function ProjectView({ session, project, onBack }) {
  const { theme } = useTheme();
  const [activeTab, setActiveTab] = useState("overview");
  const [fmVersion, setFmVersion] = useState(1); // current FM version being viewed
  const [acqData, setAcqData] = useState(null);  // project_acquisition.data
  const [showUpload, setShowUpload] = useState(false);
  const isBess = project?.technology === "BESS";
  const uploaded = acqData?.model_source === "uploaded"; // uploaded model → DCF workflow hidden

  useEffect(() => {
    if (!project?.id) return;
    let cancelled = false;
    supabase.from("project_acquisition").select("data").eq("project_id", project.id).maybeSingle()
      .then(({ data }) => { if (!cancelled) setAcqData(data?.data || null); });
    return () => { cancelled = true; };
  }, [project?.id]);

  // Called from AcquisitionProcess when user clicks "Create NBO FM" etc.
  const handleOpenFM = useCallback((version) => {
    setFmVersion(version);
    setActiveTab("financial");
  }, []);

  async function handleRemoveModel() {
    if (!window.confirm("Remove the uploaded model? This restores the DCF workflow and clears the extracted KPIs.")) return;
    const { data: existing } = await supabase.from("project_acquisition").select("data").eq("project_id", project.id).maybeSingle();
    const d = { ...(existing?.data || {}) };
    const filePath = d.fin_model?.file_path;
    delete d.model_source; delete d.fin_model;
    await supabase.from("project_acquisition").upsert({ project_id: project.id, data: d, updated_at: new Date().toISOString() }, { onConflict: "project_id" });
    await supabase.from("model_runs").delete().eq("project_id", project.id).like("notes", "Uploaded fin model:%");
    if (filePath) await supabase.storage.from("project-files").remove([filePath]);
    setAcqData(d);
    setActiveTab("overview");
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", background: theme.pageBg, fontFamily: "'Inter', system-ui, sans-serif" }}>

      {/* Top bar with back button, project name, and tab toggle */}
      <div style={{
        display: "flex", alignItems: "center", gap: 16,
        padding: "10px 20px", borderBottom: `1px solid ${theme.border}`,
        background: theme.pageBg, flexShrink: 0,
      }}>
        {/* Back button */}
        <div
          onClick={onBack}
          title="Back to Portfolio"
          style={{
            width: 34, height: 34, borderRadius: 8, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, color: theme.textTertiary,
          }}
          onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >←</div>

        {/* Fuse logo */}
        <FuseLogo size={32} />

        {/* Project name */}
        <div style={{ fontSize: 13, fontWeight: 700, color: theme.textPrimary }}>
          {project?.name || "Project"}
        </div>

        {/* Main tab toggle */}
        <div style={{
          display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`,
          borderRadius: 8, padding: 3, gap: 2, marginLeft: 8,
        }}>
          {MAIN_TABS.map(([key, label]) => {
            const isActive = key === "financial" ? FM_GROUP.has(activeTab) : activeTab === key;
            return (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  fontSize: 11, fontWeight: isActive ? 700 : 500,
                  color: isActive ? theme.pillActiveText : theme.pillInactiveText,
                  background: isActive ? theme.pillActiveBg : "transparent",
                  border: isActive ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
                  borderRadius: 6, padding: "4px 14px", cursor: "pointer",
                  boxShadow: isActive ? theme.shadowSm : "none",
                  transition: "all 0.1s", whiteSpace: "nowrap",
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >{label}</button>
            );
          })}
        </div>

        {/* FM sub-tabs — hidden for uploaded-model projects (no DCF workflow) */}
        {FM_GROUP.has(activeTab) && !uploaded && (
          <div style={{
            display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`,
            borderRadius: 8, padding: 3, gap: 2,
          }}>
            {FM_TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                style={{
                  fontSize: 11, fontWeight: activeTab === key ? 700 : 500,
                  color: activeTab === key ? theme.pillActiveText : theme.pillInactiveText,
                  background: activeTab === key ? theme.pillActiveBg : "transparent",
                  border: activeTab === key ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
                  borderRadius: 6, padding: "4px 14px", cursor: "pointer",
                  boxShadow: activeTab === key ? theme.shadowSm : "none",
                  transition: "all 0.1s", whiteSpace: "nowrap",
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >{label}</button>
            ))}
          </div>
        )}

        {/* FM Version toggle — shown on Financial Model and Model Workings tabs */}
        {(activeTab === "financial" || activeTab === "workings") && !uploaded && (
          <div style={{
            display: "flex", background: theme.pillBg, border: `1px solid ${theme.pillBorder}`,
            borderRadius: 8, padding: 3, gap: 2,
          }}>
            {FM_VERSIONS.map(v => (
              <button
                key={v}
                onClick={() => setFmVersion(v)}
                style={{
                  fontSize: 10, fontWeight: fmVersion === v ? 700 : 500,
                  color: fmVersion === v ? theme.pillActiveText : theme.pillInactiveText,
                  background: fmVersion === v ? theme.pillActiveBg : "transparent",
                  border: fmVersion === v ? `1px solid ${theme.pillBorder}` : "1px solid transparent",
                  borderRadius: 6, padding: "4px 12px", cursor: "pointer",
                  boxShadow: fmVersion === v ? theme.shadowSm : "none",
                  transition: "all 0.1s", whiteSpace: "nowrap",
                  fontFamily: "'Inter', system-ui, sans-serif",
                }}
              >{FM_VERSION_LABELS[v]}</button>
            ))}
          </div>
        )}

        {/* Upload fin model */}
        <div style={{ marginLeft: "auto" }}>
          <button onClick={() => setShowUpload(true)}
            style={{ fontSize: 11, fontWeight: 700, padding: "6px 14px", borderRadius: 8, cursor: "pointer",
              color: uploaded ? theme.accent : "#fff", background: uploaded ? theme.accent + "18" : theme.accent,
              border: `1px solid ${uploaded ? theme.accent + "55" : theme.accent}`, fontFamily: "inherit", whiteSpace: "nowrap" }}>
            {uploaded ? "✓ Model uploaded" : "↑ Upload Fin Model"}
          </button>
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>

        {activeTab === "overview" && (
          <ProjectOverview project={project} session={session} onNavigate={setActiveTab} />
        )}

        {activeTab === "acquisition" && (
          <AcquisitionProcess project={project} session={session} onOpenFM={handleOpenFM} />
        )}

        {activeTab === "financial" && (
          uploaded
            ? <UploadedModelPanel data={acqData.fin_model} project={project} theme={theme} onReupload={() => setShowUpload(true)} onRemove={handleRemoveModel} onRefreshed={setAcqData} />
            : isBess
              ? <BessApp session={session} project={project} onBack={null} embedded fmVersion={fmVersion} />
              : <App session={session} project={project} onBack={null} embedded fmVersion={fmVersion} />
        )}

        {activeTab === "workings" && (
          <ModelWorkings project={project} fmVersion={fmVersion} />
        )}

        {activeTab === "compare" && (
          <VersionComparison project={project} />
        )}

        {activeTab === "changelog" && (
          <InputChangeLog project={project} fmVersion={fmVersion} />
        )}
      </div>

      {showUpload && (
        <FinModelUpload
          project={project}
          onClose={() => setShowUpload(false)}
          onDone={(newData) => { setAcqData(newData); setShowUpload(false); setActiveTab("financial"); }}
        />
      )}
    </div>
  );
}
