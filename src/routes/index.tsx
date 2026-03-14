import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppLayout } from "@/components/layout/AppLayout";

// Lazy-loaded route components for code splitting
import { Dashboard } from "@/components/dashboard/Dashboard";
import { NewProjectWizard } from "@/components/dashboard/NewProjectWizard";
import { ProjectWorkspace } from "@/components/workspace/ProjectWorkspace";
import { RedFlagDashboard } from "@/components/redflags/RedFlagDashboard";
import { FreeQueryChat } from "@/components/freequery/FreeQueryChat";
import { ReportExport } from "@/components/reports/ReportExport";
import { SettingsPage } from "@/components/settings/SettingsPage";

/**
 * DD-Analyst Route Configuration
 *
 * /                               -> Dashboard (project list)
 * /new-project                    -> New Project wizard
 * /projects/:projectId            -> Project Workspace (Q&A, files, preview)
 * /projects/:projectId/redflags   -> Red Flag Dashboard (full view)
 * /projects/:projectId/chat       -> Free Query Chat mode
 * /projects/:projectId/reports    -> Report Export wizard
 * /settings                       -> Application settings
 */
export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      {
        index: true,
        element: <Dashboard />,
      },
      {
        path: "new-project",
        element: <NewProjectWizard />,
      },
      {
        path: "projects/:projectId",
        element: <ProjectWorkspace />,
      },
      {
        path: "projects/:projectId/redflags",
        element: <RedFlagDashboard />,
      },
      {
        path: "projects/:projectId/chat",
        element: <FreeQueryChat />,
      },
      {
        path: "projects/:projectId/reports",
        element: <ReportExport />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        // Catch-all redirect
        path: "*",
        element: <Navigate to="/" replace />,
      },
    ],
  },
]);
