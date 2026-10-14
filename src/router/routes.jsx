import LoginPage from '../pages/LoginPage'
import NewOrderPage from '../pages/NewOrderPage'
import NotFoundPage from '../pages/NotFoundPage'
import OrdersPage from '../pages/OrdersPage'
import { GuestOnly, RequireAuth, RootRedirect } from './guards'

export const routes = [
  { path: '/', element: <RootRedirect /> },
  {
    element: <GuestOnly />,
    children: [{ path: '/login', element: <LoginPage /> }],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/orders', element: <OrdersPage /> },
      { path: '/orders/new', element: <NewOrderPage /> },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
]
