import { http } from './http'

/**
 * 登录页自行展示错误，不使用请求层 toast
 * @returns {Promise<{ token: string, username: string }>}
 */
export const login = ({ username, password }) =>
  http
    .post('/auth/login', { username, password }, { skipErrorToast: true })
    .then((res) => res.data)
