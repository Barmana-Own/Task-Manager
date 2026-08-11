import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:4000/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ttm_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('ttm_token');
      localStorage.removeItem('ttm_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  },
);

export function getErrorMessage(error) {
  const validationMessage = error.response?.data?.errors?.[0]?.message;
  if (validationMessage) return validationMessage;
  return error.response?.data?.message || error.message || 'خطای غیرمنتظره رخ داد.';
}

export default api;
