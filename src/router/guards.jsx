import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { useAuthStore } from '../store/authStore'
import { DEFAULT_REDIRECT, getSafeRedirect } from '../utils/redirect'

/** 未登录时跳转登录页，并在 redirect 参数中保存当前地址 */
export function RequireAuth() {
  const { token, restored } = useAuthStore()
  const { pathname, search } = useLocation()
  if (!restored) return null
  if (!token) {
    const redirect = encodeURIComponent(pathname + search)
    return <Navigate to={`/login?redirect=${redirect}`} replace />
  }
  return <Outlet />
}

/** 已登录访问登录页时，跳转到校验过的回跳地址（登录成功后也由此跳转） */
export function GuestOnly() {
  const { token, restored } = useAuthStore()
  const [params] = useSearchParams()
  if (!restored) return null
  if (token)
    return <Navigate to={getSafeRedirect(params.get('redirect'))} replace />
  return <Outlet />
}

export function RootRedirect() {
  const { token, restored } = useAuthStore()
  if (!restored) return null
  return <Navigate to={token ? DEFAULT_REDIRECT : '/login'} replace />
}
