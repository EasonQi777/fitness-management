import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router'
import { useAuthStore } from '../store/authStore'
import { DEFAULT_REDIRECT, getSafeRedirect } from '../utils/redirect'

/**
 * 未登录时跳转登录页：直接访问时在 redirect 参数中保存当前地址；
 * 会话结束（退出或 401）时直接回到登录页，不保存地址
 */
export function RequireAuth() {
  const { token, restored, signedOut } = useAuthStore()
  const { pathname, search } = useLocation()
  if (!restored) return null
  if (!token) {
    if (signedOut) return <Navigate to="/login" replace />
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
