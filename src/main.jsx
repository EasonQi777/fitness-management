import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import { RouterProvider } from 'react-router/dom'
import AppProviders from './AppProviders'
import './index.css'
import { routes } from './router/routes'
import { useAuthStore } from './store/authStore'

dayjs.locale('zh-cn')
useAuthStore.getState().restore()
const router = createBrowserRouter(routes)

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
