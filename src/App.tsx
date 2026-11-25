import React from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import { LoginPage, SignupPage } from './pages/AuthPages';
import { CaptionStylesPage } from './pages/CaptionStylesPage';
import { ClipsPage } from './pages/ClipsPage';
import { DashboardPage } from './pages/DashboardPage';
import { LandingPage } from './pages/LandingPage';
import { NewProjectPage } from './pages/NewProjectPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SettingsPage } from './pages/SettingsPage';
import { StudioPage } from './pages/StudioPage';
import { YouTubeClipperPage } from './pages/YouTubeClipperPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-[#090909] text-white flex items-center justify-center gap-2 text-sm">
        <Loader2 className="w-4 h-4 animate-spin text-[#8B5CF6]" />
        Verifying session...
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<LandingPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/new"
              element={
                <ProtectedRoute>
                  <NewProjectPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/projects"
              element={
                <ProtectedRoute>
                  <ProjectsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/project/:id"
              element={
                <ProtectedRoute>
                  <StudioPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/youtube"
              element={
                <ProtectedRoute>
                  <YouTubeClipperPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/youtube/:id"
              element={
                <ProtectedRoute>
                  <YouTubeClipperPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/clips"
              element={
                <ProtectedRoute>
                  <ClipsPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/styles"
              element={
                <ProtectedRoute>
                  <CaptionStylesPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/dashboard/settings"
              element={
                <ProtectedRoute>
                  <SettingsPage />
                </ProtectedRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
