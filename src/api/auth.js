import { http } from './http'

/** @returns {Promise<{ token: string, username: string }>} */
export const login = ({ username, password }) =>
  http.post('/auth/login', { username, password }).then((res) => res.data)
