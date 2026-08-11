import { Navigate, Route, Routes } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Layout from './components/Layout.jsx';
import LoginPage from './pages/LoginPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import ProjectsPage from './pages/ProjectsPage.jsx';
import TasksPage from './pages/TasksPage.jsx';
import ReportsPage from './pages/ReportsPage.jsx';
import ActivitiesPage from './pages/ActivitiesPage.jsx';
import TimeLogsPage from './pages/TimeLogsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
        <Route index element={<DashboardPage />} />
        <Route path="projects" element={<ProjectsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="reviews" element={<ProtectedRoute roles={['project_manager']}><TasksPage initialStatus="review" reviewMode /></ProtectedRoute>} />
        <Route path="reports" element={<ReportsPage />} />
        <Route path="time-logs" element={<TimeLogsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="users" element={<ProtectedRoute roles={['admin']}><UsersPage /></ProtectedRoute>} />
        <Route path="activities" element={<ProtectedRoute roles={['admin']}><ActivitiesPage /></ProtectedRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
